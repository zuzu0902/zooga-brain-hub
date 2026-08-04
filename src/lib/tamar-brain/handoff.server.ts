/**
 * TAMAR BRAIN v1 — human handoff (supreme rule).
 *
 * On handoff Tamar: acknowledges briefly, stops selling and questioning,
 * freezes automation (human_owned) and alerts the manager on WhatsApp.
 *
 * Manager alerting rules:
 *  - inside Meta's 24h customer-service window a plain text is allowed
 *  - outside it, an APPROVED template is required. If the template is not
 *    approved/available the alert stays `queued` and we never claim it was
 *    sent.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppTemplate, sendWhatsAppText, toE164 } from "@/lib/whatsapp-meta.server";
import { listMetaTemplates } from "@/lib/whatsapp-templates.server";
import { loadBrainPolicy } from "./copy.server";

export type ManagerTarget = { phone: string; source: "managers_table" | "secret" } | null;

/** Resolve the manager phone. NEVER returned to a client. */
export async function resolveManagerTarget(): Promise<ManagerTarget> {
  const { data } = await supabaseAdmin
    .from("managers")
    .select("phone")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const fromTable = toE164((data as any)?.phone);
  if (fromTable) return { phone: fromTable, source: "managers_table" };
  const fromSecret = toE164(process.env.MANAGER_WHATSAPP_NUMBER);
  if (fromSecret) return { phone: fromSecret, source: "secret" };
  return null;
}

/** Presence-only diagnostics for the admin screen. Never exposes the number. */
export async function managerTargetPresence() {
  const target = await resolveManagerTarget();
  return {
    configured: !!target,
    source: target?.source ?? null,
    secret_present: !!process.env.MANAGER_WHATSAPP_NUMBER,
  };
}

/** Was there inbound traffic from this manager in the last 24h? */
async function managerWindowOpen(managerPhone: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("webhook_logs")
    .select("id")
    .eq("source", "meta_whatsapp")
    .gte("created_at", since)
    .limit(200);
  const rows = (data as any[]) ?? [];
  const digits = managerPhone.replace(/\D/g, "");
  return rows.some((r) => JSON.stringify(r?.payload ?? {}).includes(digits));
}

async function templateApproved(name: string, language = "he"): Promise<boolean> {
  const res = await listMetaTemplates();
  if (!res.ok) return false;
  return res.templates.some(
    (t) => t.name === name && t.language.startsWith(language) && t.status.toUpperCase() === "APPROVED",
  );
}

export type HandoffInput = {
  contactId: string | null;
  customerPhone: string | null;
  customerName: string | null;
  reason: string;
  reasonCodes: string[];
  urgency: "low" | "normal" | "high";
  latestInbound: string | null;
  suggestedResponse: string | null;
  excerpt: Array<{ ts: string; source: string; content: string }>;
  offerId?: string | null;
  campaignId?: string | null;
  traceId?: string | null;
};

export type HandoffOutcome = {
  handoff_id: string | null;
  task_id: string | null;
  alert_state: "sent" | "queued" | "failed" | "skipped";
  alert_error: string | null;
  manager_configured: boolean;
};

function crmLink(contactId: string | null): string | null {
  return contactId ? `/contacts/${contactId}` : null;
}

/**
 * Create the handoff record + task, freeze automation, and alert the manager.
 * Idempotent per contact: an open handoff is reused instead of duplicated.
 */
export async function createHandoff(input: HandoffInput): Promise<HandoffOutcome> {
  const policy = await loadBrainPolicy();

  // --- idempotency: reuse an open handoff for this contact ---
  let handoffId: string | null = null;
  if (input.contactId) {
    const { data: open } = await supabaseAdmin
      .from("manager_handoffs")
      .select("id")
      .eq("contact_id", input.contactId)
      .in("status", ["open", "notified", "claimed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    handoffId = (open as any)?.id ?? null;
  }

  if (!handoffId) {
    const { data: created } = await supabaseAdmin
      .from("manager_handoffs")
      .insert({
        contact_id: input.contactId,
        customer_phone: input.customerPhone,
        customer_name: input.customerName,
        handoff_reason: input.reason,
        latest_inbound_message: input.latestInbound,
        conversation_excerpt: policy.attach_transcript_to_alert ? input.excerpt : input.excerpt.slice(0, 6),
        transcript_included: !!policy.attach_transcript_to_alert,
        urgency: input.urgency,
        suggested_response: input.suggestedResponse,
        resolved_offer_id: input.offerId ?? null,
        resolved_campaign_id: input.campaignId ?? null,
        runtime_trace_id: input.traceId ?? null,
        status: "open",
        alert_state: "pending",
        crm_link: crmLink(input.contactId),
      } as any)
      .select("id")
      .maybeSingle();
    handoffId = (created as any)?.id ?? null;
  }

  // --- task + attention flag ---
  let taskId: string | null = null;
  if (input.contactId) {
    const { data: task } = await supabaseAdmin
      .from("tasks")
      .insert({
        contact_id: input.contactId,
        title: `Handoff: ${input.customerName ?? input.customerPhone ?? "לקוח"} — ${input.reason}`,
        description: input.suggestedResponse ?? input.latestInbound ?? "",
        status: "open",
        priority: input.urgency === "high" ? "high" : "normal",
        source_kind: "tamar_handoff",
        source_ref_id: handoffId,
      } as any)
      .select("id")
      .maybeSingle();
    taskId = (task as any)?.id ?? null;

    await supabaseAdmin
      .from("contacts")
      .update({
        manager_attention_required: true,
        human_owned: true,
        human_owned_at: new Date().toISOString(),
        conversation_state: "human_handoff_queued",
        conversation_state_at: new Date().toISOString(),
      } as any)
      .eq("id", input.contactId);
  }

  // --- manager alert ---
  const outcome = await alertManager({ ...input, handoffId, policy });

  if (handoffId) {
    await supabaseAdmin
      .from("manager_handoffs")
      .update({
        alert_state: outcome.alert_state,
        alert_error: outcome.alert_error,
        manager_notified: outcome.alert_state === "sent",
        notified_at: outcome.alert_state === "sent" ? new Date().toISOString() : null,
        status: outcome.alert_state === "sent" ? "notified" : "open",
      } as any)
      .eq("id", handoffId);
  }

  return { handoff_id: handoffId, task_id: taskId, ...outcome };
}

async function alertManager(
  args: HandoffInput & { handoffId: string | null; policy: any },
): Promise<{ alert_state: HandoffOutcome["alert_state"]; alert_error: string | null; manager_configured: boolean }> {
  if (!args.policy.manager_alert_enabled) {
    return { alert_state: "skipped", alert_error: "manager_alert_disabled", manager_configured: true };
  }
  const target = await resolveManagerTarget();
  if (!target) {
    return { alert_state: "queued", alert_error: "manager_number_not_configured", manager_configured: false };
  }

  const summary = [
    `לקוח: ${args.customerName ?? "ללא שם"} (${args.customerPhone ?? "ללא מספר"})`,
    `סיבה: ${args.reason}`,
    `דחיפות: ${args.urgency}`,
    args.latestInbound ? `הודעה אחרונה: ${String(args.latestInbound).slice(0, 200)}` : null,
    args.suggestedResponse ? `הצעת מענה: ${args.suggestedResponse}` : null,
    `CRM: ${crmLink(args.contactId) ?? "—"}`,
  ]
    .filter(Boolean)
    .join("\n");

  const windowOpen = await managerWindowOpen(target.phone);
  if (windowOpen) {
    const res = await sendWhatsAppText(target.phone, `🔔 התראת זוגה — נדרש טיפול אנושי\n${summary}`);
    return {
      alert_state: res.ok ? "sent" : "failed",
      alert_error: res.error,
      manager_configured: true,
    };
  }

  const templateName = args.policy.manager_alert_template || "zooga_manager_handoff";
  const approved = await templateApproved(templateName);
  if (!approved) {
    // Never claim it was sent.
    return {
      alert_state: "queued",
      alert_error: `template_not_approved:${templateName}`,
      manager_configured: true,
    };
  }
  const res = await sendWhatsAppTemplate(target.phone, templateName, "he", [
    {
      type: "body",
      parameters: [
        { type: "text", text: (args.customerName ?? args.customerPhone ?? "לקוח").slice(0, 60) },
        { type: "text", text: args.reason.slice(0, 60) },
        { type: "text", text: args.urgency },
      ],
    },
  ]);
  return { alert_state: res.ok ? "sent" : "failed", alert_error: res.error, manager_configured: true };
}

/** Explicit human action: give the thread back to Tamar. */
export async function resumeTamar(contactId: string, actor: string): Promise<void> {
  await supabaseAdmin
    .from("contacts")
    .update({
      human_owned: false,
      human_owned_by: null,
      manager_attention_required: false,
      conversation_state: "consented",
      conversation_state_at: new Date().toISOString(),
    } as any)
    .eq("id", contactId);
  await supabaseAdmin.from("tamar_state_transitions" as any).insert({
    contact_id: contactId,
    from_state: "human_owned",
    to_state: "consented",
    trigger: "manual_resume",
    actor,
  } as any);
}