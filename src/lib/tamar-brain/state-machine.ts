/**
 * TAMAR BRAIN v1 — deterministic conversation state machine.
 *
 * This layer is SERVER-AUTHORITATIVE and IDEMPOTENT. The AI agent never
 * changes state directly; it only proposes actions inside the boundaries
 * this machine allows. Safety (consent), compliance (opt-out) and human
 * ownership (handoff freeze) are decided here, never by the model.
 */

export type ConversationState =
  | "consent_pending"
  | "consented"
  | "opted_out"
  | "intake_active"
  | "value_delivery"
  | "offer_recommended"
  | "human_handoff_queued"
  | "human_owned"
  | "paused"
  | "closed";

export const CONVERSATION_STATES: ConversationState[] = [
  "consent_pending",
  "consented",
  "opted_out",
  "intake_active",
  "value_delivery",
  "offer_recommended",
  "human_handoff_queued",
  "human_owned",
  "paused",
  "closed",
];

/** States in which no automated marketing/intake/offer may be produced. */
export const AUTOMATION_BLOCKED_STATES: ConversationState[] = [
  "opted_out",
  "human_handoff_queued",
  "human_owned",
  "paused",
];

/** States in which marketing content (offers, promos) is allowed at all. */
export function marketingAllowed(state: ConversationState | null): boolean {
  if (!state) return false;
  return (
    state === "consented" ||
    state === "intake_active" ||
    state === "value_delivery" ||
    state === "offer_recommended"
  );
}

const ALLOWED: Record<ConversationState, ConversationState[]> = {
  consent_pending: ["consented", "opted_out", "human_handoff_queued", "human_owned", "paused", "closed", "consent_pending"],
  consented: ["intake_active", "value_delivery", "offer_recommended", "opted_out", "human_handoff_queued", "human_owned", "paused", "closed", "consented"],
  intake_active: ["value_delivery", "offer_recommended", "opted_out", "human_handoff_queued", "human_owned", "paused", "closed", "intake_active"],
  value_delivery: ["intake_active", "offer_recommended", "opted_out", "human_handoff_queued", "human_owned", "paused", "closed", "value_delivery"],
  offer_recommended: ["intake_active", "value_delivery", "opted_out", "human_handoff_queued", "human_owned", "paused", "closed", "offer_recommended"],
  human_handoff_queued: ["human_owned", "opted_out", "paused", "closed", "human_handoff_queued"],
  // Only an explicit human action ("Resume Tamar") leaves human_owned.
  human_owned: ["consented", "intake_active", "value_delivery", "offer_recommended", "closed", "opted_out", "human_owned"],
  paused: ["consented", "intake_active", "human_handoff_queued", "human_owned", "opted_out", "closed", "paused"],
  // opt-in is the ONLY way out of opted_out.
  opted_out: ["consent_pending", "consented", "opted_out"],
  closed: ["consented", "intake_active", "human_handoff_queued", "human_owned", "opted_out", "closed"],
};

export type TransitionResult = {
  allowed: boolean;
  from: ConversationState;
  to: ConversationState;
  /** true when from === to; still "allowed" but nothing changed. */
  noop: boolean;
  reason: string;
};

/** Pure, idempotent transition check. */
export function canTransition(
  from: ConversationState | null | undefined,
  to: ConversationState,
): TransitionResult {
  const current: ConversationState = from ?? "consent_pending";
  if (current === to) {
    return { allowed: true, from: current, to, noop: true, reason: "noop" };
  }
  const allowed = (ALLOWED[current] ?? []).includes(to);
  return {
    allowed,
    from: current,
    to,
    noop: false,
    reason: allowed ? "allowed" : `illegal_transition_${current}_to_${to}`,
  };
}

/**
 * Derive the state a contact should currently be in from durable columns.
 * Never guesses consent: an unknown contact stays consent_pending.
 */
export function deriveState(contact: any): ConversationState {
  if (!contact) return "consent_pending";
  if (contact.human_owned) return "human_owned";
  if (contact.opted_out_at) return "opted_out";
  const stored = contact.conversation_state as ConversationState | null;
  if (stored && CONVERSATION_STATES.includes(stored)) return stored;
  if (contact.consent_marketing === true) return "consented";
  return "consent_pending";
}

/** Automation gate: may Tamar generate ANY automated reply in this state? */
export function automationFrozen(state: ConversationState): boolean {
  return state === "human_owned" || state === "human_handoff_queued" || state === "paused";
}