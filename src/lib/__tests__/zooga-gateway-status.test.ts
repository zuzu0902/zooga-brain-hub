import { describe, it, expect, vi, afterEach } from "vitest";
import { sanitizeGatewayStatus, emptyStatus } from "@/lib/zooga-gateway/status";

const CHECKED = "2026-08-24T08:00:00.000Z";

describe("sanitizeGatewayStatus", () => {
  it("projects only allow-listed fields and drops arbitrary upstream JSON", () => {
    const out = sanitizeGatewayStatus(
      {
        system: "zooga-gateway",
        environment: "production",
        tenant: "zooga",
        live_traffic: false,
        inbound_enabled: false,
        outbound_enabled: false,
        integrations: { supabase: true, whatsapp: false, meta: false, secret: true },
        bearer_token: "super-secret",
        raw: { anything: 1 },
      },
      { checkedAt: CHECKED, latencyMs: 42 },
    );
    expect(out).toEqual({
      reachable: true,
      checked_at: CHECKED,
      latency_ms: 42,
      system: "zooga-gateway",
      environment: "production",
      tenant: "zooga",
      live_traffic: false,
      inbound_enabled: false,
      outbound_enabled: false,
      integrations: { supabase: true, whatsapp: false, meta: false },
      error_code: null,
    });
    expect(JSON.stringify(out)).not.toContain("super-secret");
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
      json: async () => ({ system: "zooga-gateway", tenant: "zooga", integrations: { supabase: true } }),
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
  });
});
