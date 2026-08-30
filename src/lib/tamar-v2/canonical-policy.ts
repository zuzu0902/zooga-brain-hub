/**
 * TAMAR V2 — CANONICAL CONVERSATION CONTRACT (PURE, no I/O).
 *
 * ONE priority ladder for every inbound turn. It replaces the previous
 * layered stack of competing branches (solo-policy reply, re-engagement
 * reply, intake appender, recommendation composer, fallback copy), each of
 * which could override the current inbound meaning.
 *
 * Priorities, highest to lowest:
 *   1. current inbound meaning (text or normalized voice transcript)
 *   2. explicit control action: reset / consent / opt-out / human handoff
 *   3. explicit current product-or-support request (price, route, dates,
 *      inclusions, accessibility, registration/payment link)
 *   4. answer from the active offer + verified product facts
 *   5. exactly one intake question (subordinate, never appended to 3/4)
 *   6. recommendations, only on an explicit request or browse with no active offer
 *   7. safe clarification / error
 */

export const CANONICAL_POLICY_VERSION = "canonical.1";

export type CanonicalAction =
  | "control"
  | "verified_link"
  | "product_answer"
  | "intake_question"
  | "recommend"
  | "clarify"
  | "safe_error";

export type CanonicalSelection = {
  policy_version: string;
  /** the single selected action for this turn */
  action: CanonicalAction;
  /** priority tier that won (1..7) */
  tier: number;
  /** the verified-link action is terminal: nothing may be appended */
  terminal: boolean;
  offer_id: string | null;
  /** legacy branches deliberately not run this turn */
  ignored_legacy_paths: string[];
  reasons: string[];
};

/** Map the sub-selector's action names onto the canonical vocabulary. */
function fromOrchestrator(action: string): CanonicalAction {
  switch (action) {
    case "recommend_products":
      return "recommend";
    case "provide_verified_registration_or_payment_link":
      return "verified_link";
    case "ask_one_clarifying_question":
      return "clarify";
    case "answer_and_ask_one_intake_question":
      return "intake_question";
    case "handoff":
    case "consent_step":
      return "control";
    case "safe_error":
      return "safe_error";
    default:
      return "product_answer";
  }
}

export function selectCanonicalPolicy(i: {
  controlPath: string | null;
  currentAsk: { price: boolean; route: boolean; link: boolean; any: boolean };
  explicitRecommendationRequest: boolean;
  activeOfferId: string | null;
  activeOfferUrl: string | null;
  orchestratorAction: string;
  orchestratorApplies: boolean;
}): CanonicalSelection {
  const ignored: string[] = [];
  const reasons: string[] = [];

  // Tier 1 is not an action but a constraint: whenever the CURRENT message
  // carries a product/support request, no older-topic branch may run.
  if (i.currentAsk.any) {
    ignored.push("solo_policy_reply", "reengagement_reply", "stale_pending_question");
    reasons.push("current_inbound_product_request");
  }

  // Tier 2 — explicit control actions.
  if (i.controlPath) {
    return {
      policy_version: CANONICAL_POLICY_VERSION,
      action: "control",
      tier: 2,
      terminal: true,
      offer_id: null,
      ignored_legacy_paths: [...ignored, "generative_plan"],
      reasons: [...reasons, `control_${i.controlPath}`],
    };
  }

  // Tier 3 — an explicit current link request is answered with the verified
  // link of the active/resolved offer, and is terminal.
  if (i.currentAsk.link && i.activeOfferUrl && !i.explicitRecommendationRequest) {
    return {
      policy_version: CANONICAL_POLICY_VERSION,
      action: "verified_link",
      tier: 3,
      terminal: true,
      offer_id: i.activeOfferId,
      ignored_legacy_paths: [...ignored, "intake_appender", "recommendation_composer"],
      reasons: [...reasons, "explicit_current_link_request"],
    };
  }

  // Tiers 4..7 — the existing single-action selector, re-labelled.
  const action = fromOrchestrator(i.orchestratorAction);
  const tier = action === "recommend" ? 6 : action === "intake_question" ? 5 : action === "clarify" || action === "safe_error" ? 7 : 4;
  if (action !== "intake_question") ignored.push("intake_appender");
  if (action !== "recommend") ignored.push("recommendation_composer");
  return {
    policy_version: CANONICAL_POLICY_VERSION,
    action,
    tier,
    terminal: action !== "intake_question",
    offer_id: i.activeOfferId,
    ignored_legacy_paths: ignored,
    reasons: [...reasons, `selector_${i.orchestratorAction}`, i.orchestratorApplies ? "selector_applies" : "selector_delegated"],
  };
}

/**
 * Deterministic, complete, subject-first verified-link answer. Only the link
 * of the selected offer may appear; no intake question, no alternatives.
 */
export function buildVerifiedLinkAnswer(args: {
  title: string | null;
  url: string;
  answerText?: string | null;
}): string {
  const base = String(args.answerText ?? "").trim();
  const title = String(args.title ?? "").trim();
  if (base) return `${base}\n${args.url}`;
  return title
    ? `הנה הקישור לעמוד של ${title}, שם יש את כל הפרטים וההרשמה:\n${args.url}`
    : `הנה הקישור עם כל הפרטים וההרשמה:\n${args.url}`;
}
