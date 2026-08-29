/**
 * TAMAR V2 — SINGLE RESPONSE ORCHESTRATOR (PURE, no I/O).
 *
 * Architectural correction of the production defect where a correct grounded
 * London answer was followed by unrelated Dubai/Vietnam recommendations:
 * several independent composers (grounded answer, recommendation block,
 * intake appender, plan fallback) each contributed text to the same turn.
 *
 * From here on exactly ONE primary action is selected per inbound turn and
 * exactly ONE response payload is composed from it. No downstream layer may
 * append recommendations, offers, intake questions, CTAs or fallback copy
 * after finalization.
 */

export const ORCHESTRATOR_VERSION = "sro.1";

export const RESPONSE_ACTIONS = [
  "answer",
  "answer_and_ask_one_intake_question",
  "ask_one_clarifying_question",
  "recommend_products",
  "provide_verified_registration_or_payment_link",
  "handoff",
  "consent_step",
  "safe_error",
] as const;
export type ResponseAction = (typeof RESPONSE_ACTIONS)[number];

export type OrchestratorInput = {
  message: string;
  isQuestion: boolean;
  intent: string;
  wantsHuman: boolean;
  /** canonical conversation state */
  state: string;
  resetRequested: boolean;
  /** grounding path already produced by the deterministic pre-checks */
  groundingPath: string;
  /** the grounded answer text, when one exists */
  answerText: string | null;
  activeOfferId: string | null;
  resolvedOfferId: string | null;
  /** a model plan that PASSED deterministic validation */
  planValid: boolean;
  planAskIntake: boolean;
  planIntakeKey: string | null;
  missingIntakeKeys: string[];
  catalogSize: number;
  marketingAllowed: boolean;
  /** the offer record exposes a verified registration/payment url */
  hasVerifiedLink: boolean;
};

export type OrchestratorDecision = {
  action: ResponseAction;
  /** the orchestrator owns composition for this turn */
  applies: boolean;
  offer_ids: string[];
  intake_key: string | null;
  /** the ONLY case in which offers may be listed */
  recommendation_allowed: boolean;
  reasons: string[];
};

/**
 * The customer explicitly asked for options/alternatives. Naming a single
 * destination ("רוצה לנסוע ללונדון") is NEVER permission to list others.
 */
const EXPLICIT_RECOMMENDATION_RE =
  /(מה\s*עוד|עוד\s*אפשרויות|אפשרויות\s*נוספות|אפשרויות\s*אחרות|הצעות\s*נוספות|הצעות\s*אחרות|מה\s*יש\s*לכם|מה\s*יש\s*עוד|אילו\s*(טיולים|אירועים|הצעות)|איזה\s*(טיולים|אירועים|הצעות)|חוץ\s*מ|במקום\s*זה|תציעי|תמליצי|המלצות)/;

const EXPLICIT_LINK_RE = /(קישור|לינק|להירשם|הרשמה|לרשום|לשלם|תשלום\s*מקוון|איך\s*נרשמים)/;

export function asksForRecommendations(message: string): boolean {
  return EXPLICIT_RECOMMENDATION_RE.test(String(message ?? ""));
}

export function asksForVerifiedLink(message: string): boolean {
  return EXPLICIT_LINK_RE.test(String(message ?? ""));
}

/** Turns whose composition stays with the existing deterministic policy. */
const DELEGATED_STATES = new Set([
  "new_inbound",
  "consent_asked",
  "human_owned",
  "human_handoff_queued",
  "opted_out",
]);

/**
 * Select EXACTLY ONE primary action for the turn.
 *
 * `applies: false` means the canonical deterministic policy (consent,
 * handoff, reset, terminal grounding) owns the turn — those paths already
 * produce exactly one envelope and are deliberately left unchanged.
 */
export function selectResponseAction(i: OrchestratorInput): OrchestratorDecision {
  const reasons: string[] = [];
  const base = {
    applies: false,
    offer_ids: [] as string[],
    intake_key: null as string | null,
    recommendation_allowed: false,
  };

  if (DELEGATED_STATES.has(i.state)) {
    const consent = i.state === "new_inbound" || i.state === "consent_asked";
    return {
      ...base,
      action: consent ? "consent_step" : "handoff",
      reasons: [`delegated_state_${i.state}`],
    };
  }
  if (i.wantsHuman || i.groundingPath.startsWith("product_handoff")) {
    return { ...base, action: "handoff", reasons: ["handoff_path"] };
  }
  if (i.resetRequested) {
    return { ...base, action: "answer", reasons: ["conversation_reset"] };
  }
  if (
    i.groundingPath === "offer_clarification" ||
    i.groundingPath === "voice_clarification"
  ) {
    return { ...base, action: "ask_one_clarifying_question", reasons: [`terminal_${i.groundingPath}`] };
  }
  if (i.groundingPath === "sensitive_verification_required") {
    return { ...base, action: "answer", reasons: ["terminal_sensitive_verification"] };
  }

  // ---- Recommendations: permitted ONLY on an explicit request, or when
  //      there is no active offer and recommending IS the primary action.
  const explicitRecommendation = asksForRecommendations(i.message);
  const browsing = i.intent === "browse_offers" || i.intent === "offer_interest";
  const mayRecommend = i.marketingAllowed && i.catalogSize > 0;
  if (mayRecommend && explicitRecommendation) {
    reasons.push("explicit_recommendation_request");
    return { ...base, applies: true, action: "recommend_products", recommendation_allowed: true, reasons };
  }
  if (mayRecommend && !i.activeOfferId && !i.resolvedOfferId && browsing) {
    reasons.push("no_active_offer_browse_intent");
    return { ...base, applies: true, action: "recommend_products", recommendation_allowed: true, reasons };
  }

  if (i.answerText) {
    const offerIds = [i.resolvedOfferId ?? i.activeOfferId].filter(Boolean) as string[];
    if (asksForVerifiedLink(i.message) && i.hasVerifiedLink) {
      reasons.push("explicit_link_request");
      return {
        ...base,
        applies: true,
        action: "provide_verified_registration_or_payment_link",
        offer_ids: offerIds,
        reasons,
      };
    }
    // Intake is SUBORDINATE: at most one question, only inside this action,
    // and only when a validated plan actually asked for it.
    const key = i.planIntakeKey;
    if (i.planValid && i.planAskIntake && key && i.missingIntakeKeys.includes(key)) {
      reasons.push("answer_first_then_one_intake");
      return {
        ...base,
        applies: true,
        action: "answer_and_ask_one_intake_question",
        offer_ids: offerIds,
        intake_key: key,
        reasons,
      };
    }
    reasons.push(i.isQuestion ? "answer_direct_question" : "answer_grounded_statement");
    return { ...base, applies: true, action: "answer", offer_ids: offerIds, reasons };
  }

  // No grounded answer: the deterministic policy (intake question, ack,
  // honest no-offer) owns the turn. It may NEVER append a catalog because
  // recommendation was not the selected action.
  return { ...base, action: i.missingIntakeKeys.length ? "answer_and_ask_one_intake_question" : "safe_error", reasons: ["no_grounded_answer_delegated"] };
}
