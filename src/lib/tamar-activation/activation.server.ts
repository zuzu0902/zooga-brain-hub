/**
 * "הפעלת תמר" — server side.
 *
 * Durable activation records drive every manual conversation start. Nothing
 * here uses setTimeout: a scheduled activation is drained by the existing
 * zero-loss cron worker. The safety gate is evaluated twice — for the preview
 * and again, on live data, immediately before the send.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { quiet } from "@/lib/db-safe";
import { isSessionWindowOpen, recordDelivery, sendWhatsAppText, sendWhatsAppTemplate } from "@/lib/whatsapp-meta.server";
import { validateTemplateForLaunch } from "@/lib/whatsapp-templates.server";
import { isOfferSellable } from "@/lib/offer-sellable";
import { callStage } from "@/lib/tamar-v2/model-registry.server";
import {
  activationIdempotencyKey,
  evaluateActivation,
  topicSpec,
  type ActivationGate,
  type ActivationGateInput,
} from "./core";

const RECENT_DUPLICATE_MINUTES = 60;

export type ActivationContext = {
  contact: any | null;
  gateInput: ActivationGateInput;
  offer: any | null;
  intakeCompleted: boolean;
  facts: string[];
};

async function auditActivation(action: string, details: Record<string, unknown>) {
  await quiet(
    supabaseAdmin.from("zero_loss_audit_log" as any).insert({
      action,
      actor_label: "tamar_activation",
      target_kind: "tamar_activation",
      target_id: String(details.activation_id ?? details.contact_id ?? ""),
      details: details as any,
    } as any),
  );
}

/** Live state for one contact. Never cached — this is a safety input. */
export async function loadActivationContext(args: {
  contactId: string;
  topic: string;
  instruction: string;
  offerId?: string | null;
  ignoreActivationId?: string | null;
}): Promise<ActivationContext> {
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select(
      "id, first_name, full_name, phone, whatsapp_number, consent_marketing, opted_out_at, human_owned, opening_status, whatsapp_opt_in_status, whatsapp_opt_in_at, whatsapp_opt_in_source, baseline_intake_status, conversation_state, city, age, notes",
    )
    .eq("id", args.contactId)
    .maybeSingle();
  const c: any = contact ?? null;

  const phone = c ? String(c.whatsapp_number || c.phone || "") : "";
  let duplicateContacts = 1;
  if (phone) {
    const variants = Array.from(new Set([phone, phone.replace(/^\+/, ""), "+" + phone.replace(/^\+/, "")]));
    const { data: dupes } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .or(variants.map((v) => `phone.eq.${v},whatsapp_number.eq.${v}`).join(","))
      .limit(20);
    duplicateContacts = Math.max(1, (dupes as any[])?.length ?? 1);
  }

  const { data: handoffs } = await supabaseAdmin
    .from("manager_handoffs" as any)
    .select("id, status")
    .eq("contact_id", args.contactId)
    .in("status", ["open", "pending", "queued", "in_progress"])
    .limit(10);

  const sessionWindowOpen = await isSessionWindowOpen(args.contactId);

  let offer: any = null;
  if (args.offerId) {
    const { data } = await supabaseAdmin
      .from("offers")
      .select("id, title, offer_url, description, status, event_date, event_end_date")
      .eq("id", args.offerId)
      .maybeSingle();
    offer = data ?? null;
  }

  let pendingQuery = supabaseAdmin
    .from("tamar_activations" as any)
    .select("id")
    .eq("contact_id", args.contactId)
    .in("status", ["draft", "scheduled", "processing"])
    .limit(5);
  if (args.ignoreActivationId) pendingQuery = pendingQuery.neq("id", args.ignoreActivationId);
  const { data: pending } = await pendingQuery;

  const since = new Date(Date.now() - RECENT_DUPLICATE_MINUTES * 60_000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from("tamar_activations" as any)
    .select("id, topic, instruction")
    .eq("contact_id", args.contactId)
    .eq("status", "sent")
    .gte("executed_at", since)
    .limit(20);
  const normalized = args.instruction.trim().replace(/\s+/g, " ").toLowerCase();
  const recentDuplicateMessage = ((recent as any[]) ?? []).some(
    (r) =>
      String(r.topic) === args.topic &&
      String(r.instruction ?? "").trim().replace(/\s+/g, " ").toLowerCase() === normalized,
  );

  const intakeCompleted = ["completed", "complete", "done"].includes(
    String(c?.baseline_intake_status ?? "").toLowerCase(),
  );

  const facts: string[] = [];
  if (c?.first_name || c?.full_name) facts.push(`שם: ${c.first_name || c.full_name}`);
  if (c?.city) facts.push(`עיר: ${c.city}`);
  if (intakeCompleted) facts.push("האינטייק הבסיסי כבר הושלם — אין לשאול שוב שאלות אינטייק");
  if (c?.conversation_state) facts.push(`מצב שיחה: ${c.conversation_state}`);
  if (offer) {
    facts.push(`מוצר רלוונטי: ${offer.title}`);
    if (offer.offer_url) facts.push(`קישור לדף המכירה: ${offer.offer_url}`);
  }

  return {
    contact: c,
    offer,
    intakeCompleted,
    facts,
    gateInput: {
      topic: args.topic,
      instruction: args.instruction,
      contact: c,
      duplicateContacts,
      openHandoffs: ((handoffs as any[]) ?? []).length,
      sessionWindowOpen,
      offerSelected: !!args.offerId,
      offerSellable: offer ? isOfferSellable(offer) : false,
      pendingActivation: (((pending as any[]) ?? []).length) > 0,
      recentDuplicateMessage,
    },
  };
}

async function templateGateFor(topic: string): Promise<boolean> {
  const spec = topicSpec(topic);
  if (!spec?.template) return false;
  const res = await validateTemplateForLaunch(spec.template.name, spec.template.language);
  return !!res.ok;
}

/** Full gate, including the (network) Meta template check when required. */
export async function gateActivation(ctx: ActivationContext): Promise<ActivationGate> {
  const dry = evaluateActivation(ctx.gateInput);
  if (dry.allowed || dry.reason !== "template_not_approved") {
    if (!ctx.gateInput.sessionWindowOpen && topicSpec(ctx.gateInput.topic)?.template) {
      const approved = await templateGateFor(ctx.gateInput.topic);
      return evaluateActivation({ ...ctx.gateInput, templateApproved: approved });
    }
    return dry;
  }
  return dry;
}

/** Grounded opening text. Never invents facts, asks at most one question. */
export async function composeActivationMessage(args: {
  ctx: ActivationContext;
  topic: string;
  instruction: string;
}): Promise<string> {
  const c = args.ctx.contact ?? {};
  const name = String(c.first_name || String(c.full_name ?? "").split(" ")[0] || "").trim();
  const spec = topicSpec(args.topic);

  const system = `את תמר, העוזרת הדיגיטלית של קהילת זוגה. כתבי הודעת פתיחה אחת בוואטסאפ בעברית, בגוף ראשון, חמה וקצרה (2 עד 4 שורות).
כללים מוחלטים:
- מותר להסתמך רק על העובדות שלמטה. אין להמציא מחיר, תאריך, זמינות או פרט שלא מופיע.
- שאלה אחת לכל היותר, ורק אם היא באמת מקדמת.
- בלי לחץ מכירתי, בלי הבטחות, בלי אימוג'ים מוגזמים.
${args.ctx.intakeCompleted ? "- האינטייק כבר הושלם: אין לפתוח אותו מחדש ואין לשאול שאלות איסוף מידע בסיסיות." : ""}
- אם ההוראה מבקשת מידע שאינו בעובדות — אמרי בכנות שתבדקי מול הצוות.`;

  const user = `מטרת השיחה: ${spec?.label_he ?? args.topic}
הוראת הצוות: ${args.instruction}

עובדות מאושרות:
${args.ctx.facts.length ? args.ctx.facts.map((f) => `- ${f}`).join("\n") : "(אין)"}`;

  try {
    const res = await callStage(
      "response_writer",
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { json: false, context: "activation_preview" },
    );
    const text = String(res.content ?? "").trim();
    if (text) return text;
  } catch {
    /* fall through to the deterministic opening */
  }
  return `${name ? `היי ${name},` : "היי,"} כאן תמר מזוגה. ${args.instruction.trim()}`;
}

export type ActivationPreview = {
  gate: ActivationGate;
  preview: string | null;
  transport: "session" | "template" | null;
  intake_completed: boolean;
  offer_title: string | null;
};

/** Preview never sends and never mutates the contact. */
export async function previewActivation(args: {
  contactId: string;
  topic: string;
  instruction: string;
  offerId?: string | null;
}): Promise<ActivationPreview> {
  const ctx = await loadActivationContext(args);
  const gate = await gateActivation(ctx);
  const preview = gate.allowed
    ? await composeActivationMessage({ ctx, topic: args.topic, instruction: args.instruction })
    : null;
  return {
    gate,
    preview,
    transport: gate.transport,
    intake_completed: ctx.intakeCompleted,
    offer_title: ctx.offer?.title ?? null,
  };
}

export type ActivationRow = Record<string, any>;

/** Create the durable record. `scheduled_at` in the future => scheduled. */
export async function createActivation(args: {
  contactId: string;
  topic: string;
  instruction: string;
  offerId?: string | null;
  scheduledAt?: string | null;
  preview?: string | null;
  createdBy?: string | null;
}): Promise<{ ok: boolean; activation: ActivationRow | null; error?: string }> {
  const key = activationIdempotencyKey({
    contactId: args.contactId,
    topic: args.topic,
    instruction: args.instruction,
    offerId: args.offerId ?? null,
    scheduledAt: args.scheduledAt ?? null,
  });
  const scheduled = !!args.scheduledAt && new Date(args.scheduledAt).getTime() > Date.now();

  const { data, error } = await supabaseAdmin
    .from("tamar_activations" as any)
    .insert({
      contact_id: args.contactId,
      created_by: args.createdBy ?? null,
      topic: args.topic,
      instruction: args.instruction.trim(),
      offer_id: args.offerId ?? null,
      scheduled_at: args.scheduledAt ?? null,
      preview: args.preview ?? null,
      status: scheduled ? "scheduled" : "draft",
      idempotency_key: key,
    } as any)
    .select("*")
    .maybeSingle();

  if (error) {
    if (String(error.code) === "23505") {
      const { data: existing } = await supabaseAdmin
        .from("tamar_activations" as any)
        .select("*")
        .eq("idempotency_key", key)
        .maybeSingle();
      return { ok: true, activation: (existing as any) ?? null };
    }
    return { ok: false, activation: null, error: error.message };
  }
  await auditActivation("activation_created", {
    activation_id: (data as any)?.id,
    contact_id: args.contactId,
    topic: args.topic,
    scheduled_at: args.scheduledAt ?? null,
  });
  return { ok: true, activation: data as any };
}

/** Cancel a not-yet-executed activation. */
export async function cancelActivation(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data } = await supabaseAdmin
    .from("tamar_activations" as any)
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() } as any)
    .eq("id", id)
    .in("status", ["draft", "scheduled"])
    .select("id");
  if (!(data as any[])?.length) return { ok: false, error: "ההפעלה כבר בוצעה או בוטלה" };
  await auditActivation("activation_cancelled", { activation_id: id });
  return { ok: true };
}

export type ExecuteResult = {
  activation_id: string;
  status: "sent" | "blocked" | "failed" | "skipped";
  reason: string | null;
  reason_he: string | null;
  transport: "session" | "template" | null;
  provider_message_id: string | null;
  message: string | null;
};

/**
 * Atomic claim + send. Only a draft/scheduled row can be claimed, so a retry
 * or a concurrent worker can never send the same activation twice.
 */
export async function executeActivation(id: string, opts: { dryRun?: boolean } = {}): Promise<ExecuteResult> {
  const base: ExecuteResult = {
    activation_id: id,
    status: "skipped",
    reason: null,
    reason_he: null,
    transport: null,
    provider_message_id: null,
    message: null,
  };

  const { data: claimed } = await supabaseAdmin
    .from("tamar_activations" as any)
    .update({ status: "processing" } as any)
    .eq("id", id)
    .in("status", ["draft", "scheduled"])
    .select("*");
  const row: any = (claimed as any[])?.[0];
  if (!row) return { ...base, reason: "not_claimable", reason_he: "ההפעלה אינה זמינה לביצוע" };

  const attempts = Number(row.attempts ?? 0) + 1;

  try {
    const ctx = await loadActivationContext({
      contactId: row.contact_id,
      topic: row.topic,
      instruction: row.instruction,
      offerId: row.offer_id,
      ignoreActivationId: id,
    });
    const gate = await gateActivation(ctx);
    if (!gate.allowed) {
      await supabaseAdmin
        .from("tamar_activations" as any)
        .update({
          status: "blocked",
          attempts,
          block_reason: gate.reason,
          block_reason_he: gate.reason_he,
        } as any)
        .eq("id", id);
      await auditActivation("activation_blocked", { activation_id: id, reason: gate.reason });
      return { ...base, status: "blocked", reason: gate.reason, reason_he: gate.reason_he };
    }

    const message =
      String(row.preview ?? "").trim() ||
      (await composeActivationMessage({ ctx, topic: row.topic, instruction: row.instruction }));

    if (opts.dryRun) {
      await supabaseAdmin
        .from("tamar_activations" as any)
        .update({ status: row.scheduled_at ? "scheduled" : "draft", attempts } as any)
        .eq("id", id);
      return { ...base, status: "skipped", reason: "dry_run", transport: gate.transport, message };
    }

    const to = String(ctx.contact.whatsapp_number || ctx.contact.phone);
    const spec = topicSpec(row.topic);
    const firstName = ctx.contact.first_name || String(ctx.contact.full_name ?? "").split(" ")[0] || "";
    const res =
      gate.transport === "session"
        ? await sendWhatsAppText(to, message)
        : await sendWhatsAppTemplate(to, spec!.template!.name, spec!.template!.language, [
            { type: "body", parameters: [{ type: "text", text: firstName || "שלום" }] },
          ]);

    await recordDelivery({
      contactId: row.contact_id,
      offerId: row.offer_id ?? null,
      text: message,
      result: res,
      kind: "tamar_activation",
    });

    if (!res.ok) {
      const failed = attempts >= 3;
      await supabaseAdmin
        .from("tamar_activations" as any)
        .update({
          status: failed ? "failed" : row.scheduled_at ? "scheduled" : "draft",
          attempts,
          last_error: res.error,
        } as any)
        .eq("id", id);
      await auditActivation("activation_send_failed", { activation_id: id, attempts, error: res.error });
      return { ...base, status: "failed", reason: res.error, reason_he: "השליחה נכשלה", transport: gate.transport };
    }

    await supabaseAdmin
      .from("tamar_activations" as any)
      .update({
        status: "sent",
        attempts,
        actual_message: message,
        transport: gate.transport,
        provider_message_id: res.provider_message_id ?? null,
        executed_at: new Date().toISOString(),
        last_error: null,
      } as any)
      .eq("id", id);
    await auditActivation("activation_sent", {
      activation_id: id,
      contact_id: row.contact_id,
      transport: gate.transport,
    });

    return {
      ...base,
      status: "sent",
      transport: gate.transport,
      provider_message_id: res.provider_message_id ?? null,
      message,
    };
  } catch (err: any) {
    const failed = attempts >= 3;
    await supabaseAdmin
      .from("tamar_activations" as any)
      .update({
        status: failed ? "failed" : row.scheduled_at ? "scheduled" : "draft",
        attempts,
        last_error: String(err?.message ?? err).slice(0, 300),
      } as any)
      .eq("id", id);
    return { ...base, status: "failed", reason: String(err?.message ?? err), reason_he: "השליחה נכשלה" };
  }
}

/** Cron drain for scheduled activations. Runs on the existing worker. */
export async function drainDueActivations(limit = 10): Promise<{ due: number; results: ExecuteResult[] }> {
  const { data } = await supabaseAdmin
    .from("tamar_activations" as any)
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  const rows = ((data as any[]) ?? []);
  const results: ExecuteResult[] = [];
  for (const r of rows) results.push(await executeActivation(String(r.id)));
  return { due: rows.length, results };
}