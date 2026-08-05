/**
 * TAMAR BRAIN V2 — deterministic state machine (pure).
 * The model can never write a state; only this table decides legality.
 */
import { normalizeState, type V2State } from "./types";

const ALLOWED: Record<V2State, V2State[]> = {
  new_inbound: ["consent_asked", "human_handoff_queued", "human_owned", "opted_out", "closed", "new_inbound"],
  consent_asked: ["consented", "intake_active", "opted_out", "human_handoff_queued", "human_owned", "paused", "closed", "consent_asked"],
  consented: ["intake_active", "recommendation_ready", "value_delivered", "opted_out", "human_handoff_queued", "human_owned", "paused", "closed", "consented"],
  intake_active: ["recommendation_ready", "value_delivered", "opted_out", "human_handoff_queued", "human_owned", "paused", "closed", "intake_active"],
  recommendation_ready: ["value_delivered", "intake_active", "opted_out", "human_handoff_queued", "human_owned", "paused", "closed", "recommendation_ready"],
  value_delivered: ["intake_active", "recommendation_ready", "opted_out", "human_handoff_queued", "human_owned", "paused", "closed", "value_delivered"],
  human_handoff_queued: ["human_owned", "opted_out", "paused", "closed", "human_handoff_queued"],
  human_owned: ["consented", "intake_active", "value_delivered", "recommendation_ready", "opted_out", "closed", "human_owned"],
  opted_out: ["consent_asked", "consented", "opted_out"],
  paused: ["consented", "intake_active", "human_handoff_queued", "human_owned", "opted_out", "closed", "paused"],
  closed: ["consented", "intake_active", "consent_asked", "human_handoff_queued", "human_owned", "opted_out", "closed"],
};

export type TransitionCheck = { allowed: boolean; noop: boolean; from: V2State; to: V2State; reason: string };

export function canTransition(from: V2State | null | undefined, to: V2State): TransitionCheck {
  const current = from ?? "new_inbound";
  if (current === to) return { allowed: true, noop: true, from: current, to, reason: "noop" };
  const allowed = (ALLOWED[current] ?? []).includes(to);
  return {
    allowed,
    noop: false,
    from: current,
    to,
    reason: allowed ? "allowed" : `illegal_transition_${current}_to_${to}`,
  };
}

/** Automation is completely frozen — Tamar produces nothing. */
export function automationFrozen(state: V2State): boolean {
  return state === "human_owned" || state === "human_handoff_queued" || state === "paused";
}

/** Marketing (offers, promos, links to paid products) is allowed at all. */
export function marketingAllowed(state: V2State): boolean {
  return state === "consented" || state === "intake_active" || state === "recommendation_ready" || state === "value_delivered";
}

/**
 * Derive the state from durable contact columns.
 * Backward compatible with v1 rows: a contact that was never asked for
 * consent is `new_inbound`, so the very first inbound gets the full opener
 * instead of being treated as an ambiguous consent reply.
 */
export function deriveState(contact: any): V2State {
  if (!contact) return "new_inbound";
  if (contact.human_owned) return "human_owned";
  if (contact.opted_out_at) return "opted_out";
  const stored = normalizeState(contact.conversation_state ?? null);
  if (stored === "consent_asked" && !contact.consent_asked_at && contact.consent_marketing !== true) {
    return "new_inbound";
  }
  if (stored) return stored;
  if (contact.consent_marketing === true) return "consented";
  return contact.consent_asked_at ? "consent_asked" : "new_inbound";
}
