/**
 * TAMAR BRAIN V2 — structured conversation planner (PURE, no I/O).
 *
 * ONE structured planning pass runs over the canonical context package and
 * produces a machine-checkable plan for the turn. The plan is a PROPOSAL:
 * deterministic validation below is the authority, and a plan that breaks a
 * safety/grounding rule is rejected and replaced by the deterministic plan.
 *
 * The planner never writes state, never moves the active focus, never picks
 * an offer that was not grounded in the context package, and never invents a
 * fact. It exists so that composition uses ONE coherent decision instead of
 * the old narrow interpreter behaviour that appended stale recommendations.
 */

export const PLAN_ACTIONS = [
  "answer",
  "answer_and_ask",
  "ask_intake",
  "recommend",
  "handoff",
  "acknowledge",
  "wait",
] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];

export type TurnPlan = {
  intent: string;
  direct_answer_needed: boolean;
  /** the topic/offer the turn is about — proposal only, focus rules decide */
  active_topic: string | null;
  active_offer_id: string | null;
  cited_offer_ids: string[];
  cited_source_ids: string[];
  /** facts the answer depends on (keys, never free invention) */
  facts_required: string[];
  intake_known: string[];
  intake_missing: string[];
  ask_intake_question: boolean;
  intake_question_key: string | null;
  journey_stage: string;
  next_best_action: PlanAction;
  confidence: number;
  rationale: string;
  source: "model" | "deterministic";
};

export type PlanValidationContext = {
  /** authoritative focus BEFORE this turn */
  focusOfferId: string | null;
  /** every offer id the context package legitimately exposes */
  allowedOfferIds: string[];
  /** every knowledge/source id retrieved for this turn */
  allowedSourceIds: string[];
  /** intake keys already answered — asking them again is a defect */
  answeredIntakeKeys: string[];
  /** intake keys still missing */
  missingIntakeKeys: string[];
  /** grounded fact keys available for the active offer */
  groundedFactKeys: string[];
  /** the customer explicitly named another offer this turn */
  explicitMention?: boolean;
  /** a referential phrase was successfully resolved this turn */
  resolvedReference?: boolean;
  resetRequested?: boolean;
};

export type PlanValidation = {
  ok: boolean;
  violations: string[];
  plan: TurnPlan;
};

const str = (v: unknown, max = 200): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const strList = (v: unknown, max = 10): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean).slice(0, max) : [];

/** Parse the model's JSON. Returns null on anything malformed. */
export function parsePlan(raw: string | null): TurnPlan | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const j = JSON.parse(match[0]) as Record<string, any>;
    const action = String(j["next_best_action"] ?? "");
    return {
      intent: str(j["intent"] ?? "unknown", 60) || "unknown",
      direct_answer_needed: !!j["direct_answer_needed"],
      active_topic: j["active_topic"] ? str(j["active_topic"], 120) : null,
      active_offer_id: j["active_offer_id"] ? str(j["active_offer_id"], 80) : null,
      cited_offer_ids: strList(j["cited_offer_ids"], 5),
      cited_source_ids: strList(j["cited_source_ids"], 8),
      facts_required: strList(j["facts_required"], 10),
      intake_known: strList(j["intake_known"], 20),
      intake_missing: strList(j["intake_missing"], 20),
      ask_intake_question: !!j["ask_intake_question"],
      intake_question_key: j["intake_question_key"] ? str(j["intake_question_key"], 60) : null,
      journey_stage: str(j["journey_stage"] ?? "", 40),
      next_best_action: (PLAN_ACTIONS as readonly string[]).includes(action)
        ? (action as PlanAction)
        : "acknowledge",
      confidence: Math.max(0, Math.min(100, Number(j["confidence"] ?? 50))),
      rationale: str(j["rationale"], 400),
      source: "model",
    };
  } catch {
    return null;
  }
}

/**
 * The deterministic plan. Used when the planner is skipped, fails, or is
 * rejected — a turn is never lost because the planner misbehaved.
 */
export function deterministicPlan(args: {
  intent: string;
  isQuestion: boolean;
  focusOfferId: string | null;
  focusTitle?: string | null;
  missingIntakeKeys: string[];
  answeredIntakeKeys: string[];
  journeyStage: string;
  wantsHuman?: boolean;
}): TurnPlan {
  const action: PlanAction = args.wantsHuman
    ? "handoff"
    : args.isQuestion
      ? "answer"
      : args.missingIntakeKeys.length
        ? "ask_intake"
        : "acknowledge";
  return {
    intent: args.intent || "unknown",
    direct_answer_needed: args.isQuestion,
    active_topic: args.focusTitle ?? null,
    active_offer_id: args.focusOfferId,
    cited_offer_ids: args.focusOfferId ? [args.focusOfferId] : [],
    cited_source_ids: [],
    facts_required: [],
    intake_known: args.answeredIntakeKeys.slice(0, 20),
    intake_missing: args.missingIntakeKeys.slice(0, 20),
    ask_intake_question: !args.isQuestion && !args.wantsHuman && args.missingIntakeKeys.length > 0,
    intake_question_key: !args.isQuestion ? (args.missingIntakeKeys[0] ?? null) : null,
    journey_stage: args.journeyStage,
    next_best_action: action,
    confidence: 60,
    rationale: "deterministic_plan",
    source: "deterministic",
  };
}

/**
 * Deterministic validation. A plan is REJECTED (ok=false) when it:
 *  - cites an offer or source id that is unknown / unrelated to this turn
 *  - moves the active focus without an explicit mention, a resolved
 *    reference or an explicit reset
 *  - asks an intake question the customer already answered
 *  - appends a recommendation that the turn does not justify
 *  - depends on facts that are not grounded in the context package
 */
export function validatePlan(plan: TurnPlan, ctx: PlanValidationContext): PlanValidation {
  const violations: string[] = [];
  const allowedOffers = new Set(ctx.allowedOfferIds.filter(Boolean).map(String));
  const allowedSources = new Set(ctx.allowedSourceIds.filter(Boolean).map(String));
  const answered = new Set(ctx.answeredIntakeKeys.map(String));

  for (const id of plan.cited_offer_ids) {
    if (!allowedOffers.has(id)) violations.push(`unknown_offer_id:${id}`);
  }
  for (const id of plan.cited_source_ids) {
    if (!allowedSources.has(id)) violations.push(`unknown_source_id:${id}`);
  }

  if (plan.active_offer_id && plan.active_offer_id !== ctx.focusOfferId) {
    const mayMove = !!ctx.explicitMention || !!ctx.resetRequested || (!ctx.focusOfferId && !!ctx.resolvedReference);
    if (!mayMove) violations.push("focus_change_not_allowed");
    else if (!allowedOffers.has(plan.active_offer_id)) violations.push("focus_change_unknown_offer");
  }

  if (plan.ask_intake_question) {
    const key = plan.intake_question_key;
    if (!key) violations.push("intake_question_without_key");
    else if (answered.has(key)) violations.push(`repeats_known_intake:${key}`);
    else if (!ctx.missingIntakeKeys.includes(key)) violations.push(`intake_key_not_missing:${key}`);
  }

  if (plan.next_best_action === "recommend") {
    // A recommendation is legitimate only as a genuine, cited match, and
    // never instead of answering the customer's actual question.
    if (plan.direct_answer_needed) violations.push("recommendation_before_answer");
    if (!plan.cited_offer_ids.length) violations.push("generic_recommendation");
  }

  if (plan.facts_required.length && ctx.groundedFactKeys.length >= 0) {
    const grounded = new Set(ctx.groundedFactKeys.map(String));
    const unsupported = plan.facts_required.filter((f) => !grounded.has(f));
    if (unsupported.length) violations.push(`unsupported_facts:${unsupported.slice(0, 3).join("|")}`);
  }

  return { ok: violations.length === 0, violations, plan };
}

/** At most one intake question and one envelope: composition contract. */
export function planComposition(plan: TurnPlan): {
  terminal: boolean;
  askIntake: boolean;
  allowRecommendation: boolean;
} {
  const askIntake = plan.ask_intake_question && plan.next_best_action !== "handoff";
  const terminal = plan.direct_answer_needed && !askIntake;
  return {
    terminal,
    askIntake,
    allowRecommendation: plan.next_best_action === "recommend" && !plan.direct_answer_needed,
  };
}
