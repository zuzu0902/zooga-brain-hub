/**
 * SHARED HANDOFF CORE — single source of truth for human handoff in BOTH
 * runtimes (v1 `tamar-engine.server.ts` and v2 `tamar-v2/engine.server.ts`).
 *
 * Guarantees:
 *  - Every human request gets an immediate customer receipt. Tamar is never
 *    silent, not even when the thread is already frozen/human_owned.
 *  - handoff row + ops task + contact freeze are written atomically-ish and
 *    idempotently (one open handoff per contact, re-escalated with a cooldown).
 *  - `manager_notified` is only ever true after a real Meta HTTP 200.
 *  - Inside the manager's 24h window a plain text is sent; outside it only an
 *    APPROVED template. Missing WABA_ID/template => alert stays `queued` with
 *    a real error. We never claim a notification that did not happen.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppTemplate, sendWhatsAppText, toE164 } from "@/lib/whatsapp-meta.server";
import { listMetaTemplates } from "@/lib/whatsapp-templates.server";
import {
  MANAGER_ALERT_TEMPLATE_NAME,
  MANAGER_ALERT_TEMPLATE_LANGUAGE,
  buildManagerAlertComponents,
  buildManagerAlertText,
} from "@/lib/handoff-template-params";

/** A1 — exact receipt sent to the customer the moment a human is requested. */
export const HANDOFF_RECEIPT_TEXT =
  "כמובן. העברתי את הבקשה שלך לאדם מהצוות של זוגה, והוא יחזור אליך בהקדם. אם תרצה/י להוסיף משהו, אפשר לכתוב לי כאן ואצרף אותו לבקשה.";

/** A3 — acknowledgement when the thread is already frozen and the customer writes again. */
export const HANDOFF_FROZEN_ACK_TEXT =
  "הבקשה שלך כבר הועברה לאדם מהצוות. אני מוסיפה גם את ההודעה הזאת ומזכירה שוב לצוות.";

export const ESCALATION_COOLDOWN_MS = 10 * 60 * 1000;
export const MANAGER_ALERT_TEMPLATE = MANAGER_ALERT_TEMPLATE_NAME;

export type AlertState = "sent" | "queued" | "failed" | "skipped";

export type ManagerTarget = {
  id: string | null;
  name: string | null;
  phone: string;
  source: "managers_table" | "secret";
};

/** Active manager from the managers table, else the secret fallback. */
export async function resolveActiveManager(): Promise<ManagerTarget | null> {
  const { data } = await supabaseAdmin
    .from("managers" as any)
    .select("id, name, phone")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const phone = toE164((data as any)?.phone);
  if (phone) {
    return { id: (data as any).id ?? null, name: (data as any).name ?? null, phone, source: "managers_table" };
  }
  const fromSecret = toE164(process.env.MANAGER_WHATSAPP_NUMBER);
  if (fromSecret) return { id: null, name: null, phone: fromSecret, source: "secret" };
  return null;
}

/** Is Meta's 24h customer-service window with the MANAGER open? */
export async function managerWindowOpen(managerPhone: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const digits = managerPhone.replace(/\D/g, "");
  try {
    const { data: win } = await supabaseAdmin
      .from("tamar_manager_window" as any)
      .select("last_inbound_at, manager_phone")
      .limit(50);
    for (const row of ((win as any[]) ?? [])) {
      if (String(row?.manager_phone ?? "").replace(/\D/g, "") !== digits) continue;
      if (row?.last_inbound_at && String(row.last_inbound_at) >= since) return true;
    }
  } catch {
    /* fall through to webhook logs */
  }
  try {
    const { data } = await supabaseAdmin
      .from("webhook_logs")
      .select("payload")
      .eq("source", "meta_whatsapp")
      .gte("created_at", since)
      .limit(200);
    return ((data as any[]) ?? []).some((r) => JSON.stringify(r?.payload ?? {}).includes(digits));
  } catch {
    return false;
  }
}

async function templateApproved(name: string, language = "he"): Promise<{ ok: boolean; error: string | null }> {
  const res = await listMetaTemplates();
  if (!res.ok) return { ok: false, error: `template_lookup_failed:${res.error}` };
  const found = res.templates.some(
    (t) => t.name === name && t.language.startsWith(language) && t.status.toUpperCase() === "APPROVED",
  );
  return found ? { ok: true, error: null } : { ok: false, error: `template_not_approved:${name}` };
}

export function crmLink(contactId: string | null): string | null {
  return contactId ? `/contacts/${contactId}` : null;
}

/** Enrich a handoff row with contact-side phone/name so {{2}} is always real. */
async function enrichRow(row: any): Promise<any> {
  if (!row?.contact_id) return row;
  try {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("phone, whatsapp_number, full_name, first_name, last_name")
      .eq("id", row.contact_id)
      .maybeSingle();
    const c = data as any;
    if (!c) return row;
    const name =
      row.customer_name ??
      c.full_name ??
      [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ??
      null;
    return {
      ...row,
      customer_name: name || row.customer_name,
      contact_phone: c.phone ?? null,
      contact_whatsapp_number: c.whatsapp_number ?? null,
      crm_link: row.crm_link ?? crmLink(row.contact_id),
    };
  } catch {
    return row;
  }
}

export type NotifyOutcome = {
  alert_state: AlertState;
  alert_error: string | null;
  http_status: number | null;
  manager_configured: boolean;
  window_open: boolean;
};

/**
 * Try to deliver the manager alert for one handoff row. Safe to call again:
 * every attempt bumps delivery_attempts and records a truthful state.
 */
export async function notifyManagerForHandoff(handoffId: string): Promise<NotifyOutcome> {
  const { data: rowData } = await supabaseAdmin
    .from("manager_handoffs" as any)
    .select("*")
    .eq("id", handoffId)
    .maybeSingle();
  const row = await enrichRow(rowData as any);
  if (!row) {
    return { alert_state: "failed", alert_error: "handoff_not_found", http_status: null, manager_configured: false, window_open: false };
  }

  const manager = await resolveActiveManager();
  let outcome: NotifyOutcome;

  if (!manager) {
    outcome = {
      alert_state: "queued",
      alert_error: "manager_number_not_configured",
      http_status: null,
      manager_configured: false,
      window_open: false,
    };
  } else {
    const windowOpen = await managerWindowOpen(manager.phone);
    const { components, params } = buildManagerAlertComponents(row, MANAGER_ALERT_TEMPLATE_LANGUAGE);
    if (windowOpen) {
      const res = await sendWhatsAppText(manager.phone, buildManagerAlertText(row, MANAGER_ALERT_TEMPLATE_LANGUAGE));
      outcome = {
        alert_state: res.ok ? "sent" : "failed",
        alert_error: res.error,
        http_status: res.status || null,
        manager_configured: true,
        window_open: true,
      };
      if (params.dataIssues.length) await auditHandoff("alert_data_issues", handoffId, { issues: params.dataIssues });
    } else {
      const gate = await templateApproved(MANAGER_ALERT_TEMPLATE, MANAGER_ALERT_TEMPLATE_LANGUAGE);
      if (!gate.ok) {
        outcome = {
          alert_state: "queued",
          alert_error: gate.error,
          http_status: null,
          manager_configured: true,
          window_open: false,
        };
      } else {
        if (params.dataIssues.length) {
          await auditHandoff("alert_data_issues", handoffId, { issues: params.dataIssues });
        }
        const res = await sendWhatsAppTemplate(
          manager.phone,
          MANAGER_ALERT_TEMPLATE,
          MANAGER_ALERT_TEMPLATE_LANGUAGE,
          components,
        );
        outcome = {
          alert_state: res.ok ? "sent" : "failed",
          alert_error: res.error,
          http_status: res.status || null,
          manager_configured: true,
          window_open: false,
        };
      }
    }
  }

  const notified = outcome.alert_state === "sent";
  await supabaseAdmin
    .from("manager_handoffs" as any)
    .update({
      alert_state: outcome.alert_state,
      alert_error: outcome.alert_error,
      last_http_status: outcome.http_status,
      manager_notified: notified,
      notified_at: notified ? new Date().toISOString() : (row.notified_at ?? null),
      notified_manager_id: manager?.id ?? null,
      status: notified ? "notified" : row.status === "claimed" ? "claimed" : "queued",
      delivery_promise: notified ? "notified" : "queued",
      delivery_attempts: (row.delivery_attempts ?? 0) + 1,
      last_escalated_at: new Date().toISOString(),
    } as any)
    .eq("id", handoffId);

  await auditHandoff("notify", handoffId, {
    alert_state: outcome.alert_state,
    alert_error: outcome.alert_error,
    http_status: outcome.http_status,
    window_open: outcome.window_open,
  });

  return outcome;
}

async function auditHandoff(action: string, handoffId: string, after: unknown): Promise<void> {
  try {
    await supabaseAdmin.from("tamar_admin_audit_log" as any).insert({
      actor: "tamar_runtime",
      area: "handoff",
      action,
      target_id: handoffId,
      after_value: after as any,
    } as any);
  } catch {
    /* audit must never break a turn */
  }
}

export type EnsureHandoffInput = {
  contactId: string | null;
  customerPhone: string | null;
  customerName: string | null;
  reason: string;
  reasonCodes: string[];
  urgency?: "low" | "normal" | "high";
  latestInbound: string | null;
  suggestedResponse?: string | null;
  excerpt?: Array<{ ts: string; source: string; content: string }>;
  offerId?: string | null;
  campaignId?: string | null;
  traceId?: string | null;
  conversationMode?: string | null;
  /** true when the thread was already frozen and the customer wrote again */
  followUp?: boolean;
  runtime?: string;
};

export type EnsureHandoffResult = {
  handoff_id: string | null;
  task_id: string | null;
  created: boolean;
  escalation_count: number;
  alert_state: AlertState;
  alert_error: string | null;
  manager_configured: boolean;
  escalated_now: boolean;
  receipt_text: string;
};

/**
 * Create-or-escalate a handoff. Never throws — a handoff failure must not
 * swallow the customer receipt.
 */
export async function ensureHandoff(input: EnsureHandoffInput): Promise<EnsureHandoffResult> {
  const receipt = input.followUp ? HANDOFF_FROZEN_ACK_TEXT : HANDOFF_RECEIPT_TEXT;
  const base: EnsureHandoffResult = {
    handoff_id: null,
    task_id: null,
    created: false,
    escalation_count: 0,
    alert_state: "queued",
    alert_error: null,
    manager_configured: false,
    escalated_now: false,
    receipt_text: receipt,
  };

  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const excerpt = input.excerpt ?? [];

    // --- idempotency: reuse an open handoff for this contact ---
    let existing: any = null;
    if (input.contactId) {
      const { data } = await supabaseAdmin
        .from("manager_handoffs" as any)
        .select("*")
        .eq("contact_id", input.contactId)
        .in("status", ["open", "queued", "notified", "claimed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      existing = data ?? null;
    }

    let handoffId: string | null = existing?.id ?? null;
    let escalationCount = existing?.escalation_count ?? 0;
    let created = false;

    if (!handoffId) {
      const { data: row } = await supabaseAdmin
        .from("manager_handoffs" as any)
        .insert({
          contact_id: input.contactId,
          customer_phone: input.customerPhone,
          customer_name: input.customerName ?? "Unknown WhatsApp contact",
          handoff_reason: input.reason,
          latest_inbound_message: input.latestInbound,
          conversation_excerpt: excerpt,
          transcript_included: excerpt.length > 0,
          urgency: input.urgency ?? "normal",
          suggested_response: input.suggestedResponse ?? null,
          resolved_offer_id: input.offerId ?? null,
          resolved_campaign_id: input.campaignId ?? null,
          runtime_trace_id: input.traceId ?? null,
          conversation_mode: input.conversationMode ?? null,
          conversation_mode_reasons: input.reasonCodes,
          status: "open",
          alert_state: "pending",
          crm_link: crmLink(input.contactId),
          escalation_count: 1,
          last_customer_message_at: nowIso,
          idempotency_key: `${input.contactId ?? input.customerPhone ?? "anon"}:${Math.floor(now.getTime() / 1000)}`,
          notes: input.latestInbound
            ? [{ ts: nowIso, source: "customer", text: input.latestInbound, runtime: input.runtime ?? "v1" }]
            : [],
        } as any)
        .select("id, escalation_count")
        .maybeSingle();
      handoffId = (row as any)?.id ?? null;
      escalationCount = 1;
      created = true;
    } else {
      // A2/A3 — follow-up on an existing request: append note, bump counters.
      escalationCount = (existing.escalation_count ?? 1) + 1;
      const notes = Array.isArray(existing.notes) ? existing.notes : [];
      notes.push({ ts: nowIso, source: "customer", text: input.latestInbound ?? "", runtime: input.runtime ?? "v1" });
      const transcript = Array.isArray(existing.conversation_excerpt) ? existing.conversation_excerpt : [];
      if (input.latestInbound) {
        transcript.push({ ts: nowIso, source: "customer_inbound", content: input.latestInbound });
      }
      await supabaseAdmin
        .from("manager_handoffs" as any)
        .update({
          escalation_count: escalationCount,
          notes: notes.slice(-50),
          conversation_excerpt: transcript.slice(-60),
          latest_inbound_message: input.latestInbound ?? existing.latest_inbound_message,
          last_customer_message_at: nowIso,
          urgency: input.urgency === "high" ? "high" : existing.urgency,
        } as any)
        .eq("id", handoffId);
    }

    base.handoff_id = handoffId;
    base.created = created;
    base.escalation_count = escalationCount;

    // --- ops task (one per handoff) ---
    if (handoffId) {
      const { data: task } = await supabaseAdmin
        .from("tasks")
        .select("id")
        .eq("source_kind", "manager_handoff")
        .eq("source_ref_id", handoffId)
        .maybeSingle();
      if (task) {
        base.task_id = (task as any).id;
        await supabaseAdmin
          .from("tasks")
          .update({
            description: `reason: ${input.reason} • escalations: ${escalationCount}\n\nLatest inbound: ${input.latestInbound ?? ""}`,
            priority: input.urgency === "high" ? "high" : "high",
          } as any)
          .eq("id", (task as any).id);
      } else {
        const { data: newTask } = await supabaseAdmin
          .from("tasks")
          .insert({
            contact_id: input.contactId,
            title: `Handoff — ${input.customerName ?? input.customerPhone ?? "לקוח"}`,
            description: `reason: ${input.reason}\n\nLatest inbound: ${input.latestInbound ?? ""}`,
            status: "open",
            priority: "high",
            resolution_state: "pending",
            source_kind: "manager_handoff",
            source_ref_id: handoffId,
          } as any)
          .select("id")
          .maybeSingle();
        base.task_id = (newTask as any)?.id ?? null;
      }
    }

    // --- freeze automation ---
    if (input.contactId) {
      await supabaseAdmin
        .from("contacts")
        .update({
          manager_attention_required: true,
          human_owned: true,
          human_owned_at: nowIso,
          conversation_state: "human_handoff_queued",
          conversation_state_at: nowIso,
        } as any)
        .eq("id", input.contactId);
    }

    // --- manager alert with cooldown (A3) ---
    const lastEscalated = existing?.last_escalated_at ? Date.parse(existing.last_escalated_at) : 0;
    const cooldownPassed = !lastEscalated || now.getTime() - lastEscalated >= ESCALATION_COOLDOWN_MS;
    const alreadyNotified = existing?.manager_notified === true;
    const shouldNotify = created || !alreadyNotified || cooldownPassed;

    if (handoffId && shouldNotify) {
      const outcome = await notifyManagerForHandoff(handoffId);
      base.alert_state = outcome.alert_state;
      base.alert_error = outcome.alert_error;
      base.manager_configured = outcome.manager_configured;
      base.escalated_now = true;
    } else {
      base.alert_state = (existing?.alert_state as AlertState) ?? "queued";
      base.alert_error = existing?.alert_error ?? "escalation_cooldown_active";
      base.manager_configured = true;
    }

    return base;
  } catch (e) {
    console.error("[handoff-core] ensureHandoff failed", e);
    base.alert_error = String((e as any)?.message ?? e).slice(0, 200);
    base.alert_state = "failed";
    return base;
  }
}

/** Presence-only health for the admin screens. Never exposes numbers/secrets. */
export async function handoffChannelHealth() {
  const manager = await resolveActiveManager();
  const templates = await listMetaTemplates();
  const approved = templates.ok
    ? templates.templates.some(
        (t) => t.name === MANAGER_ALERT_TEMPLATE && t.language.startsWith("he") && t.status.toUpperCase() === "APPROVED",
      )
    : false;
  return {
    manager_configured: !!manager,
    manager_source: manager?.source ?? null,
    waba_id_present: !!String(process.env.WHATSAPP_WABA_ID ?? "").trim(),
    template_lookup_ok: templates.ok,
    template_lookup_error: templates.ok ? null : (templates as any).error,
    manager_template_approved: approved,
    manager_window_open: manager ? await managerWindowOpen(manager.phone) : false,
    deliverable_now: !!manager && (approved || (manager ? await managerWindowOpen(manager.phone) : false)),
  };
}

/* ------------------------------------------------------------------ *
 * RELEASE / AUTO-HEAL — a frozen thread must always have a way back.  *
 * ------------------------------------------------------------------ */

/** Handoff statuses that still hold the thread for a human. */
export const OPEN_HANDOFF_STATUSES = ["open", "notified", "claimed"] as const;

/** How many handoffs still hold this contact for a human. */
export async function countOpenHandoffs(contactId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("manager_handoffs" as any)
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .in("status", OPEN_HANDOFF_STATUSES as unknown as string[]);
  return count ?? 0;
}

/** Current hold on the thread: handoff-driven freeze and/or manual human lock. */
export async function getLockSnapshot(contactId: string): Promise<LockSnapshot> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("human_owned, human_owned_by, human_owned_at")
    .eq("id", contactId)
    .maybeSingle();
  return {
    humanOwned: (data as any)?.human_owned === true,
    humanOwnedBy: (data as any)?.human_owned_by ?? null,
    humanOwnedAt: (data as any)?.human_owned_at ?? null,
    openHandoffs: await countOpenHandoffs(contactId),
  };
}

/**
 * Single gate for every automatic release path (handoff resolve, auto-heal).
 * Never frees a thread another human really holds; `force` is reserved for the
 * explicit admin "return to Tamar" action.
 */
export async function releaseIfUnheld(args: {
  contactId: string;
  actor: string;
  trigger: string;
  force?: boolean;
}): Promise<ReleaseResult & { decision: ReleaseDecision["reason"] }> {
  const snap = await getLockSnapshot(args.contactId);
  const decision = decideAutoRelease(snap, { force: args.force });
  if (!decision.release) {
    return {
      released: false,
      contact_id: args.contactId,
      resolved_handoffs: 0,
      reason: decision.reason,
      decision: decision.reason,
    };
  }
  const res = await releaseThreadToTamar({
    contactId: args.contactId,
    actor: args.actor,
    resolveHandoffs: args.force === true,
    trigger: args.trigger,
  });
  return { ...res, decision: decision.reason };
}

export type ReleaseResult = {
  released: boolean;
  contact_id: string;
  resolved_handoffs: number;
  reason: string;
};

/**
 * Give a thread back to Tamar. Resolves every still-open handoff for the
 * contact and clears the automation freeze, so `human_owned` can never be a
 * permanent dead end. Safe to call twice.
 */
export async function releaseThreadToTamar(args: {
  contactId: string;
  actor: string;
  resolveHandoffs?: boolean;
  trigger?: string;
}): Promise<ReleaseResult> {
  const nowIso = new Date().toISOString();
  let resolved = 0;

  if (args.resolveHandoffs !== false) {
    const { data } = await supabaseAdmin
      .from("manager_handoffs" as any)
      .update({ status: "resolved", resolved_at: nowIso } as any)
      .eq("contact_id", args.contactId)
      .in("status", OPEN_HANDOFF_STATUSES as unknown as string[])
      .select("id");
    resolved = Array.isArray(data) ? data.length : 0;
  }

  const { data: updated } = await supabaseAdmin
    .from("contacts")
    .update({
      human_owned: false,
      human_owned_by: null,
      manager_attention_required: false,
      conversation_state: "consented",
      conversation_state_at: nowIso,
    } as any)
    .eq("id", args.contactId)
    .select("id")
    .maybeSingle();

  if (!updated) {
    return { released: false, contact_id: args.contactId, resolved_handoffs: resolved, reason: "contact_not_found" };
  }

  await supabaseAdmin.from("tamar_state_transitions" as any).insert({
    contact_id: args.contactId,
    from_state: "human_owned",
    to_state: "consented",
    trigger: args.trigger ?? "manual_release_to_tamar",
    reason_codes: ["release_to_tamar"],
    actor: args.actor,
  } as any);

  return { released: true, contact_id: args.contactId, resolved_handoffs: resolved, reason: "released" };
}

/**
 * Auto-heal: a contact frozen as `human_owned` with NO open handoff row is
 * stale data (handoff resolved/deleted elsewhere). Release it so the next
 * inbound message reaches Tamar instead of the frozen acknowledgement.
 * Returns the (possibly refreshed) contact row.
 */
export async function healStaleHumanOwnership<T extends { id?: string | null; human_owned?: boolean | null }>(
  contact: T | null,
): Promise<T | null> {
  if (!contact?.id || !contact.human_owned) return contact;
  const open = await countOpenHandoffs(contact.id);
  if (open > 0) return contact;
  const res = await releaseThreadToTamar({
    contactId: contact.id,
    actor: "system_auto_heal",
    resolveHandoffs: false,
    trigger: "auto_release_no_open_handoff",
  });
  if (!res.released) return contact;
  await supabaseAdmin.from("webhook_logs").insert({
    source: "tamar_brain",
    status: "auto_released_stale_human_owned",
    payload: { contact_id: contact.id },
  } as any);
  return {
    ...contact,
    human_owned: false,
    human_owned_by: null,
    manager_attention_required: false,
    conversation_state: "consented",
  } as T;
}