import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tamar-v2/model-registry.server", () => ({
  callStage: vi.fn(),
}));

import { callStage } from "@/lib/tamar-v2/model-registry.server";
import { classifyInbound } from "@/lib/inbound-gate/classify";
import { needsRefinement, refineClassification } from "@/lib/inbound-gate/refine.server";

const mockedCall = callStage as unknown as ReturnType<typeof vi.fn>;

function base(text: string, fieldKey: string | null = "residence_city") {
  return classifyInbound({ text, sourceType: "text", currentQuestionKey: fieldKey });
}

function reply(content: string | null, ok = true) {
  mockedCall.mockResolvedValueOnce({
    ok,
    content,
    model_id: "m",
    http_status: ok ? 200 : 500,
    latency_ms: 1,
    fallback_used: false,
    error: ok ? null : "boom",
  });
}

describe("inbound gate — LLM refinement", () => {
  it("never calls the model for hard signals", () => {
    expect(needsRefinement(base("תפסיקו לשלוח לי הודעות"))).toBe(false);
    expect(needsRefinement(base("אני רוצה לדבר עם נציג"))).toBe(false);
  });

  it("never calls the model for clean confusion", () => {
    expect(needsRefinement(base("מה?"))).toBe(false);
    expect(needsRefinement(base("?"))).toBe(false);
  });

  it("returns the base verdict untouched when no refinement is needed", async () => {
    const b = base("מה?");
    const out = await refineClassification(b, { text: "מה?" });
    expect(out).toBe(b);
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it("model cannot turn a non-answer into a captured answer", async () => {
    const b = { ...base("?"), confidence: 0.3, classifier_status: "ok" as const };
    reply(JSON.stringify({ kind: "answer_current_question", is_answer_to_current_question: true, confidence: 0.99 }));
    const out = await refineClassification(b, { text: "?", currentQuestionKey: "residence_city" });
    expect(out.answer_valid).toBe(false);
    expect(out.should_advance).toBe(false);
  });

  it("model cannot invent a control intent", async () => {
    const b = { ...base("אולי"), confidence: 0.3, classifier_status: "ok" as const };
    reply(JSON.stringify({ kind: "opt_out", confidence: 0.9 }));
    const out = await refineClassification(b, { text: "אולי" });
    expect(out.classifier_status).toBe("model_failed");
    expect(out.should_advance).toBe(false);
  });

  it("invalid JSON or timeout degrades to a no-capture verdict", async () => {
    const b = { ...base("אולי"), confidence: 0.3, classifier_status: "ok" as const };
    reply("not json at all");
    const out = await refineClassification(b, { text: "אולי" });
    expect(out.classifier_status).toBe("model_failed");
    expect(out.answer_valid).toBe(false);

    const b2 = { ...base("אולי"), confidence: 0.3, classifier_status: "ok" as const };
    reply(null, false);
    const out2 = await refineClassification(b2, { text: "אולי" });
    expect(out2.classifier_status).toBe("model_failed");
  });

  it("model may downgrade an ambiguous message to a question", async () => {
    const b = { ...base("ומה עם החורף"), confidence: 0.4, classifier_status: "ok" as const };
    reply(JSON.stringify({ kind: "question", confidence: 0.8 }));
    const out = await refineClassification(b, { text: "ומה עם החורף" });
    expect(out.kind).toBe("question");
    expect(out.response_priority).toBe("answer_user");
    expect(out.should_advance).toBe(false);
  });

  it("a model-confirmed valid answer that passes the validator may advance", async () => {
    const b = { ...base("תל אביב"), confidence: 0.4, classifier_status: "ok" as const, answer_valid: false, should_advance: false };
    reply(JSON.stringify({ kind: "answer_current_question", is_answer_to_current_question: true, confidence: 0.9 }));
    const out = await refineClassification(b, { text: "תל אביב", currentQuestionKey: "residence_city" });
    expect(out.answer_valid).toBe(true);
    expect(out.should_advance).toBe(true);
  });
});