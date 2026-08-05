import { describe, expect, it } from "vitest";
import { SCENARIOS, runScenario } from "@/lib/tamar-v2/scenarios";
import { canTransition, deriveState } from "@/lib/tamar-v2/state-machine";
import { classifyConsent, isExplicitOptOut, wantsHuman } from "@/lib/tamar-v2/classify";

describe("Tamar Brain V2 — acceptance scenarios", () => {
  for (const sc of SCENARIOS) {
    it(`[${sc.category}] ${sc.name}`, () => {
      const r = runScenario(sc);
      expect(r.failures, r.failures.join(" | ")).toEqual([]);
    });
  }
});

describe("state machine invariants", () => {
  it("model can never jump straight from new_inbound to recommendation", () => {
    expect(canTransition("new_inbound", "recommendation_ready").allowed).toBe(false);
  });
  it("opted_out only leaves via consent/consented", () => {
    expect(canTransition("opted_out", "intake_active").allowed).toBe(false);
    expect(canTransition("opted_out", "consented").allowed).toBe(true);
  });
  it("legacy v1 contact with consent_pending and no ask is new_inbound", () => {
    expect(deriveState({ conversation_state: "consent_pending" })).toBe("new_inbound");
  });
  it("legacy consented contact keeps consent", () => {
    expect(deriveState({ consent_marketing: true })).toBe("consented");
  });
  it("human_owned always wins", () => {
    expect(deriveState({ human_owned: true, conversation_state: "intake_active" })).toBe("human_owned");
  });
});

describe("classification guards", () => {
  it("לא הבנתי is never a no", () => expect(classifyConsent("לא הבנתי")).toBe("unknown"));
  it("לא תודה is a no", () => expect(classifyConsent("לא, תודה")).toBe("no"));
  it("button value wins over text", () => expect(classifyConsent("בלה", { optionValue: "yes" })).toBe("yes"));
  it("sentence negation is not an opt-out", () => expect(isExplicitOptOut("לא רוצה טיול ארוך")).toBe(false));
  it("standalone הסר is an opt-out", () => expect(isExplicitOptOut("הסר")).toBe(true));
  it("detects a human request", () => expect(wantsHuman("אפשר לדבר עם נציג")).toBe(true));
});
