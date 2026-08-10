/**
 * Multi-turn regression tests for the Conversation Progress Guard.
 * Pure logic only: no DB, no WhatsApp, no PII.
 */
import { describe, expect, it } from "vitest";
import {
  buildRecovery,
  detectLoopSignal,
  evaluateOutbound,
  isDontKnowAnswer,
  normalizeText,
  progressMade,
  questionSignature,
  semanticallyEquivalent,
  type TurnRecord,
} from "@/lib/conversation-guard/core";

const Q = "מה הכי מעניין אותך מהפעילות של זוגה?";
const turn = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  asked_field: "interests",
  question_signature: questionSignature(Q),
  progress_made: false,
  ...over,
});

describe("normalization", () => {
  it("collapses gendered forms, punctuation and emoji", () => {
    expect(normalizeText("גר/ה בתל אביב! 🙂")).toBe("גר בתל אביב");
  });
  it("matches the same question worded differently", () => {
    expect(
      semanticallyEquivalent(questionSignature(Q), questionSignature("מה הכי מעניין אותך מהפעילות של זוגה")),
    ).toBe(true);
  });
  it("does not match a different question", () => {
    expect(semanticallyEquivalent(questionSignature(Q), questionSignature("באיזו עיר את גרה?"))).toBe(false);
  });
});

describe("signals", () => {
  it("detects 'you already asked me'", () => {
    for (const m of ["כבר עניתי לך", "אמרתי לך את זה", "למה את שואלת שוב?", "שאלת כבר"]) {
      expect(detectLoopSignal(m)).toBe(true);
    }
    expect(detectLoopSignal("מעניין אותי טיולים")).toBe(false);
  });
  it("treats 'לא מכיר' as don't-know, not as an answer and not as a refusal", () => {
    expect(isDontKnowAnswer("לא מכיר")).toBe(true);
    expect(isDontKnowAnswer("לא יודע בדיוק")).toBe(true);
    expect(isDontKnowAnswer("טיולים לחו״ל")).toBe(false);
  });
});

describe("progress invariant", () => {
  it("requires at least one form of progress", () => {
    expect(progressMade({})).toBe(false);
    expect(progressMade({ saved_new_fact: true })).toBe(true);
    expect(progressMade({ performed_handoff: true })).toBe(true);
  });
});

describe("the exact production loop (interests asked 3x)", () => {
  it("turn 1 sends the question", () => {
    const r = evaluateOutbound({ candidateText: Q, askedField: "interests", inboundText: "היי", progress: { advanced_state: true } });
    expect(r.verdict).toBe("send");
    expect(r.text).toBe(Q);
  });

  it("turn 2 after 'לא מכיר' rephrases once with a skip option", () => {
    const r = evaluateOutbound({
      candidateText: Q,
      askedField: "interests",
      inboundText: "לא מכיר",
      recentTurns: [turn({ progress_made: true })],
      purpose: "כדי להתאים לך פעילות",
    });
    expect(r.verdict).toBe("rephrase");
    expect(r.repeat_count).toBe(1);
    expect(r.text).not.toBe(Q);
    expect(r.text).toContain("דלג");
  });

  it("turn 3 never asks a third time — it recovers", () => {
    const r = evaluateOutbound({
      candidateText: Q,
      askedField: "interests",
      inboundText: "לא מכיר",
      recentTurns: [turn({ progress_made: true }), turn({ progress_made: true })],
    });
    expect(r.verdict).toBe("recovery");
    expect(r.text).toContain("מה הכי חשוב לך");
  });

  it("an explicit loop complaint recovers immediately, even on the first repeat", () => {
    const r = evaluateOutbound({ candidateText: Q, askedField: "interests", inboundText: "כבר עניתי לך" });
    expect(r.verdict).toBe("recovery");
    expect(r.loop_signal).toBe(true);
  });

  it("two consecutive turns without progress force recovery", () => {
    const r = evaluateOutbound({
      candidateText: "באיזו עיר את גרה?",
      askedField: "residence_city",
      inboundText: "אוקיי",
      recentTurns: [turn({ asked_field: "a", progress_made: false }), turn({ asked_field: "b", progress_made: false })],
    });
    expect(r.verdict).toBe("recovery");
    expect(r.reason).toBe("no_progress_two_turns");
  });

  it("a different, progressing question is always allowed", () => {
    const r = evaluateOutbound({
      candidateText: "יש לנו טיול לאלבניה בספטמבר — רוצה פרטים?",
      inboundText: "יש טיול לאלבניה?",
      recentTurns: [turn({ progress_made: true })],
      progress: { answered_user_intent: true },
    });
    expect(r.verdict).toBe("send");
  });

  it("recovery text acknowledges what was already said", () => {
    expect(buildRecovery("מחפש טיול לאלבניה")).toContain("מחפש טיול לאלבניה");
  });
});
