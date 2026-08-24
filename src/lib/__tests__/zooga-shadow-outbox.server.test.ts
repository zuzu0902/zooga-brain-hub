import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: string; event_id: string; correlation_id: string | null; source: string; event_type: string; occurred_at: string; payload: unknown };

const rpc = vi.fn();
const upsert = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => maybeSingle(table),
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      upsert: (...a: unknown[]) => upsert(...a),
    }),
  },
}));

const { enqueueShadowEnvelope, drainShadowOutbox } = await import("@/lib/zooga-gateway/shadow-outbox.server");

const CLAIMED: Row[] = [
  { id: "r1", event_id: "e1", correlation_id: "c1", source: "meta", event_type: "messages", occurred_at: "2026-08-24T08:00:00.000Z", payload: { kind: "message", provider_event_present: true, duplicate: false } },
  { id: "r2", event_id: "e2", correlation_id: "c2", source: "meta", event_type: "messages", occurred_at: "2026-08-24T08:00:01.000Z", payload: { kind: "status", provider_event_present: true, duplicate: false } },
];

function rpcRouter(fetchable = true) {
  return (name: string, _args?: unknown) => {
    if (name === "zooga_control_plane_config") {
      return Promise.resolve(
        fetchable
          ? { data: [{ gateway_url: "https://gw.example.com/", bearer_token: "SECRET-TOKEN" }], error: null }
          : { data: [], error: null },
      );
    }
    if (name === "zooga_shadow_claim") return Promise.resolve({ data: CLAIMED, error: null });
    return Promise.resolve({ data: null, error: null });
  };
}

beforeEach(() => {
  rpc.mockReset();
  upsert.mockReset();
  maybeSingle.mockReset();
  maybeSingle.mockResolvedValue({ data: { id: "tenant-zooga" }, error: null });
  upsert.mockResolvedValue({ error: null });
});

describe("enqueueShadowEnvelope", () => {
  it("performs a single idempotent metadata-only insert", async () => {
    const ok = await enqueueShadowEnvelope({
      eventId: "wamid.1",
      correlationId: "corr",
      eventType: "messages",
      occurredAt: null,
      kind: "message",
      providerEventPresent: true,
      duplicate: false,
    });
    expect(ok).toBe(true);
    const [row, opts] = upsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: "tenant_id,event_id", ignoreDuplicates: true });
    expect(Object.keys(row.payload).sort()).toEqual(["duplicate", "kind", "provider_event_present"]);
    expect(JSON.stringify(row)).not.toMatch(/phone|text|full_name/);
  });

  it("returns false instead of throwing when the insert fails", async () => {
    upsert.mockResolvedValue({ error: { message: "boom" } });
    await expect(
      enqueueShadowEnvelope({ eventId: "x", kind: "message", providerEventPresent: true, duplicate: false }),
    ).resolves.toBe(false);
  });
});

describe("drainShadowOutbox", () => {
  it("fails closed when the gateway config is unavailable", async () => {
    rpc.mockImplementation(rpcRouter(false));
    const res = await drainShadowOutbox(5);
    expect(res).toEqual({ claimed: 0, delivered: 0, failed: 0, error_code: "config_unavailable" });
  });

  it("treats only 202 as success and never leaks the token to callers", async () => {
    rpc.mockImplementation(rpcRouter());
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      seen.push(init);
      return new Response(null, { status: 202 });
    }));
    const res = await drainShadowOutbox(20);
    expect(res).toEqual({ claimed: 2, delivered: 2, failed: 0, error_code: null });
    expect(JSON.stringify(res)).not.toContain("SECRET-TOKEN");
    const sent = JSON.parse(seen[0].body as string);
    expect(sent).not.toHaveProperty("raw");
    expect(sent.tenant_id).toBe("zooga");
    expect(Object.keys(sent).sort()).toEqual([
      "correlation_id",
      "event_id",
      "occurred_at",
      "payload",
      "source",
      "tenant_id",
      "type",
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/phone|text|full_name/);
    expect(rpc.mock.calls.filter(([n]) => n === "zooga_shadow_complete")).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("keeps processing the batch after one failure and records a short error code", async () => {
    rpc.mockImplementation(rpcRouter());
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++;
      if (n === 1) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return new Response(null, { status: 202 });
    }));
    const res = await drainShadowOutbox(20);
    expect(res.claimed).toBe(2);
    expect(res.delivered).toBe(1);
    expect(res.failed).toBe(1);
    const fail = rpc.mock.calls.find(([name]) => name === "zooga_shadow_fail");
    expect(fail?.[1]).toEqual({ p_id: "r1", p_error: "timeout" });
    vi.unstubAllGlobals();
  });

  it("marks non-202 upstream responses as retryable failures", async () => {
    rpc.mockImplementation(rpcRouter());
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const res = await drainShadowOutbox(20);
    expect(res.failed).toBe(2);
    expect(res.delivered).toBe(0);
    const fail = rpc.mock.calls.find(([name]) => name === "zooga_shadow_fail");
    expect(fail?.[1].p_error).toBe("upstream_error");
    vi.unstubAllGlobals();
  });

  it("clamps the batch size to the bounded maximum", async () => {
    rpc.mockImplementation(rpcRouter());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
    await drainShadowOutbox(500);
    const claim = rpc.mock.calls.find(([name]) => name === "zooga_shadow_claim");
    expect(claim?.[1].p_limit).toBe(20);
    vi.unstubAllGlobals();
  });
});
