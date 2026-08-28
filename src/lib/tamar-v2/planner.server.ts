/**
 * TAMAR BRAIN V2 — structured conversation planning pass (server-only).
 *
 * Cost-aware by construction:
 *  - deterministic turns (reset, consent buttons, opt-out, frozen threads,
 *    offline runs) never call the planner at all;
 *  - a normal conversational turn runs on the cheapest capable model;
 *  - exactly ONE escalation happens for an ambiguous/sensitive turn or after
 *    a structured-output/validation failure.
 *
 * The model output is a proposal. `validatePlan` is the authority: a rejected
 * plan is replaced by the deterministic plan and the violations are logged.
 */
import { callStage } from "./model-registry.server";
import {
  deterministicPlan,
  parsePlan,
  validatePlan,
  type PlanValidationContext,
  type TurnPlan,
} from "./planner";
import type { ContextPackage } from "./context";

const SYSTEM = `You are the PLANNER of "Tamar", the Hebrew WhatsApp agent of the Zooga community.
You do NOT write the customer message. You produce ONE structured plan for this turn.
Return ONLY JSON with this exact shape:
{"intent":string,"direct_answer_needed":boolean,"active_topic":string|null,"active_offer_id":string|null,"cited_offer_ids":[string],"cited_source_ids":[string],"facts_required":[string],"intake_known":[string],"intake_missing":[string],"ask_intake_question":boolean,"intake_question_key":string|null,"journey_stage":string,"next_best_action":"answer"|"answer_and_ask"|"ask_intake"|"recommend"|"handoff"|"acknowledge"|"wait","confidence":0-100,"rationale":string}
Hard rules:
- Answer the customer's actual question first. Never change topic.
- active_offer_id MUST stay the context's active offer unless the customer explicitly named another offer in THIS message.
- Only cite offer ids and source ids that appear in the provided context. Never invent an id.
- Never plan an intake question that already appears in intake.answered. At most one question.
- Never plan a generic recommendation. Recommend only a genuine, cited match, and never instead of answering.
- facts_required may only list fact keys present in the active offer facts/knowledge.`;

export type PlanOutcome = {
  plan: TurnPlan;
  accepted: boolean;
  violations: string[];
  /** "skipped" when no model call was made at all */
  routing: "skipped" | "planned" | "escalated" | "rejected_fallback" | "model_failed";
  model_id: string | null;
};

function planPrompt(ctx: ContextPackage, catalog: Array<{ id: string; title: string }>): string {
  return JSON.stringify({
    inbound: ctx.inbound,
    journey_stage: ctx.journey_stage,
    active: ctx.active,
    active_offer: ctx.active_offer,
    transcript: ctx.transcript.slice(-10),
    facts: ctx.facts.slice(0, 20),
    memories: ctx.memories.slice(0, 10),
    intake: ctx.intake,
    commitments: ctx.commitments,
    offers_presented: ctx.offers_presented,
    catalog: catalog.slice(0, 10),
    knowledge: ctx.knowledge,
  });
}

/**
 * One structured planning pass. `fallback` is used whenever the planner is
 * skipped, fails, or is rejected by deterministic validation.
 */
export async function planTurn(args: {
  ctx: ContextPackage;
  validation: PlanValidationContext;
  fallback: ReturnType<typeof deterministicPlan>;
  catalog: Array<{ id: string; title: string }>;
  complexity: "simple" | "complex";
  /** false => no model call at all (deterministic turn) */
  enabled: boolean;
}): Promise<PlanOutcome> {
  if (!args.enabled) {
    return { plan: args.fallback, accepted: true, violations: [], routing: "skipped", model_id: null };
  }

  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: planPrompt(args.ctx, args.catalog) },
  ];

  const res = await callStage("conversation_planner", messages, {
    json: true,
    context: "planner",
    complexity: args.complexity,
  });
  let parsed = parsePlan(res.ok ? res.content : null);
  let modelId: string | null = res.model_id;
  let routing: PlanOutcome["routing"] = "planned";

  let checked = parsed ? validatePlan(parsed, args.validation) : null;
  if (!parsed || !checked?.ok) {
    // Exactly one escalation: ambiguous/invalid structure gets the strong model.
    const retry = await callStage("conversation_planner", messages, {
      json: true,
      context: "planner_validation_retry",
      complexity: "complex",
      validationRetry: true,
    });
    const retryPlan = parsePlan(retry.ok ? retry.content : null);
    if (retryPlan) {
      const retryChecked = validatePlan(retryPlan, args.validation);
      if (retryChecked.ok) {
        return { plan: retryPlan, accepted: true, violations: [], routing: "escalated", model_id: retry.model_id };
      }
      parsed = retryPlan;
      checked = retryChecked;
      modelId = retry.model_id;
    }
    routing = parsed ? "rejected_fallback" : "model_failed";
    return {
      plan: args.fallback,
      accepted: false,
      violations: checked?.violations ?? ["plan_unparsable"],
      routing,
      model_id: modelId,
    };
  }

  return { plan: parsed, accepted: true, violations: [], routing, model_id: modelId };
}
