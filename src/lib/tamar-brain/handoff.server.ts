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
import { toE164 } from "@/lib/whatsapp-meta.server";
import {
  ensureHandoff,
  handoffChannelHealth,
  notifyManagerForHandoff,
  resolveActiveManager,
} from "@/lib/tamar-handoff-core.server";

export { notifyManagerForHandoff, handoffChannelHealth };

export type ManagerTarget = { phone: string; source: "managers_table" | "secret" } | null;

/** Resolve the manager phone. NEVER returned to a client. */
export async function resolveManagerTarget(): Promise<ManagerTarget> {
  const m = await resolveActiveManager();
  return m ? { phone: m.phone, source: m.source } : null;
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

/**
 * Backward-compatible wrapper. All handoff logic now lives in the shared
 * core so v1 and v2 behave identically.
 */
export async function createHandoff(input: HandoffInput): Promise<HandoffOutcome> {
  const res = await ensureHandoff({ ...input, runtime: "v1" });
  return {
    handoff_id: res.handoff_id,
    task_id: res.task_id,
    alert_state: res.alert_state,
    alert_error: res.alert_error,
    manager_configured: res.manager_configured,
  };
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