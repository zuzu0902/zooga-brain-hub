/**
 * Tamar Brain v1 — deterministic-layer simulation tests.
 * No WhatsApp, no PII, no database: pure logic units only.
 */
import { describe, expect, it } from "vitest";
import { classifyConsentReply, consentClarifyExhausted, renderConsentBody } from "@/lib/tamar-brain/consent";
import { detectHandoffSignal, isGoodbye, isUserQuestion } from "@/lib/tamar-brain/signals";
import {
  AUTOMATION_BLOCKED_STATES,
  automationFrozen,
  canTransition,
  deriveState,
  marketingAllowed,
} from "@/lib/tamar-brain/state-machine";
import { allowedActionsForState } from "@/lib/tamar-brain/action-planner.server";
import { hasRelevantMatch, rankOffers } from "@/lib/tamar-brain/recommend";

describe("consent gate", () => {
  it("classifies Hebrew and English affirmatives", () => {
    for (const m of ["כן", "כן, בשמחה", "מעוניין", "yes", "בטח"]) {
      expect(classifyConsentReply(m)).toBe("yes");
    }
  });
  it("classifies refusals", () => {
    for (const m of ["לא", "לא תודה", "הסר", "stop", "no"]) {
      expect(classifyConsentReply(m)).toBe("no");
    }
  });
  it("treats free text as ambiguous", () => {
    expect(classifyConsentReply("מה יש לכם לאלבניה?")).toBe("ambiguous");
  });
  it("stops clarifying after one attempt", () => {
    const one = [{ source: "tamar_outbound", content: "רק כדי לוודא שהבנתי נכון — מתאים שנעדכן אותך?" }];
    expect(consentClarifyExhausted(one)).toBe(true);
    expect(consentClarifyExhausted([])).toBe(false);
  });
  it("personalizes with first name when available", () => {
    expect(renderConsentBody("שלום {{first_name}}", "ורדה")).toContain("ורדה");
    expect(renderConsentBody("שלום {{first_name}}", null)).not.toContain("{{");
  });
});

describe("handoff supremacy", () => {
  it("detects explicit human requests", () => {
    for (const m of ["אני רוצה לדבר עם בן אדם", "תעבירי לאלכס", "אפשר נציג?", "תתקשרו אליי"]) {
      expect(detectHandoffSignal(m).handoff).toBe(true);
    }
  });
  it("detects complaints and distress", () => {
    expect(detectHandoffSignal("זו הונאה, אני רוצה החזר כספי").handoff).toBe(true);
  });
  it("does not fire on ordinary sales questions", () => {
    expect(detectHandoffSignal("כמה עולה הטיול לאלבניה?").handoff).toBe(false);
  });
  it("freezes automation once human-owned", () => {
    expect(automationFrozen("human_owned")).toBe(true);
    expect(automationFrozen("paused")).toBe(true);
    expect(automationFrozen("consented")).toBe(false);
    expect(AUTOMATION_BLOCKED_STATES).toContain("opted_out");
  });
});

describe("state machine", () => {
  it("blocks marketing before consent", () => {
    expect(marketingAllowed("consent_pending")).toBe(false);
    expect(marketingAllowed("opted_out")).toBe(false);
    expect(marketingAllowed("consented")).toBe(true);
  });
  it("never leaves opted_out except by explicit opt-in", () => {
    expect(canTransition("opted_out", "intake_active").allowed).toBe(false);
    expect(canTransition("opted_out", "consented").allowed).toBe(true);
  });
  it("derives state from contact columns", () => {
    expect(deriveState({ human_owned: true })).toBe("human_owned");
    expect(deriveState({ opted_out_at: "2026-01-01" })).toBe("opted_out");
    expect(deriveState({ consent_marketing: true })).not.toBe("consent_pending");
  });
  it("restricts the planner action space per state", () => {
    // frozen states expose no productive action — only "wait"
    expect(allowedActionsForState("human_owned")).toEqual(["wait"]);
    expect(allowedActionsForState("consent_pending")).not.toContain("recommend_offer");
    expect(allowedActionsForState("consented")).toContain("ask_next_field");
  });
});

describe("recommendation grounding", () => {
  const offers = [
    { id: "1", title: "אלבניה 60+", target_min_age: 55, target_max_age: 75, target_interests: ["טבע"], status: "active" },
    { id: "2", title: "מסיבת רווקים 25+", target_min_age: 22, target_max_age: 35, target_interests: ["מסיבות"], status: "active" },
  ];
  it("ranks by fit", () => {
    const ranked = rankOffers(offers, { age: 63, interests: ["טבע"], goal_text: "אלבניה" });
    expect(ranked[0].id).toBe("1");
  });
  it("reports no relevant match when nothing fits", () => {
    expect(hasRelevantMatch(rankOffers([], { goal_text: "אנטארקטיקה" }))).toBe(false);
  });
});

describe("conversation signals", () => {
  it("detects questions and goodbyes", () => {
    expect(isUserQuestion("כמה זה עולה?")).toBe(true);
    expect(isGoodbye("תודה רבה, להתראות")).toBe(true);
    expect(isGoodbye("תודה, ומה עם התאריכים?")).toBe(false);
  });
});