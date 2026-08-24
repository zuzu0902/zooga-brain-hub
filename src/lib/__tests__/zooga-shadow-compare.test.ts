import { describe, expect, it } from "vitest";
import {
  buildShadowInputSignals,
  hashInputSignals,
  evaluateShadowRun,
  sanitizeComparisonMetrics,
  EMPTY_COMPARISON_METRICS,
  SHADOW_SIGNAL_KEYS,
} from "@/lib/zooga-gateway/shadow-compare";
import {
  disabledShadowAdapter,
  createMockShadowAdapter,
  getShadowDecisionAdapter,
  ADAPTER_DISABLED_CODE,
} from "@/lib/zooga-gateway/shadow-decision-adapter";

describe("shadow comparison — sanitized allow-list inputs", () => {
  it("keeps only allow-listed enum/boolean/numeric signals", () => {
    const signals = buildShadowInputSignals({
      kind: "message",
      duplicate: false,
      offer_count_bucket: 2,
      // all of the following must be dropped
      phone: "+972501234567",
      text: "שלום, מה המחיר?",
      name: "Meirav",
      email: "a@b.com",
      provider_message_id: "wamid.HBg",
      facebook_id: "1234",
      contact_id: "2ade847a-2374-4401-852e-3056b4a0f194",
      contact_ref_hash: "deadbeef",
      access_token: "EAAG...",
      metadata: { anything: true },
    });
    expect(signals).toEqual({ kind: "message", duplicate: false, offer_count_bucket: 2 });
    for (const key of Object.keys(signals)) {
      expect(SHADOW_SIGNAL_KEYS).toContain(key as any);
    }
  });

  it("drops free-text values even under an allow-listed key", () => {
    expect(buildShadowInputSignals({ event_type: "שלום, אני מעוניינת בטיול" })).toEqual({});
    expect(buildShadowInputSignals({ locale: "he_IL" })).toEqual({ locale: "he_IL" });
  });

  it("never carries PII markers into the serialized signals", () => {
    const json = JSON.stringify(
      buildShadowInputSignals({ kind: "message", has_text: true, text: "secret", phone: "+972" }),
    );
    expect(json).not.toContain("secret");
    expect(json).not.toContain("+972");
  });

  it("ignores non-objects", () => {
    expect(buildShadowInputSignals(null)).toEqual({});
    expect(buildShadowInputSignals(["kind"])).toEqual({});
  });

  it("hashes deterministically and order-independently", () => {
    const a = hashInputSignals({ kind: "message", duplicate: false });
    const b = hashInputSignals({ duplicate: false, kind: "message" });
    expect(a).toBe(b);
    expect(a).not.toBe(hashInputSignals({ kind: "status", duplicate: false }));
  });
});

describe("shadow comparison — deterministic evaluation branches", () => {
  const canonical = { action: "reply", state_after: "intake_active", reason_codes: ["a", "b"] };

  it("match", () => {
    expect(evaluateShadowRun({ canonical, proposed: { ...canonical, reason_codes: ["b", "a"] } })).toEqual({
      eval_status: "match",
      eval_reason_codes: [],
    });
  });

  it("mismatch_action", () => {
    const r = evaluateShadowRun({ canonical, proposed: { ...canonical, action: "handoff" } });
    expect(r.eval_status).toBe("mismatch_action");
    expect(r.eval_reason_codes).toEqual(["action_differs"]);
  });

  it("mismatch_state", () => {
    const r = evaluateShadowRun({ canonical, proposed: { ...canonical, state_after: "closed" } });
    expect(r.eval_status).toBe("mismatch_state");
  });

  it("mismatch_reason_only", () => {
    const r = evaluateShadowRun({ canonical, proposed: { ...canonical, reason_codes: ["c"] } });
    expect(r.eval_status).toBe("mismatch_reason_only");
  });

  it("proposal_missing", () => {
    expect(evaluateShadowRun({ canonical, proposed: null }).eval_status).toBe("proposal_missing");
    expect(evaluateShadowRun({ canonical: null, proposed: null }).eval_reason_codes).toEqual([
      "no_proposal",
      "no_canonical",
    ]);
  });

  it("canonical_missing", () => {
    expect(evaluateShadowRun({ canonical: null, proposed: canonical }).eval_status).toBe("canonical_missing");
  });

  it("error wins over every other branch", () => {
    const r = evaluateShadowRun({ canonical, proposed: canonical, errorCode: "timeout" });
    expect(r.eval_status).toBe("error");
    expect(r.eval_reason_codes).toEqual(["error:timeout"]);
  });

  it("is deterministic across repeated calls", () => {
    const once = evaluateShadowRun({ canonical, proposed: { ...canonical, action: "handoff" } });
    const twice = evaluateShadowRun({ canonical, proposed: { ...canonical, action: "handoff" } });
    expect(once).toEqual(twice);
  });
});

describe("shadow comparison — metrics sanitizer", () => {
  it("defaults to empty for junk input", () => {
    expect(sanitizeComparisonMetrics("nope")).toEqual(EMPTY_COMPARISON_METRICS);
    expect(sanitizeComparisonMetrics(null)).toEqual(EMPTY_COMPARISON_METRICS);
  });

  it("projects only numeric counters and short codes", () => {
    const m = sanitizeComparisonMetrics({
      total: 10,
      match: 6,
      mismatch: 4,
      mismatch_rate: 0.4,
      p95_latency_ms: 120.9,
      top_error_code: "a customer said hello",
      secret: "leak",
    });
    expect(m.total).toBe(10);
    expect(m.mismatch_rate).toBe(0.4);
    expect(m.p95_latency_ms).toBe(120);
    expect(m.top_error_code).toBeNull();
    expect(JSON.stringify(m)).not.toContain("leak");
  });
});

describe("shadow decision adapter — disabled in this milestone", () => {
  it("production adapter is disabled and makes no call", async () => {
    expect(getShadowDecisionAdapter()).toBe(disabledShadowAdapter);
    expect(disabledShadowAdapter.enabled).toBe(false);
    const p = await disabledShadowAdapter.propose({ kind: "message" });
    expect(p.outcome).toBeNull();
    expect(p.error_code).toBe(ADAPTER_DISABLED_CODE);
    expect(p.model_id).toBeNull();
    expect(p.cost_usd).toBeNull();
  });

  it("mock adapter exists for tests only", async () => {
    const mock = createMockShadowAdapter({ action: "reply", state_after: "intake_active" });
    expect((await mock.propose({})).outcome).toEqual({ action: "reply", state_after: "intake_active" });
  });
});
