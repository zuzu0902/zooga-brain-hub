import { describe, expect, it } from "vitest";
import { buildContextPackage, contextSourceCounts } from "../context";
import { deterministicPlan, parsePlan, planComposition, validatePlan, type TurnPlan } from "../planner";

const BAKU = "11111111-1111-1111-1111-111111111111";
const VIETNAM = "22222222-2222-2222-2222-222222222222";

const basePlan = (over: Partial<TurnPlan> = {}): TurnPlan => ({
  ...deterministicPlan({
    intent: "question",
    isQuestion: true,
    focusOfferId: BAKU,
    focusTitle: "באקו",
    missingIntakeKeys: ["budget"],
    answeredIntakeKeys: ["city"],
    journeyStage: "value_delivery",
  }),
  source: "model",
  ...over,
});

const ctx = {
  focusOfferId: BAKU,
  allowedOfferIds: [BAKU],
  allowedSourceIds: ["src-1"],
  answeredIntakeKeys: ["city"],
  missingIntakeKeys: ["budget"],
  groundedFactKeys: ["title", "price"],
};

describe("context package carries the current inbound turn", () => {
  it("keeps the raw transcript and the normalized text distinct", () => {
    const pkg = buildContextPackage({
      state: "value_delivery",
      inbound: {
        messageId: "wamid.ABC",
        source: "whatsapp_voice",
        rawText: "ספרי לי על בקבוק",
        normalizedText: "ספרי לי על באקו",
        normalization: { changed: true, ambiguous: false, reason: "domain_term", confidence: 0.9 },
      },
    });
    expect(pkg.inbound.message_id).toBe("wamid.ABC");
    expect(pkg.inbound.raw_text).toBe("ספרי לי על בקבוק");
    expect(pkg.inbound.normalized_text).toBe("ספרי לי על באקו");
    expect(pkg.inbound.is_voice).toBe(true);
    expect(pkg.inbound.normalization?.changed).toBe(true);
    expect(contextSourceCounts(pkg).inbound).toBe(1);
  });

  it("does not duplicate the raw text as normalized when nothing changed", () => {
    const pkg = buildContextPackage({ state: "new_inbound", inbound: { rawText: "היי", source: "whatsapp" } });
    expect(pkg.inbound.normalized_text).toBeNull();
    expect(pkg.inbound.is_voice).toBe(false);
  });
});

describe("plan validation", () => {
  it("accepts a grounded answer-first plan", () => {
    const res = validatePlan(basePlan({ cited_source_ids: ["src-1"], facts_required: ["price"] }), ctx);
    expect(res.ok).toBe(true);
  });

  it("rejects an unknown / unrelated offer id (Vietnam can never be selected)", () => {
    const res = validatePlan(basePlan({ cited_offer_ids: [VIETNAM] }), ctx);
    expect(res.ok).toBe(false);
    expect(res.violations.join()).toContain("unknown_offer_id");
  });

  it("rejects a focus change without explicit mention, reference or reset", () => {
    const res = validatePlan(basePlan({ active_offer_id: VIETNAM, cited_offer_ids: [] }), ctx);
    expect(res.violations).toContain("focus_change_not_allowed");
  });

  it("allows a focus change on an explicit mention of a known offer", () => {
    const res = validatePlan(basePlan({ active_offer_id: VIETNAM, cited_offer_ids: [] }), {
      ...ctx,
      allowedOfferIds: [BAKU, VIETNAM],
      explicitMention: true,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects repeating an intake question already answered", () => {
    const res = validatePlan(basePlan({ ask_intake_question: true, intake_question_key: "city" }), ctx);
    expect(res.violations.join()).toContain("repeats_known_intake:city");
  });

  it("rejects a generic recommendation and a recommendation before answering", () => {
    const res = validatePlan(
      basePlan({ next_best_action: "recommend", cited_offer_ids: [], direct_answer_needed: true }),
      ctx,
    );
    expect(res.violations).toContain("generic_recommendation");
    expect(res.violations).toContain("recommendation_before_answer");
  });

  it("rejects unsupported facts", () => {
    const res = validatePlan(basePlan({ facts_required: ["wheelchair_access"] }), ctx);
    expect(res.violations.join()).toContain("unsupported_facts");
  });

  it("rejects an unknown source id", () => {
    const res = validatePlan(basePlan({ cited_source_ids: ["src-999"] }), ctx);
    expect(res.violations.join()).toContain("unknown_source_id");
  });
});

describe("plan composition", () => {
  it("is terminal for an answer with no appropriate question", () => {
    expect(planComposition(basePlan({ ask_intake_question: false })).terminal).toBe(true);
  });
  it("never allows a recommendation tail on an answer-first turn", () => {
    expect(planComposition(basePlan({ next_best_action: "recommend" })).allowRecommendation).toBe(false);
  });
});

describe("plan parsing", () => {
  it("returns null on malformed output", () => {
    expect(parsePlan("not json")).toBeNull();
  });
  it("clamps and defaults unknown actions", () => {
    const p = parsePlan('{"next_best_action":"explode","confidence":900}');
    expect(p?.next_best_action).toBe("acknowledge");
    expect(p?.confidence).toBe(100);
  });
});
