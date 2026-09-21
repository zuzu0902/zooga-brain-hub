/**
 * TAMAR — fresh concierge policy (approved canonical override).
 *
 * Covers: no unprompted destination copy, offers only on an explicit
 * catalogue/travel question, the exact first-inbound greeting with retry
 * idempotency, database-only `output_text` audit, and Hebrew cleanliness.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decideTurn, type TurnInput } from "@/lib/tamar-v2/engine-core";
import { selectResponseAction, type OrchestratorInput } from "@/lib/tamar-v2/response-orchestrator";
import {
  FIRST_INBOUND_GREETING,
  isCustomerFacingHebrewClean,
  KNOWN_ZOOGA_REPLY,
  NEW_TO_ZOOGA_REPLY,
  POST_CONSENT_OPENING,
  ZOOGA_FAMILIARITY_STEP,
} from "@/lib/tamar-v2/conversation-policy";

const agent: any = {
  version: 1,
  identity: { name: "תמר", role: "מארחת", tone: "חמה" },
  steps: [
    { step_key: "area", question: "באיזה אזור בארץ את/ה גר/ה?", order_index: 1, enabled: true, field_key: "city" },
  ],
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

describe("first inbound", () => {
  it("replies with exactly the approved greeting and nothing else", () => {
    const d = decideTurn(input({ firstInbound: true, message: "היי, מי זאת?" }));
    expect(d.messages).toHaveLength(1);
    expect(bodies(d)).toBe(FIRST_INBOUND_GREETING);
    expect(d.ask_step_key).toBe(ZOOGA_FAMILIARITY_STEP);
    expect(d.marketing_allowed).toBe(false);
    expect(d.offer_ids ?? []).toHaveLength(0);
  });

  it("a provider retry of the same turn produces the identical text (idempotent)", () => {
    const a = decideTurn(input({ firstInbound: true }));
    const b = decideTurn(input({ firstInbound: true }));
    expect(bodies(b)).toBe(bodies(a));
  });

  it("a Tamar-initiated thread keeps the approved consent opener", () => {
    const d = decideTurn(input({ firstInbound: false }));
    expect(d.ask_step_key).toBe("consent");
    expect(bodies(d)).not.toBe(FIRST_INBOUND_GREETING);
  });

  it("the greeting answer runs the familiarity bridge, not consent classification", () => {
    const known = decideTurn(
      input({ state: "consent_asked", pendingStepKey: ZOOGA_FAMILIARITY_STEP, message: "כן, מכיר" }),
    );
    expect(bodies(known)).toBe(KNOWN_ZOOGA_REPLY);
    const fresh = decideTurn(
      input({ state: "consent_asked", pendingStepKey: ZOOGA_FAMILIARITY_STEP, message: "לא, ספרי לי" }),
    );
    expect(bodies(fresh)).toBe(NEW_TO_ZOOGA_REPLY);
    const unclear = decideTurn(
      input({ state: "consent_asked", pendingStepKey: ZOOGA_FAMILIARITY_STEP, message: "אהה" }),
    );
    expect(bodies(unclear)).toBe(POST_CONSENT_OPENING);
  });
});

describe("no unprompted destination copy", () => {
  const OFFERS = [
    { id: "o1", title: "טיול לאזרבייג'ן", offer_url: "https://www.zooga.co.il/baku", summary: "באקו" },
  ];

  it("a warm smalltalk turn never names a trip or destination", () => {
    const d = decideTurn(
      input({ state: "consented", message: "מה שלומך?", offers: OFFERS as any, allowRecommendation: false }),
    );
    expect(bodies(d)).not.toMatch(/אזרבייג|באקו|טיול ל/);
  });

  it("no production customer copy hard-codes Azerbaijan or Baku", () => {
    for (const f of [
      "src/lib/tamar-v2/engine-core.ts",
      "src/lib/tamar-v2/conversation-policy.ts",
      "src/lib/tamar-v2/writer.server.ts",
      "src/lib/tamar-v2/planner.server.ts",
      "src/lib/tamar-runtime-composition.ts",
    ]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/אזרבייג|באקו|Azerbaijan|Baku/i);
    }
  });
});

describe("offers require an explicit catalogue or travel question", () => {
  const base: OrchestratorInput = {
    message: "",
    isQuestion: true,
    intent: "question",
    wantsHuman: false,
    state: "consented",
    resetRequested: false,
    groundingPath: "none",
    answerText: null,
    activeOfferId: null,
    resolvedOfferId: null,
    planValid: false,
    planAskIntake: false,
    planIntakeKey: null,
    missingIntakeKeys: ["area"],
    catalogSize: 3,
    marketingAllowed: true,
    hasVerifiedLink: false,
  };

  for (const q of ["מה יש לכם להציע?", "לאן מטיילים?", "לאן אתם נוסעים?", "מה אתם מציעים?"]) {
    it(`"${q}" permits a recommendation`, () => {
      expect(selectResponseAction({ ...base, message: q }).recommendation_allowed).toBe(true);
    });
  }

  for (const q of ["מה שלומך?", "אני מתל אביב", "תודה רבה"]) {
    it(`"${q}" never permits a recommendation`, () => {
      expect(selectResponseAction({ ...base, message: q }).recommendation_allowed).toBe(false);
    });
  }
});

describe("Hebrew cleanliness", () => {
  it("rejects internal, technical or model language", () => {
    expect(isCustomerFacingHebrewClean("אפשר להמשיך עם runtime fallback")).toBe(false);
    expect(isCustomerFacingHebrewClean("המצב שלך: intake_active")).toBe(false);
  });

  it("accepts warm Hebrew, including a product link", () => {
    expect(isCustomerFacingHebrewClean(FIRST_INBOUND_GREETING)).toBe(true);
    expect(isCustomerFacingHebrewClean(KNOWN_ZOOGA_REPLY)).toBe(true);
    expect(isCustomerFacingHebrewClean("כל הפרטים כאן: https://www.zooga.co.il/trip")).toBe(true);
  });
});

describe("output_text audit is database-only", () => {
  it("the engine persists the final text and never forwards it to Gateway/Shadow/logs", () => {
    const engine = readFileSync("src/lib/tamar-v2/engine.server.ts", "utf8");
    expect(engine).toMatch(/output_text: finalOutputText/);
    expect(engine).toMatch(/args\.outbound\.length[\s\S]{0,120}: null/);
    for (const f of ["src/lib/zooga-gateway", "src/lib/zero-loss"]) {
      // no gateway/shadow module may reference the audit column
      expect(
        (() => {
          try {
            return readFileSync(`${f}/index.ts`, "utf8");
          } catch {
            return "";
          }
        })(),
      ).not.toMatch(/output_text/);
    }
  });
});
