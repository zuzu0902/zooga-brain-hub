/**
 * Cross-route (session/contact level) loop prevention + customer-safe
 * recovery fallback. Pure logic: no DB, no WhatsApp, no PII.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateOutbound,
  questionSignature,
  type GuardResult,
  type ProgressFlags,
  type TurnRecord,
} from "@/lib/conversation-guard/core";
import {
  buildFallbackText,
  classifyFailureKind,
  decideRecoveryFallback,
} from "@/lib/conversation-guard/fallback";

type Step = {
  inbound: string;
  candidate: string;
  route: string;
  field?: string | null;
  progress?: ProgressFlags | null;
};

/** Drives the guard exactly as `guardOutbound` does: ONE shared history. */
function runSession(steps: Step[]): GuardResult[] {
  const history: TurnRecord[] = [];
  const out: GuardResult[] = [];
  for (const s of steps) {
    const r = evaluateOutbound({
      candidateText: s.candidate,
      askedField: s.field ?? null,
      inboundText: s.inbound,
      recentTurns: history,
      progress: s.progress ?? null,
    });
    out.push(r);
    history.unshift({
      route: s.route,
      asked_field: s.field ?? null,
      question_signature: questionSignature(r.text),
      response_signature: null,
      progress_made: r.verdict === "send",
    });
  }
  return out;
}

const CITY = "איפה את/ה גר/ה?";

describe("cross-route loop detection", () => {
  it("detects a repeat that alternates baseline_intake -> tamar_engine", () => {
    const r = runSession([
      { inbound: "היי", candidate: CITY, route: "baseline_intake", field: "residence_city" },
      { inbound: "לא מכיר", candidate: CITY, route: "tamar_engine", field: "residence_city" },
    ]);
    expect(r[0]!.verdict).toBe("send");
    expect(r[1]!.verdict).toBe("rephrase");
    expect(r[1]!.routes_involved).toEqual(["baseline_intake"]);
  });

  it("escalates to recovery across THREE different routes", () => {
    const r = runSession([
      { inbound: "היי", candidate: CITY, route: "baseline_intake", field: "residence_city" },
      { inbound: "לא מכיר", candidate: CITY, route: "tamar_engine", field: "residence_city" },
      { inbound: "אמממ", candidate: CITY, route: "relationship_intake", field: "residence_city" },
    ]);
    expect(r[2]!.verdict).toBe("recovery");
    expect(r[2]!.cross_route).toBe(true);
    expect(new Set(r[2]!.routes_involved)).toEqual(new Set(["baseline_intake", "tamar_engine"]));
  });

  it("catches a semantic repeat on another route even without asked_field", () => {
    const r = runSession([
      { inbound: "היי", candidate: "מה הכי מעניין אותך בטיולים?", route: "tamar_v2" },
      { inbound: "לא יודע", candidate: "מה הכי מעניין אותך בטיולים?", route: "baseline_intake" },
    ]);
    expect(r[1]!.verdict).toBe("rephrase");
  });

  it("does not flag different questions asked on different routes", () => {
    const r = runSession([
      { inbound: "היי", candidate: CITY, route: "baseline_intake", field: "residence_city" },
      {
        inbound: "תל אביב",
        candidate: "לאן היית רוצה לטוס?",
        route: "tamar_engine",
        field: "destination",
        progress: { saved_new_fact: true },
      },
    ]);
    expect(r.map((x) => x.verdict)).toEqual(["send", "send"]);
  });

  it("keeps the loop history after a restart on a third route", () => {
    const r = runSession([
      { inbound: "היי", candidate: CITY, route: "baseline_intake", field: "residence_city" },
      { inbound: "לא מכיר", candidate: CITY, route: "tamar_engine", field: "residence_city" },
      { inbound: "התחל מחדש", candidate: CITY, route: "tamar_v2", field: "residence_city" },
    ]);
    expect(r[2]!.verdict).toBe("recovery");
  });

  it("a user loop signal on any route wins immediately", () => {
    const r = runSession([
      { inbound: "היי", candidate: CITY, route: "baseline_intake", field: "residence_city" },
      { inbound: "כבר עניתי לך", candidate: CITY, route: "relationship_intake", field: "residence_city" },
    ]);
    expect(r[1]!.verdict).toBe("recovery");
    expect(r[1]!.loop_signal).toBe(true);
  });
});

describe("recovery fallback decision", () => {
  const base = { contactId: "c1", infraAvailable: true, validRecipient: true, windowOpen: true };

  it("classifies model timeout, invalid output, parser failure and unknown errors", () => {
    expect(classifyFailureKind("model timeout after 20s")).toBe("model_timeout");
    expect(classifyFailureKind(new Error("Unexpected token < in JSON"))).toBe("parser_failure");
    expect(classifyFailureKind("empty_reply")).toBe("invalid_model_output");
    expect(classifyFailureKind(new Error("cannot read property of undefined"))).toBe("decision_error");
  });

  it("stays silent for infrastructure failures", () => {
    expect(classifyFailureKind("vault_unavailable")).toBeNull();
    expect(classifyFailureKind("database connection lost")).toBeNull();
    expect(decideRecoveryFallback({ ...base, failureKind: "model_timeout", infraAvailable: false }).send).toBe(false);
  });

  it("sends exactly one fallback on a timeout", () => {
    const d = decideRecoveryFallback({ ...base, failureKind: "model_timeout" });
    expect(d).toEqual({ send: true, reason: "recovery_fallback:model_timeout" });
  });

  it("never sends twice: the retry after a fallback is suppressed", () => {
    const d = decideRecoveryFallback({ ...base, failureKind: "model_timeout", alreadySent: true });
    expect(d).toEqual({ send: false, reason: "fallback_already_sent" });
  });

  it.each([
    ["opted out", { optedOut: true }, "opt_out_suppressed"],
    ["human owned", { humanOwned: true }, "suppressed_human_owned"],
    ["brain suppression", { suppressed: true }, "suppressed_brain_gate"],
    ["invalid recipient", { validRecipient: false }, "invalid_recipient"],
    ["duplicate inbound", { noReplyReason: "duplicate_inbound" }, "duplicate_inbound"],
    ["policy silence", { noReplyReason: "silent_by_policy" }, "silent_by_policy"],
    ["closed window", { windowOpen: false, hasTemplate: false }, "window_closed_no_template"],
    ["no contact", { contactId: null }, "contact_missing"],
  ])("documents a valid no-reply reason: %s", (_label, patch, reason) => {
    const d = decideRecoveryFallback({ ...base, failureKind: "parser_failure", ...(patch as any) });
    expect(d).toEqual({ send: false, reason });
  });

  it("does not fire when the turn simply had no failure", () => {
    expect(decideRecoveryFallback({ ...base, failureKind: null }).send).toBe(false);
  });

  it("the fallback text acknowledges, invents nothing and asks an open question", () => {
    const text = buildFallbackText(null);
    expect(text).toContain("קיבלתי את ההודעה שלך");
    expect(text).toContain("מה הכי חשוב לך שנדבר עליו עכשיו?");
    expect(text).not.toMatch(/\d{3,}|₪/); // no invented prices/dates
  });

  it("never echoes the question that was just asked", () => {
    const primary = buildFallbackText(null);
    const alternate = buildFallbackText(questionSignature(primary));
    expect(alternate).not.toBe(primary);
    expect(alternate).toContain("קיבלתי את ההודעה שלך");
  });

  it("the fallback itself never re-triggers a loop verdict", () => {
    const r = runSession([
      { inbound: "היי", candidate: CITY, route: "baseline_intake", field: "residence_city" },
      { inbound: "לא מכיר", candidate: buildFallbackText(null), route: "recovery_fallback" },
    ]);
    expect(r[1]!.verdict).toBe("send");
  });
});