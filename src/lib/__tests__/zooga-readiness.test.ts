import { describe, it, expect } from "vitest";
import { sanitizeGatewayStatus, emptyStatus, type GatewayStatus } from "@/lib/zooga-gateway/status";
import {
  BRAIN_EXECUTOR_UNVERIFIED_LABEL_HE,
  CANONICAL_RUNTIME,
  EMPTY_READINESS,
  collectInvalidCanonicalActions,
  computeReadinessBlockers,
  isBrainProposalAction,
  isPilotReady,
  nextSafeMilestone,
  sanitizeReadiness,
} from "@/lib/zooga-gateway/readiness";

const HEALTHY: GatewayStatus = sanitizeGatewayStatus(
  {
    system: "zooga-os",
    environment: "foundation",
    default_tenant: "zooga",
    integrations: { supabase: true },
    execution: { inbound_enabled: false, outbound_enabled: false },
  },
  { checkedAt: "2026-08-24T08:00:00.000Z", latencyMs: 40 },
);

const READY = sanitizeReadiness({
  brain_executor: "verified",
  tenants: { total: 1, current_slug: "zooga", isolation_enforced: true },
  memory: { contact_memories: 30, profile_history: 38, decision_traces: 78, audit_events: 2, audit_events_recent: 1, available: true },
  contract: { checked_runs: 5, invalid_canonical_actions: 0, invalid_action_samples: [] },
});

describe("readiness normalization", () => {
  it("defaults to the safe projection for garbage input", () => {
    for (const bad of [null, undefined, 7, "x", []]) {
      expect(sanitizeReadiness(bad)).toEqual(EMPTY_READINESS);
    }
  });

  it("keeps canonical runtime pinned to the legacy Tamar engine", () => {
    const r = sanitizeReadiness({ canonical_runtime: "gateway_brain" });
    expect(r.canonical_runtime).toBe(CANONICAL_RUNTIME);
  });

  it("treats an unproven brain executor as not verified", () => {
    expect(sanitizeReadiness({}).brain_executor).toBe("not_verified");
    expect(sanitizeReadiness({ brain_executor: "maybe" }).brain_executor).toBe("not_verified");
    expect(sanitizeReadiness({ brain_executor: "verified" }).brain_executor).toBe("verified");
  });

  it("coerces counts and never trusts booleans by default", () => {
    const r = sanitizeReadiness({
      tenants: { total: "3", current_slug: "zooga", isolation_enforced: "true" },
      memory: { contact_memories: -5, audit_events: 2.9, available: "yes" },
    });
    expect(r.tenants.total).toBe(3);
    expect(r.tenants.isolation_enforced).toBe(false);
    expect(r.memory.contact_memories).toBe(0);
    expect(r.memory.audit_events).toBe(2);
    expect(r.memory.available).toBe(false);
  });

  it("redacts secret-like and unknown keys", () => {
    const r = sanitizeReadiness({
      bearer_token: "abc",
      gateway_token: "abc",
      api_key: "abc",
      prompt: "system prompt",
      input_signals: { phone: "+972500000000" },
      env: { SUPABASE_URL: "x" },
      surprise: "field",
    }) as Record<string, unknown>;
    const serialized = JSON.stringify(r);
    expect(serialized).not.toMatch(/abc|system prompt|972500000000|SUPABASE_URL|surprise/);
    expect(Object.keys(r).sort()).toEqual(["brain_executor", "canonical_runtime", "contract", "memory", "tenants"]);
  });

  it("rejects non-enum slugs and long sample values", () => {
    expect(sanitizeReadiness({ tenants: { current_slug: "a b c" } }).tenants.current_slug).toBeNull();
    expect(
      sanitizeReadiness({ contract: { invalid_action_samples: ["x".repeat(200), "send message now"] } }).contract
        .invalid_action_samples,
    ).toEqual([]);
  });
});

describe("brain proposal contract", () => {
  it("accepts only allow-listed proposal actions", () => {
    expect(isBrainProposalAction("observe")).toBe(false);
    expect(isBrainProposalAction("")).toBe(false);
    expect(isBrainProposalAction(null)).toBe(false);
  });

  it("collects bounded, deduplicated offending actions", () => {
    const out = collectInvalidCanonicalActions(["observe", "observe", "weird_action", 5, null]);
    expect(out).toEqual(["observe", "weird_action"]);
    expect(collectInvalidCanonicalActions(Array.from({ length: 20 }, (_, i) => `bad_${i}`)).length).toBe(5);
  });
});

describe("blocker calculation", () => {
  it("reports no blockers when everything is verified and all flags are OFF", () => {
    const blockers = computeReadinessBlockers(HEALTHY, READY);
    expect(blockers).toEqual([]);
    expect(isPilotReady(blockers)).toBe(true);
  });

  it("flags an unreachable gateway", () => {
    const blockers = computeReadinessBlockers(emptyStatus("2026-08-24T08:00:00.000Z", "timeout"), READY);
    expect(blockers[0]?.code).toBe("gateway_unreachable");
    expect(isPilotReady(blockers)).toBe(false);
  });

  it("surfaces a canonical_action outside the Brain allow-list as a contract blocker", () => {
    const readiness = sanitizeReadiness({
      ...READY,
      contract: { checked_runs: 1, invalid_canonical_actions: 1, invalid_action_samples: ["observe"] },
    });
    const blocker = computeReadinessBlockers(HEALTHY, readiness).find((b) => b.code === "shadow_contract_violation");
    expect(blocker?.severity).toBe("blocker");
    expect(blocker?.label_he).toContain("observe");
    expect(nextSafeMilestone(computeReadinessBlockers(HEALTHY, readiness))).toContain("canonical_action");
  });

  it("blocks when the brain executor is not verified and says so truthfully", () => {
    const blockers = computeReadinessBlockers(HEALTHY, sanitizeReadiness({ ...READY, brain_executor: "no" }));
    const b = blockers.find((x) => x.code === "brain_executor_not_verified");
    expect(b?.severity).toBe("blocker");
    expect(b?.label_he).toBe(BRAIN_EXECUTOR_UNVERIFIED_LABEL_HE);
  });

  it("blocks when any live traffic flag is ON", () => {
    const codes = computeReadinessBlockers({ ...HEALTHY, outbound_enabled: true }, READY).map((b) => b.code);
    expect(codes).toContain("live_flags_on");
  });

  it("blocks when tenant isolation is unverified", () => {
    const codes = computeReadinessBlockers(
      HEALTHY,
      sanitizeReadiness({ ...READY, tenants: { total: 0, current_slug: null, isolation_enforced: false } }),
    ).map((b) => b.code);
    expect(codes).toContain("tenant_isolation_unverified");
  });

  it("treats memory availability and shadow backlog as warnings only", () => {
    const blockers = computeReadinessBlockers(
      { ...HEALTHY, shadow: { dead: 1 } as any, comparison: { open: 2 } as any },
      sanitizeReadiness({ ...READY, memory: { ...READY.memory, available: false } }),
    );
    expect(blockers.every((b) => b.severity === "warning")).toBe(true);
    expect(isPilotReady(blockers)).toBe(true);
    expect(blockers.map((b) => b.code)).toEqual([
      "memory_audit_unavailable",
      "shadow_transport_dead_letters",
      "shadow_runs_open",
    ]);
  });

  it("orders blockers before warnings", () => {
    const blockers = computeReadinessBlockers(
      emptyStatus("2026-08-24T08:00:00.000Z", "network_error"),
      sanitizeReadiness({}),
    );
    const firstWarning = blockers.findIndex((b) => b.severity === "warning");
    const lastBlocker = blockers.map((b) => b.severity).lastIndexOf("blocker");
    expect(firstWarning === -1 || firstWarning > lastBlocker).toBe(true);
  });

  it("never suggests enabling live traffic as the next milestone", () => {
    for (const s of [HEALTHY, emptyStatus("2026-08-24T08:00:00.000Z", "timeout")]) {
      const ms = nextSafeMilestone(computeReadinessBlockers(s, sanitizeReadiness({})));
      expect(ms).not.toMatch(/להפעיל תעבורה|לפתוח תעבורה/);
    }
  });
});
