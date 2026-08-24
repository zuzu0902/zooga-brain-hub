/**
 * ZOOGA OS CONTROL PLANE — GATEWAY STATUS FETCHER (server-only).
 *
 * READ-ONLY: single GET /v1/system/status. No commands, no writes.
 * The bearer token is resolved server-side from public.zooga_control_plane_config()
 * (service_role only) and is NEVER returned, logged, or surfaced.
 */
import {
  emptyStatus,
  sanitizeGatewayStatus,
  type GatewayStatus,
} from "./status";

const TIMEOUT_MS = 5000;

type Config = { gateway_url: string; bearer_token: string };

async function loadConfig(): Promise<Config | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("zooga_control_plane_config");
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    const url = typeof row?.gateway_url === "string" ? row.gateway_url.trim() : "";
    const token = typeof row?.bearer_token === "string" ? row.bearer_token.trim() : "";
    if (!url || !token) return null;
    return { gateway_url: url.replace(/\/+$/, ""), bearer_token: token };
  } catch {
    return null;
  }
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
  const checkedAt = new Date().toISOString();
  const config = await loadConfig();
  if (!config) return emptyStatus(checkedAt, "config_unavailable");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(`${config.gateway_url}/v1/system/status`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.bearer_token}`, Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const latency = Date.now() - started;
    if (!res.ok) return emptyStatus(checkedAt, "upstream_error", latency);
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      return emptyStatus(checkedAt, "invalid_response", latency);
    }
    return sanitizeGatewayStatus(body, { checkedAt, latencyMs: latency });
  } catch (e: any) {
    const latency = Date.now() - started;
    const aborted = e?.name === "AbortError";
    return emptyStatus(checkedAt, aborted ? "timeout" : "network_error", latency);
  } finally {
    clearTimeout(timer);
  }
}
