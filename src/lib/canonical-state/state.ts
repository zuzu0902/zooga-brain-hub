/**
 * CANONICAL CONVERSATION STATE (PURE).
 *
 * ONE source of truth for: phase, human_owned, active_offer, the pending
 * question, the consent snapshot, last_inbound_at and the last processed
 * provider message id.
 *
 * The live engine (`contacts`) and Tamar Lite (`tamar_lite_conversations`)
 * are ADAPTERS over this shape — neither may derive a competing phase.
 */
import { activeOfferFrom, type ActiveOffer } from "@/lib/offer-catalog/active-offer";
import { isOptedOut, resolveLiteConsent } from "@/lib/tamar-lite/consent";
import type { LiteConversation, LitePhase } from "@/lib/tamar-lite/types";

export type CanonicalPhase = LitePhase | "sales_conversation";

export type ConsentSnapshot = {
  granted: boolean;
  opted_out: boolean;
  source: string | null;
  at: string | null;
};

export type CanonicalState = {
  contact_id: string;
  phase: CanonicalPhase;
  human_owned: boolean;
  active_offer: ActiveOffer | null;
  current_question_key: string | null;
  consent: ConsentSnapshot;
  last_inbound_at: string | null;
  last_processed_provider_message_id: string | null;
  version: number;
};

export type DeriveInput = {
  contact: any;
  lite?: Partial<LiteConversation> | null;
  /** ids still sellable in the canonical catalog */
  sellableOfferIds?: string[];
  /** the next missing intake question key, from the canonical resolver */
  nextQuestionKey?: string | null;
  /** this turn is a direct/sales question or an offer conversation */
  salesTurn?: boolean;
};

export function consentSnapshot(contact: any): ConsentSnapshot {
  return {
    granted: resolveLiteConsent(contact),
    opted_out: isOptedOut(contact),
    source:
      contact?.whatsapp_opt_in_source ??
      (contact?.consent_status === "granted" ? "consent_status" : null) ??
      (contact?.consent_marketing ? "consent_marketing" : null),
    at: contact?.whatsapp_opt_in_at ?? contact?.consent_granted_at ?? null,
  };
}

/** The locked offer, kept ONLY while it is still sellable. */
export function canonicalActiveOffer(contact: any, sellableOfferIds?: string[]): ActiveOffer | null {
  const active = activeOfferFrom(contact);
  if (!active) return null;
  if (sellableOfferIds && !sellableOfferIds.includes(active.offer_id)) return null;
  return active;
}

/**
 * Fixed precedence — identical for live and lite:
 * opted_out > human_owned > awaiting_consent > sales conversation
 * (active offer / direct sales turn) > intake > sales_ready.
 */
export function deriveCanonicalState(input: DeriveInput): CanonicalState {
  const c = input.contact ?? {};
  const lite = input.lite ?? {};
  const consent = consentSnapshot(c);
  const active = canonicalActiveOffer(c, input.sellableOfferIds);
  const humanOwned = !!c.human_owned || !!lite.human_owned;

  let phase: CanonicalPhase;
  if (consent.opted_out) phase = "opted_out";
  else if (humanOwned) phase = "human_owned";
  else if (!consent.granted) phase = "awaiting_consent";
  else if (active || input.salesTurn) phase = "sales_conversation";
  else if (input.nextQuestionKey) phase = "intake";
  else phase = "sales_ready";

  return {
    contact_id: String(c.id ?? lite.contact_id ?? ""),
    phase,
    human_owned: humanOwned,
    active_offer: active,
    current_question_key: phase === "intake" ? (input.nextQuestionKey ?? null) : null,
    consent,
    last_inbound_at: c.last_inbound_at ?? c.last_interaction_at ?? null,
    last_processed_provider_message_id:
      lite.last_inbound_wamid ?? c.last_processed_provider_message_id ?? null,
    version: typeof lite.version === "number" ? lite.version : 0,
  };
}

/** Adapter: canonical -> tamar_lite_conversations shape. */
export function toLiteConversation(state: CanonicalState, prev?: Partial<LiteConversation>): LiteConversation {
  return {
    contact_id: state.contact_id,
    phase: state.phase as LitePhase,
    current_question_key: state.current_question_key,
    version: state.version,
    last_inbound_wamid: state.last_processed_provider_message_id,
    last_outbound_key: prev?.last_outbound_key ?? null,
    human_owned: state.human_owned,
  };
}

/** Adapter: canonical -> the live `contacts` conversation_state value. */
export function toLiveConversationState(state: CanonicalState): string {
  switch (state.phase) {
    case "opted_out":
      return "opted_out";
    case "human_owned":
      return "human_owned";
    case "awaiting_consent":
      return "consent_pending";
    case "sales_conversation":
      return "offer_recommended";
    case "intake":
      return "intake_active";
    case "closed":
      return "closed";
    default:
      return "value_delivery";
  }
}

/** Live and Lite must never disagree. */
export function statesAgree(a: CanonicalState, b: CanonicalState): boolean {
  return (
    a.phase === b.phase &&
    a.human_owned === b.human_owned &&
    (a.active_offer?.offer_id ?? null) === (b.active_offer?.offer_id ?? null) &&
    a.current_question_key === b.current_question_key
  );
}