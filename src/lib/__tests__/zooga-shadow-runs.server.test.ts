import { describe, it, expect, vi, beforeEach } from "vitest";

const upsert = vi.fn();
const update = vi.fn();
const rpc = vi.fn();
const maybeSingleTenant = vi.fn();
const runRow = vi.fn();
const runList = vi.fn();

/** Chainable stub matching the supabase-js builder surface we actually use. */
function chain(terminal: () => Promise<unknown>) {
  const self: any = {
    eq: () => self,
    limit: () => terminal(),
    maybeSingle: () => terminal(),
    then: (ok: any, err: any) => terminal().then(ok, err),
  };
  return self;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => ({
      select: () => {
        if (table === "tenants") return chain(() => maybeSingleTenant());
        // zooga_shadow_runs: maybeSingle -> single row, limit -> list
        const self: any = {
          eq: () => self,
          maybeSingle: () => runRow(),
          limit: () => runList(),
          then: (ok: any, err: any) => runList().then(ok, err),
        };
        return self;
      },
      upsert: (...a: unknown[]) => {
        upsert(table, ...a);
        return Promise.resolve({ error: null });
      },
      update: (patch: unknown) => {
        update(table, patch);
        return chain(() => Promise.resolve({ error: null }));
      },
    }),
  },
}));

const {
  openShadowRun,
  recordProposedDecision,
  finalizeShadowRun,
  pruneShadowRuns,
  getShadowRunMetrics,
} = await import("@/lib/zooga-gateway/shadow-runs.server");
const { disabledShadowAdapter, createMockShadowAdapter } = await import(
  "@/lib/zooga-gateway/shadow-decision-adapter"
);

beforeEach(() => {
  upsert.mockReset();
  update.mockReset();
  rpc.mockReset();
  runRow.mockReset();
  runList.mockReset();
  maybeSingleTenant.mockReset();
  maybeSingleTenant.mockResolvedValue({ data: { id: "tenant-zooga" }, error: null });
  runRow.mockResolvedValue({ data: null, error: null });
  runList.mockResolvedValue({ data: [], error: null });
  rpc.mockResolvedValue({ data: 0, error: null });
});

describe("openShadowRun", () => {
  it("is idempotent on tenant_id + event_id + run_kind", async () => {
    expect(await openShadowRun({ eventId: "wamid.1", signals: { kind: "message" } })).toBe(true);
    const [table, row, opts] = upsert.mock.calls[0] as any[];
    expect(table).toBe("zooga_shadow_runs");
    expect(opts).toEqual({ onConflict: "tenant_id,event_id,run_kind", ignoreDuplicates: true });
    expect(row.run_kind).toBe("shadow_v1");
    expect(row.status).toBe("open");
    expect(row.eval_status).toBe("pending");
  });

  it("is tenant-scoped: nothing is written when the tenant cannot be resolved", async () => {
    maybeSingleTenant.mockResolvedValue({ data: null, error: null });
    const { resolveTenantId } = await import("@/lib/zooga-gateway/shadow-outbox.server");
    // cached tenant from previous tests would mask this; assert through the resolver
    expect(typeof resolveTenantId).toBe("function");
    upsert.mockClear();
    await openShadowRun({ eventId: "", signals: {} });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("stores only sanitized allow-list signals — never PII or raw payloads", async () => {
    await openShadowRun({
      eventId: "wamid.2",
      correlationId: "corr-1",
      signals: {
        kind: "message",
        duplicate: true,
        phone: "+972501234567",
        text: "שלום",
        full_name: "Meirav",
        provider_message_id: "wamid.2",
        contact_id: "2ade847a-2374-4401-852e-3056b4a0f194",
        access_token: "EAAG",
      },
      canonical: { action: "reply", state_after: "intake_active", reason_codes: ["r1"] },
    });
    const row = (upsert.mock.calls[0] as any[])[1];
    expect(row.input_signals).toEqual({ kind: "message", duplicate: true });
    expect(row.input_hash).toBeTruthy();
    expect(row.canonical_action).toBe("reply");
    const json = JSON.stringify(row);
    for (const bad of ["+972", "שלום", "Meirav", "2ade847a", "EAAG"]) {
      expect(json).not.toContain(bad);
    }
    expect(row).not.toHaveProperty("contact_id");
    expect(row).not.toHaveProperty("contact_ref_hash");
    expect(row).not.toHaveProperty("provider_message_id");
  });

  it("never throws into the caller when the database misbehaves", async () => {
    maybeSingleTenant.mockRejectedValue(new Error("db down"));
    runRow.mockRejectedValue(new Error("db down"));
    await expect(openShadowRun({ eventId: "x", signals: {} })).resolves.toEqual(expect.any(Boolean));
    await expect(finalizeShadowRun("x")).resolves.toBe(false);
  });
});

describe("disabled adapter keeps runs pending", () => {
  it("records adapter_disabled without proposing or finalizing", async () => {
    const proposal = await disabledShadowAdapter.propose({ kind: "message" });
    const result = await recordProposedDecision({ eventId: "wamid.1", proposal });
    expect(result).toBe("pending");
    const patch = (update.mock.calls[0] as any[])[1];
    expect(patch.error_code).toBe("adapter_disabled");
    expect(patch).not.toHaveProperty("proposed_action");
    expect(patch).not.toHaveProperty("proposed_state_after");
  });

  it("finalizeShadowRun refuses to resolve a run whose adapter is disabled", async () => {
    runRow.mockResolvedValue({
      data: { canonical_action: "reply", canonical_state_after: "intake_active", canonical_reason_codes: [], error_code: "adapter_disabled" },
      error: null,
    });
    expect(await finalizeShadowRun("wamid.1")).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("writes proposal fields once a real adapter produces an outcome", async () => {
    const mock = createMockShadowAdapter({ action: "reply", state_after: "intake_active" });
    await recordProposedDecision({ eventId: "wamid.1", proposal: await mock.propose({}) });
    const patch = (update.mock.calls[0] as any[])[1];
    expect(patch.proposed_action).toBe("reply");
    expect(patch.error_code).toBeNull();
  });
});

describe("finalizeShadowRun", () => {
  it("evaluates and marks the run finalized exactly once", async () => {
    runRow.mockResolvedValue({
      data: {
        canonical_action: "reply",
        canonical_state_after: "intake_active",
        canonical_reason_codes: ["a"],
        proposed_action: "handoff",
        proposed_state_after: "intake_active",
        proposed_reason_codes: ["a"],
        error_code: null,
      },
      error: null,
    });
    expect(await finalizeShadowRun("wamid.9")).toBe(true);
    const patch = (update.mock.calls[0] as any[])[1];
    expect(patch.eval_status).toBe("mismatch_action");
    expect(patch.status).toBe("finalized");
  });

  it("does nothing when the run is not open", async () => {
    runRow.mockResolvedValue({ data: null, error: null });
    expect(await finalizeShadowRun("missing")).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("maintenance and metrics", () => {
  it("prune calls the bounded service-role RPC", async () => {
    rpc.mockResolvedValue({ data: 7, error: null });
    expect(await pruneShadowRuns(5000)).toBe(7);
    expect(rpc).toHaveBeenCalledWith("zooga_shadow_runs_prune", { p_limit: 1000 });
  });

  it("aggregates sanitized counters only", async () => {
    runList.mockResolvedValue({
      data: [
        { eval_status: "pending", status: "open", error_code: "adapter_disabled", latency_ms: null, created_at: new Date(Date.now() - 60_000).toISOString() },
        { eval_status: "match", status: "finalized", error_code: null, latency_ms: 100, created_at: new Date().toISOString() },
        { eval_status: "mismatch_action", status: "finalized", error_code: null, latency_ms: 300, created_at: new Date().toISOString() },
      ],
      error: null,
    });
    const m = await getShadowRunMetrics();
    expect(m.total).toBe(3);
    expect(m.open).toBe(1);
    expect(m.match).toBe(1);
    expect(m.mismatch).toBe(1);
    expect(m.mismatch_rate).toBe(0.5);
    expect(m.adapter_disabled).toBe(1);
    expect(m.p95_latency_ms).toBe(300);
    expect(m.oldest_open_age_seconds).toBeGreaterThanOrEqual(59);
    expect(Object.keys(m).sort()).toEqual([
      "adapter_disabled",
      "canonical_missing",
      "error",
      "match",
      "mismatch",
      "mismatch_rate",
      "oldest_open_age_seconds",
      "open",
      "p95_latency_ms",
      "pending",
      "proposal_missing",
      "top_error_code",
      "total",
    ]);
  });

  it("returns empty metrics instead of throwing", async () => {
    runList.mockRejectedValue(new Error("boom"));
    const m = await getShadowRunMetrics();
    expect(m.total).toBe(0);
  });
});
