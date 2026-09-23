/**
 * TAMAR CANARY — handoff override (canary number ONLY).
 *
 * Operational decision: the canonical canary line must never be silenced by a
 * human-handoff freeze. Before an inbound canary turn is processed, any ACTIVE
 * operational handoff / human-ownership freeze is resolved so Tamar answers.
 *
 * Strictly bounded:
 *  - Applies to +972512277533 only (constraint checked here AND re-checked by
 *    every caller). Every other number keeps the normal manager behaviour.
 *  - Clears operational state only: open handoff rows, human ownership,
 *    manager-attention flag, queued handoff notification jobs.
 *  - Never deletes message history, CRM profile, consent/opt-out, identity,
 *    the raw event vault, audit rows or manager notes.
 *  - Loop-safe: when there is no active handoff/freeze it does nothing at all,
 *    so an ordinary canary conversation keeps its state.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { OPEN_HANDOFF_STATUSES, releaseThreadToTamar } from "@/lib/tamar-handoff-core.server";
import { quiet } from "@/lib/db-safe";
import { isCanaryPrimaryPhone } from "./config";

export const CANARY_OVERRIDE_SOURCE = "tamar_canary_gate";
export const CANARY_OVERRIDE_STATUS = "canary_handoff_override";
export const CANARY_OVERRIDE_ACTOR = "canary_auto_override";

const FROZEN_STATES = new Set(["human_owned", "human_handoff_queued"]);

export type CanaryHandoffOverrideResult = {
  applied: boolean;
  reason:
    | "not_canary"
    | "contact_not_found"
    | "no_active_handoff"
    | "handoff_cleared";
  contact_id: string | null;
  resolved_handoffs: number;
  cancelled_alerts: number;
};

const none = (reason: CanaryHandoffOverrideResult["reason"]): CanaryHandoffOverrideResult => ({
  applied: false,
  reason,
  contact_id: null,
  resolved_handoffs: 0,
  cancelled_alerts: 0,
});

/**
 * Clear an active handoff/freeze for the canary contact so this inbound turn
 * enters Tamar as clean new-inbound conversational state.
 */
export async function applyCanaryHandoffOverride(args: {
  phone: string | null | undefined;
  inboundMessageId?: string | null;
}): Promise<CanaryHandoffOverrideResult> {
  if (!isCanaryPrimaryPhone(args.phone)) return none("not_canary");

  const digits = String(args.phone ?? "").replace(/\D/g, "");
  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select("id, phone, whatsapp_number, human_owned, manager_attention_required, conversation_state")
    .or(`phone.eq.+${digits},whatsapp_number.eq.+${digits},phone.eq.${digits},whatsapp_number.eq.${digits}`)
    .limit(5);
  const contact = ((contacts as any[]) ?? [])[0] ?? null;
  if (!contact?.id) return none("contact_not_found");

  const { data: openRows } = await supabaseAdmin
    .from("manager_handoffs" as any)
    .select("id")
    .eq("contact_id", contact.id)
    .in("status", OPEN_HANDOFF_STATUSES as unknown as string[])
    .limit(50);
  const open = ((openRows as any[]) ?? []).length;
  const frozen =
    contact.human_owned === true ||
    contact.manager_attention_required === true ||
    FROZEN_STATES.has(String(contact.conversation_state ?? ""));

  // Loop-safe: only act when there is real operational handoff state.
  if (!open && !frozen) {
    return { ...none("no_active_handoff"), contact_id: contact.id };
  }

  const release = await releaseThreadToTamar({
    contactId: contact.id,
    actor: CANARY_OVERRIDE_ACTOR,
    resolveHandoffs: true,
    trigger: CANARY_OVERRIDE_STATUS,
  }).catch(() => null);

  // The turn must enter Tamar as clean new-inbound state, not "consented",
  // so the brain greets naturally instead of resuming a frozen thread.
  await quiet(
    supabaseAdmin
      .from("contacts")
      .update({
        conversation_state: "new_inbound",
        conversation_state_at: new Date().toISOString(),
        human_owned: false,
        human_owned_by: null,
        human_owned_at: null,
        manager_attention_required: false,
      } as any)
      .eq("id", contact.id),
  );

  // Pending manager notifications for this contact must not fire later.
  const { data: cancelled } = await supabaseAdmin
    .from("manager_handoffs" as any)
    .update({ alert_state: "skipped", manager_notified: false } as any)
    .eq("contact_id", contact.id)
    .in("alert_state", ["queued", "failed"])
    .select("id");

  await quiet(
    supabaseAdmin.from("webhook_logs").insert({
      source: CANARY_OVERRIDE_SOURCE,
      status: CANARY_OVERRIDE_STATUS,
      payload: {
        contact_id: contact.id,
        phone_masked: `***${digits.slice(-4)}`,
        inbound_message_id: args.inboundMessageId ?? null,
        resolved_handoffs: (release as any)?.resolved_handoffs ?? open,
        cancelled_alerts: ((cancelled as any[]) ?? []).length,
        note: "automatic canary override: operational handoff cleared, history/CRM/consent untouched",
      },
    } as any),
  );

  return {
    applied: true,
    reason: "handoff_cleared",
    contact_id: contact.id,
    resolved_handoffs: (release as any)?.resolved_handoffs ?? open,
    cancelled_alerts: ((cancelled as any[]) ?? []).length,
  };
}

/**
 * True when manager notification / manager-attention creation must be
 * suppressed for this phone. Canary only; every other number is unchanged.
 */
export function suppressManagerAlertFor(phone: unknown): boolean {
  return isCanaryPrimaryPhone(phone);
}
