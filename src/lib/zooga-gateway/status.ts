/**
 * ZOOGA OS CONTROL PLANE — STATUS SANITIZER (pure, client-safe).
 *
 * STATUS-ONLY: never carries commands, writes, or secrets.
 * Only an explicit allow-list of fields is ever surfaced; arbitrary upstream
 * JSON is dropped. Booleans default to the SAFE value (false / OFF).
 */

export type GatewayIntegrations = {
  supabase: boolean;
  whatsapp: boolean;
  meta: boolean;
};

import type { ShadowMetrics } from "./shadow";
import type { ShadowComparisonMetrics } from "./shadow-compare";
import type { ShadowBrainStatus } from "./shadow-brain-contract";
import type { ZoogaReadiness } from "./readiness";

export type GatewayStatus = {
  /** Supabase-side shadow transport counters. Never comes from upstream JSON. */
  shadow?: ShadowMetrics;
  /** Supabase-side shadow comparison counters. Never comes from upstream JSON. */
  comparison?: ShadowComparisonMetrics;
  /** Supabase-side shadow brain status. Never comes from upstream JSON. */
  brain?: ShadowBrainStatus;
  /** Supabase-side readiness projection. Never comes from upstream JSON. */
  readiness?: ZoogaReadiness;

  reachable: boolean;
  checked_at: string;
  latency_ms: number | null;
  system: string | null;
  environment: string | null;
  tenant: string | null;
  live_traffic: boolean;
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  integrations: GatewayIntegrations;
  error_code: string | null;
};

export type GatewayErrorCode =
  | "unauthorized"
  | "forbidden"
  | "config_unavailable"
  | "timeout"
  | "network_error"
  | "upstream_error"
  | "invalid_response";

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}

function asStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > 64) return null;
  return s;
}

export function emptyStatus(checkedAt: string, errorCode: GatewayErrorCode, latencyMs: number | null = null): GatewayStatus {
  return {
    reachable: false,
    checked_at: checkedAt,
    latency_ms: latencyMs,
    system: null,
    environment: null,
    tenant: null,
    live_traffic: false,
    inbound_enabled: false,
    outbound_enabled: false,
    integrations: { supabase: false, whatsapp: false, meta: false },
    error_code: errorCode,
  };
}

/** Strict allow-list projection of an upstream /v1/system/status body. */
export function sanitizeGatewayStatus(
  raw: unknown,
  opts: { checkedAt: string; latencyMs: number | null },
): GatewayStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyStatus(opts.checkedAt, "invalid_response", opts.latencyMs);
  }
  const r = raw as Record<string, unknown>;
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const integrations = obj(r["integrations"]);
  const execution = obj(r["execution"]);

  return {
    reachable: true,
    checked_at: opts.checkedAt,
    latency_ms: opts.latencyMs,
    system: asStr(r["system"]),
    environment: asStr(r["environment"]),
    // Gateway sends default_tenant; `tenant` kept as backward-compatible fallback.
    tenant: asStr(r["default_tenant"]) ?? asStr(r["tenant"]),
    live_traffic: asBool(r["live_traffic"]),
    // Gateway nests the execution flags; top-level kept as fallback.
    inbound_enabled: asBool(execution["inbound_enabled"]) || asBool(r["inbound_enabled"]),
    outbound_enabled: asBool(execution["outbound_enabled"]) || asBool(r["outbound_enabled"]),
    integrations: {
      supabase: asBool(integrations["supabase"]),
      whatsapp: asBool(integrations["whatsapp"]),
      meta: asBool(integrations["meta"]),
    },
    error_code: null,
  };
}
