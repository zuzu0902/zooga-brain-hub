/**
 * TAMAR — canonical identity & intake policy (approved override).
 *
 * Covers: the exact first reply of a clean new conversation, the exact
 * known-Zooga reply, the verbatim identity answer, no destination leakage,
 * and that an explicit "התחל מחדש" clears context so the next inbound gets
 * the exact fresh opening again.
 */
import { describe, expect, it } from "vitest";
import { decideTurn, type TurnInput } from "@/lib/tamar-v2/engine-core";
import {
  FIRST_INBOUND_GREETING,
  IDENTITY_REPLY,
  isIdentityQuestion,
  KNOWN_ZOOGA_REPLY,
  ZOOGA_FAMILIARITY_STEP,
} from "@/lib/tamar-v2/conversation-policy";
import { applyResetToDynamic, isConversationResetRequest } from "@/lib/tamar-v2/reset";

const agent: any = {
  version: 1,
  identity: { name: "תמר", role: "העוזרת הדיגיטלית של קהילת זוגה", tone: "חמה" },
  steps: [{ step_key: "area", question: "באיזה אזור?", order_index: 1, enabled: true, field_key: "city" }],
  safety: { min_confidence_marketing: 50, max_questions_per_message: 1 },
};

const interpretation: any = {
  intent: "question",
  confidence: 90,
  entities: {},
  source: "test",
  sentiment: "neutral",
  consent_answer: "unknown",
  wants_human: false,
  confusion: false,
  rationale: "",
};

function input(over: Partial<TurnInput> = {}): TurnInput {
  return {
    state: "new_inbound",
    message: "היי",
    optionId: null,
    optionValue: null,
    agent,
    interpretation,
    knownFields: {},
    pendingStepKey: null,
    ambiguityTurns: 0,
    answeredCount: 0,
    offers: [],
    firstName: "אלכס",
    answerText: null,
    recentlySentOfferIds: [],
    ...over,
  } as TurnInput;
}

const bodies = (d: any) => d.messages.map((m: any) => String(m.body ?? "")).join("\n");

describe("exact canonical copy", () => {
  it("the first reply of a clean new conversation is exactly the approved opening", () => {
    const d = decideTurn(input({ firstInbound: true, message: "היי" }));
    expect(d.messages).toHaveLength(1);
    expect(bodies(d)).toBe("האם אתה מכיר את זוגה או שתרצה שאספר לך קצת עלינו?");
    expect(bodies(d)).toBe(FIRST_INBOUND_GREETING);
    expect(d.ask_step_key).toBe(ZOOGA_FAMILIARITY_STEP);
  });

  it('"מכיר" gets exactly the approved known-Zooga reply', () => {
    const d = decideTurn(
      input({ state: "consent_asked", pendingStepKey: ZOOGA_FAMILIARITY_STEP, message: "מכיר" }),
    );
    expect(bodies(d)).toBe(
      "איזה כיף! אני אשמח להכיר אותך קצת יותר אישית כדי להתאים לך רעיונות. יש לך כמה דקות שנדבר?",
    );
    expect(bodies(d)).toBe(KNOWN_ZOOGA_REPLY);
  });

  it('"מי את?" returns the verbatim identity line and nothing else', () => {
    expect(isIdentityQuestion("מי את?")).toBe(true);
    expect(isIdentityQuestion("עם מי אני מדברת?")).toBe(true);
    expect(isIdentityQuestion("מה המחיר?")).toBe(false);
    const d = decideTurn(input({ state: "consented", message: "מי את?" }));
    expect(d.messages).toHaveLength(1);
    expect(bodies(d)).toBe("אני תמר, העוזרת הדיגיטלית של קהילת זוגה.");
    expect(bodies(d)).toBe(IDENTITY_REPLY);
    expect(d.offer_ids ?? []).toHaveLength(0);
  });
});

describe("no destination leakage", () => {
  const OFFERS = [{ id: "o1", title: "טיול לאזרבייג'ן", offer_url: "https://www.zooga.co.il/x", summary: "באקו" }];

  for (const msg of ["היי", "מי את?", "מה שלומך?"]) {
    it(`"${msg}" never names a trip or destination`, () => {
      const d = decideTurn(
        input({ state: "consented", message: msg, offers: OFFERS as any, allowRecommendation: false }),
      );
      expect(bodies(d)).not.toMatch(/אזרבייג|באקו|טיול ל/);
    });
  }
});

describe('"התחל מחדש" clears context and restarts clean', () => {
  it("is recognized as a reset request", () => {
    expect(isConversationResetRequest("התחל מחדש")).toBe(true);
  });

  it("clears the volatile conversational context and flags a fresh start", () => {
    const { dyn, cleared } = applyResetToDynamic({
      v2_pending_step: "area",
      v2_summary: "סיכום ישן",
      v2_last_offer_id: "o1",
      v2_focus: { topic: "טיול" },
      v2_pending_handoff: { reason: "x" },
    });
    expect(cleared).toEqual(
      expect.arrayContaining(["v2_pending_step", "v2_summary", "v2_last_offer_id", "v2_focus", "v2_pending_handoff"]),
    );
    expect(dyn["v2_pending_step"]).toBeUndefined();
    expect(dyn["v2_summary"]).toBeUndefined();
    expect(dyn["v2_fresh_start"]).toBe(true);
  });

  it("the reset turn itself never replies with old context", () => {
    const d = decideTurn(
      input({ state: "consented", message: "התחל מחדש", resetRequested: true, offers: [] as any }),
    );
    expect(d.actions).toContain("conversation_reset");
    expect(bodies(d)).not.toMatch(/אזרבייג|באקו|טיול ל/);
    expect(d.offer_ids ?? []).toHaveLength(0);
  });

  it("the next inbound after a reset gets exactly the fresh opening", () => {
    const d = decideTurn(input({ state: "consented", freshStart: true, message: "היי" }));
    expect(bodies(d)).toBe(FIRST_INBOUND_GREETING);
    expect(d.ask_step_key).toBe(ZOOGA_FAMILIARITY_STEP);
  });
});
