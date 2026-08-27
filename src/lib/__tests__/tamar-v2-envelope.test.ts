/**
 * TAMAR V2 — answer-first relevance, one-envelope policy and context bounds.
 * Reproduces the live 7833 voice case: one inbound, one grounded answer,
 * NO unrelated Dubai/Vietnam recommendation, ONE outbound envelope.
 */
import { describe, expect, it } from "vitest";
import { decideTurn, type TurnInput } from "@/lib/tamar-v2/engine-core";
import { dedupeSegments, planOutbound, toSingleEnvelope } from "@/lib/tamar-v2/envelope";
import { questionSignature } from "@/lib/conversation-guard/core";
import {
  buildContextPackage,
  dedupeMemories,
  estimateTokens,
  isSecretContextKey,
  redactContext,
  turnComplexity,
  CONTEXT_LIMITS,
} from "@/lib/tamar-v2/context";
import { DEFAULT_IDENTITY, DEFAULT_SAFETY, type AgentVersion, type Interpretation, type OutboundMessage } from "@/lib/tamar-v2/types";

const agent: AgentVersion = {
  id: null,
  version: 1,
  status: "active",
  identity: DEFAULT_IDENTITY,
  safety: { ...DEFAULT_SAFETY },
  steps: [
    {
      step_key: "region",
      field_key: "region",
      stage: "intake",
      question_text: "מאיזה אזור בארץ את/ה?",
      help_text: null,
      presentation: "text",
      required: true,
      skippable: true,
      conditions: {},
      order_index: 1,
      enabled: true,
      options: [],
    },
  ],
};

function interp(over: Partial<Interpretation> = {}): Interpretation {
  return {
    intent: "question",
    consent_answer: "unknown",
    wants_human: false,
    confusion: false,
    sentiment: "neutral",
    entities: {},
    confidence: 95,
    rationale: "",
    source: "model",
    ...over,
  };
}

function turn(over: Partial<TurnInput> = {}): TurnInput {
  return {
    state: "value_delivered",
    message: "מה כולל הטיול לבאקו?",
    agent,
    interpretation: interp(),
    knownFields: { region: "מרכז", first_name: "א", goal: "טיולים" },
    pendingStepKey: null,
    ambiguityTurns: 0,
    answeredCount: 3,
    offers: [
      { id: "dubai", title: "דובאי", offer_url: "https://x/dubai", summary: null },
      { id: "vietnam", title: "וייטנאם", offer_url: "https://x/vn", summary: null },
    ],
    answerText: "הטיול לבאקו כולל טיסות, מלון ומדריך.",
    ...over,
  };
}

describe("answer-first relevance", () => {
  it("answers the question and appends NOTHING else (the live 7833 case)", () => {
    const d = decideTurn(turn());
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0]!.body).toContain("באקו");
    expect(JSON.stringify(d.messages)).not.toContain("דובאי");
    expect(JSON.stringify(d.messages)).not.toContain("וייטנאם");
    expect(d.offer_ids).toEqual([]);
    expect(d.reason_codes).toContain("answer_only_no_followup");
  });

  it("never re-recommends an offer already sent", () => {
    const d = decideTurn(
      turn({
        message: "מה יש לכם?",
        interpretation: interp({ intent: "browse_offers" }),
        answerText: null,
        recentlySentOfferIds: ["dubai"],
      }),
    );
    const body = d.messages.map((m) => m.body).join("\n");
    expect(body).not.toContain("דובאי");
    expect(d.offer_ids).toEqual(["vietnam"]);
  });

  it("repeats an offer when the customer explicitly asks for it again", () => {
    const d = decideTurn(
      turn({
        message: "תשלחי לי שוב את הקישור",
        interpretation: interp({ intent: "browse_offers" }),
        answerText: null,
        recentlySentOfferIds: ["dubai", "vietnam"],
        explicitOfferRequest: true,
      }),
    );
    expect(d.offer_ids.length).toBeGreaterThan(0);
  });
});

describe("one outbound envelope", () => {
  const msgs: OutboundMessage[] = [
    { kind: "text", body: "תשובה" },
    { kind: "text", body: "ושאלה" },
  ];

  it("merges all text segments into a single message", () => {
    const out = toSingleEnvelope(msgs);
    expect(out).toHaveLength(1);
    expect(out[0]!.body).toBe("תשובה\n\nושאלה");
  });

  it("keeps the interactive payload and merges the text into its body", () => {
    const out = toSingleEnvelope([
      { kind: "text", body: "תודה" },
      { kind: "buttons", body: "מאשר?", header: null, options: [{ id: "y", label: "כן", value: "yes" }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("buttons");
    expect(out[0]!.body).toBe("תודה\n\nמאשר?");
  });

  it("dedupes EVERY segment, not only the first", () => {
    const res = dedupeSegments(
      [
        { kind: "text", body: "מאיזה אזור בארץ את?" },
        { kind: "text", body: "שלום" },
        { kind: "text", body: "מאיזה אזור בארץ את/ה?" },
      ],
      [],
    );
    expect(res.kept).toHaveLength(2);
    expect(res.dropped[0]!.reason).toBe("same_turn_duplicate");
  });

  it("drops a segment already sent in recent history", () => {
    const res = planOutbound({
      messages: [{ kind: "text", body: "הנה מה שהכי מתאים: דובאי" }],
      recentSignatures: [questionSignature("הנה מה שהכי מתאים: דובאי")],
    });
    expect(res.messages).toHaveLength(0);
    expect(res.dropped[0]!.reason).toBe("recent_history_duplicate");
  });

  it("splits only above the hard WhatsApp limit", () => {
    const long = "א".repeat(5000);
    const out = toSingleEnvelope([{ kind: "text", body: long }, { kind: "text", body: "ב" }]);
    expect(out.length).toBeGreaterThan(1);
  });
});

describe("context package", () => {
  const raw = {
    contact: { id: "c1", first_name: "אורלי" },
    state: "intake_active",
    summary: "לקוחה מהשפלה",
    interactions: Array.from({ length: 60 }, (_, i) => ({
      source: i % 2 ? "tamar_outbound" : "tamar_inbound",
      content: `שורה ${i}`,
      timestamp: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
    })).reverse(),
    facts: [{ field_key: "region", value_text: "השפלה", explicit_or_inferred: "explicit", confidence_score: 90 }],
    memories: [
      { memory_key: "goal", memory_value: "טיולים", confidence_score: 50, updated_at: "2026-01-01" },
      { memory_key: "goal", memory_value: "טיולים ואירועים", confidence_score: 90, updated_at: "2026-02-01" },
    ],
    history: [{ field_name: "region", old_value: null, new_value: "השפלה", created_at: "2026-01-01" }],
    decisions: [{ selected_action: "answer_first", reason_codes: ["answer_first"], created_at: "2026-01-01" }],
    offersSent: ["dubai"],
    offersPresented: ["dubai", "vietnam"],
    handoff: { open: false, reason: null },
    knowledge: ["ידע"],
  };

  it("respects bounds and keeps current history and memory", () => {
    const ctx = buildContextPackage(raw as any);
    expect(ctx.transcript).toHaveLength(CONTEXT_LIMITS.transcript);
    expect(ctx.transcript[0]!.at! < ctx.transcript[ctx.transcript.length - 1]!.at!).toBe(true);
    expect(ctx.facts[0]!.provenance).toBe("explicit");
    expect(ctx.memories).toHaveLength(1);
    expect(ctx.memories[0]!.value).toBe("טיולים ואירועים");
    expect(ctx.offers_sent).toEqual(["dubai"]);
    expect(estimateTokens(ctx)).toBeGreaterThan(0);
  });

  it("deduplicates memories by key keeping the most confident current one", () => {
    const out = dedupeMemories([
      { key: "k", type: null, value: "a", confidence: 10, at: "2026-01-01" },
      { key: "k", type: null, value: "b", confidence: 80, at: "2025-01-01" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBe("b");
  });

  it("redacts secret-like keys", () => {
    expect(isSecretContextKey("gateway_token")).toBe(true);
    expect(isSecretContextKey("api_key")).toBe(true);
    expect(isSecretContextKey("input_signals")).toBe(true);
    expect(isSecretContextKey("first_name")).toBe(false);
    const red = redactContext({ ok: 1, bearer_token: "x", nested: { prompt: "p", keep: 2 } }) as any;
    expect(red).toEqual({ ok: 1, nested: { keep: 2 } });
  });

  it("routes normal turns to the cheap model and hard turns to the strong one", () => {
    const ctx = buildContextPackage(raw as any);
    expect(turnComplexity({ message: "מה שלומך?", ctx })).toBe("simple");
    expect(turnComplexity({ message: "אני רוצה החזר כספי", ctx })).toBe("complex");
    expect(turnComplexity({ message: "היי", ctx, wantsHuman: true })).toBe("complex");
    expect(turnComplexity({ message: "היי", ctx, confidence: 20 })).toBe("complex");
  });
});
