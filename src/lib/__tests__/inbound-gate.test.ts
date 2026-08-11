/**
 * INBOUND CONTEXT GATE — targeted regression tests reproducing the exact
 * production transcript that captured "?", "מה?", "למה" and "מה זה" as
 * questionnaire answers.
 */
import { describe, expect, it } from "vitest";
import { classifyInbound, validateFieldAnswer, extractInboundFacts } from "@/lib/inbound-gate/classify";

const ask = (text: string, extra: Partial<Parameters<typeof classifyInbound>[0]> = {}) =>
  classifyInbound({
    text,
    currentQuestionKey: "desired_relationship_type",
    currentQuestionText: "איזה סוג של מערכת יחסים היית רוצה לבנות?",
    ...extra,
  });

describe("inbound gate — no false capture", () => {
  for (const text of ["?", "מה?", "למה", "מה זה", "מה זאת אומרת"]) {
    it(`never captures "${text}" as an answer`, () => {
      const c = ask(text);
      expect(c.answer_valid).toBe(false);
      expect(c.should_advance).toBe(false);
      expect(["question", "confusion", "multi_intent"]).toContain(c.kind);
    });
  }

  it("a new question does not advance the questionnaire", () => {
    const c = ask("יש לך עוד טיולים?");
    expect(c.answer_valid).toBe(false);
    expect(c.should_advance).toBe(false);
    expect(c.response_priority).toBe("answer_user");
  });

  it("a valid answer is captured", () => {
    const c = ask("גרוש");
    expect(c.kind).toBe("answer_current_question");
    expect(c.answer_valid).toBe(true);
    expect(c.should_advance).toBe(true);
  });

  it("numeric fields reject non-numeric text and accept numbers", () => {
    expect(validateFieldAnswer("age_range", "למה").valid).toBe(false);
    expect(validateFieldAnswer("age_range", "20").valid).toBe(true);
  });
});

describe("inbound gate — priorities and facts", () => {
  it("opt-out outranks everything", () => {
    const c = ask("הסר אותי");
    expect(c.response_priority).toBe("opt_out");
    expect(c.should_advance).toBe(false);
  });

  it("handoff request outranks intake", () => {
    const c = ask("אני רוצה לדבר עם נציג");
    expect(c.response_priority).toBe("handoff");
    expect(c.should_advance).toBe(false);
  });

  it("topic shift keeps state and still extracts facts", () => {
    const c = ask("אני רוצה לנסוע לאלבניה");
    expect(c.should_advance).toBe(false);
    expect(Object.keys(c.extracted_facts).length).toBeGreaterThan(0);
  });

  it("facts are extracted from any message, answer or not", () => {
    const facts = extractInboundFacts("אני גר בחיפה ורוצה טיול לאלבניה");
    expect(Object.values(facts).join(" ")).toMatch(/חיפה|אלבניה/);
  });

  it("a button reply is a valid answer for its question", () => {
    const c = ask("כן", { sourceType: "button", optionId: "consent_yes" });
    expect(c.source_type).toBe("button");
    expect(c.classifier_status).toBe("ok");
  });

  it("voice transcripts use the same classifier", () => {
    const c = ask("אני מחפש קשר רציני", { sourceType: "voice" });
    expect(c.source_type).toBe("voice");
    expect(c.answer_valid).toBe(true);
  });
});