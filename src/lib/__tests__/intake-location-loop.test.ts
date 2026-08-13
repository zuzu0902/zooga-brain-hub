/**
 * REGRESSION — the "באיזה אזור בארץ את/ה גר/ה?" loop.
 *
 * Orly answered "השפלה" and then "רמלה"; both were valid, both were dropped
 * and the same question was sent three times. Two defects caused it:
 *   1. the inbound gate read only `intake_last_question_key`, while baseline
 *      intake pins the asked field in `intake_last_step_id` -> the answer was
 *      classified "no_current_question" and never saved;
 *   2. location parsing knew regions but not cities, and never inferred a
 *      region from a city.
 */
import { describe, expect, it } from "vitest";
import { validateFieldAnswer } from "@/lib/inbound-gate/classify";
import { baselineMaySave } from "@/lib/inbound-gate/route-policy";
import { classifyInbound } from "@/lib/inbound-gate/classify";
import { extractFieldsFromFreeText, regionForLocation } from "@/lib/onboarding/baseline-intake";
import { evaluateOutbound } from "@/lib/conversation-guard/core";

describe("location answers", () => {
  it('"השפלה" is a valid answer to the city question and is stored as a region', () => {
    expect(validateFieldAnswer("city", "השפלה").valid).toBe(true);
    const out = extractFieldsFromFreeText("השפלה", "city");
    expect(out["region"]?.value).toBe("השפלה");
    expect(out["city"]?.value).toBe("השפלה");
  });

  it('"רמלה" is a city and its region is inferred with high confidence', () => {
    expect(validateFieldAnswer("city", "רמלה").valid).toBe(true);
    const out = extractFieldsFromFreeText("רמלה", "city");
    expect(out["city"]?.value).toBe("רמלה");
    expect(out["region"]?.value).toBe("השפלה");
    expect(out["region"]?.kind).toBe("inferred");
    expect(regionForLocation("רמלה")).toBe("השפלה");
  });

  it("a city + region in one sentence keeps both explicit, no overwrite", () => {
    const out = extractFieldsFromFreeText("אני גרה ברמלה שבשפלה", "city");
    expect(out["city"]?.value).toBe("רמלה");
    expect(out["region"]?.value).toBe("השפלה");
    expect(out["region"]?.kind).toBe("explicit");
  });

  it("an unclear answer is not turned into a location fact", () => {
    expect(validateFieldAnswer("city", "מה?").valid).toBe(false);
    expect(extractFieldsFromFreeText("מה?", null)["city"]).toBeUndefined();
  });
});

describe("gate context: the asked field must be visible", () => {
  it("with a current question a valid answer may be saved", () => {
    const cls = classifyInbound({ text: "רמלה", sourceType: "text", currentQuestionKey: "city" });
    expect(cls.answer_valid).toBe(true);
    expect(baselineMaySave(cls)).toBe(true);
  });

  it("without a current question the same answer is dropped (the old bug)", () => {
    const cls = classifyInbound({ text: "רמלה", sourceType: "text", currentQuestionKey: null });
    expect(cls.answer_valid).toBe(false);
    expect(baselineMaySave(cls)).toBe(false);
  });
});

describe("anti-loop: the same question is never sent twice in a row", () => {
  const q = "באיזה אזור בארץ את/ה גר/ה?";

  it("second ask of the same field is rephrased, not repeated", () => {
    const r = evaluateOutbound({
      candidateText: q,
      askedField: "city",
      inboundText: "השפלה",
      recentTurns: [{ route: "baseline_intake", asked_field: "city", question_signature: null, progress_made: true } as any],
    });
    expect(r.verdict).toBe("rephrase");
    expect(r.text).not.toBe(q);
  });

  it("third ask is blocked and replaced by a recovery message", () => {
    const turn = { route: "baseline_intake", asked_field: "city", question_signature: null, progress_made: true } as any;
    const r = evaluateOutbound({
      candidateText: q,
      askedField: "city",
      inboundText: "רמלה",
      recentTurns: [turn, turn],
    });
    expect(r.verdict).toBe("recovery");
    expect(r.repeat_count).toBeGreaterThanOrEqual(2);
    expect(r.text).not.toBe(q);
  });

  it("an explicit loop complaint always wins", () => {
    const r = evaluateOutbound({ candidateText: q, askedField: "city", inboundText: "כבר עניתי לך על זה" });
    expect(r.verdict).toBe("recovery");
  });
});
