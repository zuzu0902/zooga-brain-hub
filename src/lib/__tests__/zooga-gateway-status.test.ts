import { describe, it, expect, vi, afterEach } from "vitest";
import { sanitizeGatewayStatus, emptyStatus } from "@/lib/zooga-gateway/status";

const CHECKED = "2026-08-24T08:00:00.000Z";

/** Real Hostinger Gateway /v1/system/status payload shape. */
const REAL_PAYLOAD = {
  system: "zooga-os",
  environment: "foundation",
  live_traffic: false,
  default_tenant: "zooga",
  integrations: { supabase: true, meta: false, lovable: true, llm: false },
  execution: { inbound_enabled: false, outbound_enabled: false },
  safety: { kill_switch: true, notes: "do-not-leak", bearer_token: "super-secret" },
};

describe("sanitizeGatewayStatus", () => {
  it("maps the real Gateway payload and drops arbitrary fields", () => {
    const out = sanitizeGatewayStatus({ ...REAL_PAYLOAD, raw: { anything: 1 } }, { checkedAt: CHECKED, latencyMs: 42 });
    expect(out).toEqual({
      reachable: true,
      checked_at: CHECKED,
      latency_ms: 42,
      system: "zooga-os",
      environment: "foundation",
      tenant: "zooga",
      live_traffic: false,
      inbound_enabled: false,
      outbound_enabled: false,
      integrations: { supabase: true, whatsapp: false, meta: false },
      error_code: null,
    });
    // regression: safety/raw/token and unknown integration keys never surface
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("safety");
    expect(serialized).not.toContain("kill_switch");
    expect(serialized).not.toContain("lovable");
    expect(serialized).not.toContain("anything");
    expect(out).not.toHaveProperty("default_tenant");
    expect(out).not.toHaveProperty("execution");
  });

  it("maps default_tenant -> tenant and nested execution flags", () => {
    const out = sanitizeGatewayStatus(
      {
        ...REAL_PAYLOAD,
        default_tenant: "zooga",
        execution: { inbound_enabled: true, outbound_enabled: false },
      },
      { checkedAt: CHECKED, latencyMs: 5 },
    );
    expect(out.tenant).toBe("zooga");
    expect(out.inbound_enabled).toBe(true);
    expect(out.outbound_enabled).toBe(false);
  });

  it("falls back to legacy top-level tenant/execution fields", () => {
    const out = sanitizeGatewayStatus(
      { tenant: "legacy", inbound_enabled: true, outbound_enabled: true, integrations: { supabase: true } },
      { checkedAt: CHECKED, latencyMs: 7 },
    );
    expect(out.tenant).toBe("legacy");
    expect(out.inbound_enabled).toBe(true);
    expect(out.outbound_enabled).toBe(true);
    expect(out.integrations.supabase).toBe(true);
  });

  it("defaults booleans to the safe OFF value", () => {
    const out = sanitizeGatewayStatus({}, { checkedAt: CHECKED, latencyMs: null });
    expect(out.live_traffic).toBe(false);
    expect(out.inbound_enabled).toBe(false);
    expect(out.outbound_enabled).toBe(false);
    expect(out.integrations).toEqual({ supabase: false, whatsapp: false, meta: false });
  });

  it("rejects non-object bodies", () => {
    expect(sanitizeGatewayStatus("nope", { checkedAt: CHECKED, latencyMs: 3 }).error_code).toBe("invalid_response");
    expect(sanitizeGatewayStatus([1, 2], { checkedAt: CHECKED, latencyMs: 3 }).reachable).toBe(false);
  });

  it("emptyStatus is unreachable and all-OFF", () => {
    const out = emptyStatus(CHECKED, "unauthorized");
    expect(out.reachable).toBe(false);
    expect(out.live_traffic || out.inbound_enabled || out.outbound_enabled).toBe(false);
    expect(out.error_code).toBe("unauthorized");
  });
});

describe("getGatewayStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  async function load(rpcResult: any, fetchImpl: any) {
    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: { rpc: vi.fn().mockResolvedValue(rpcResult) },
    }));
    vi.stubGlobal("fetch", fetchImpl);
    return (await import("@/lib/zooga-gateway/gateway.server")).getGatewayStatus();
  }

  it("returns config_unavailable when the RPC fails", async () => {
    const out = await load({ data: null, error: { message: "denied" } }, vi.fn());
    expect(out.error_code).toBe("config_unavailable");
    expect(out.reachable).toBe(false);
  });

  it("maps an aborted request to timeout", async () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    const out = await load(
      { data: [{ gateway_url: "https://gw.example.com", bearer_token: "tok" }], error: null },
      vi.fn().mockRejectedValue(err),
    );
    expect(out.error_code).toBe("timeout");
    expect(out.reachable).toBe(false);
  });

  it("maps a non-OK upstream response to upstream_error", async () => {
    const out = await load(
      { data: [{ gateway_url: "https://gw.example.com", bearer_token: "tok" }], error: null },
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }),
    );
    expect(out.error_code).toBe("upstream_error");
  });

  it("sends the bearer token upstream but never returns it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        system: "zooga-os",
        environment: "foundation",
        default_tenant: "zooga",
        integrations: { supabase: true, meta: false, lovable: true, llm: false },
        execution: { inbound_enabled: false, outbound_enabled: false },
        safety: { kill_switch: true },
      }),
    });
    const out = await load(
      { data: [{ gateway_url: "https://gw.example.com/", bearer_token: "tok-123" }], error: null },
      fetchMock,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gw.example.com/v1/system/status");
    expect(init.headers.Authorization).toBe("Bearer tok-123");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeDefined();
    expect(out.reachable).toBe(true);
    expect(JSON.stringify(out)).not.toContain("tok-123");
    expect(out.live_traffic).toBe(false);
    expect(out.tenant).toBe("zooga");
    expect(out.inbound_enabled).toBe(false);
    expect(JSON.stringify(out)).not.toContain("safety");
  });
});
