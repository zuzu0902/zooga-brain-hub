/**
 * ZOOGA OS SHADOW TRANSPORT — server-only outbox (observation only).
 *
 * Enqueue is a single local Supabase insert on the live webhook path; the
 * Gateway is NEVER contacted inline. Draining is a bounded background job
 * that POSTs metadata-only envelopes to {gateway_url}/v1/events/shadow.
 * No customer message, no LLM, no contact/state mutation, no traffic switch.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildShadowEnvelope,
  deliveryErrorCode,
  sanitizeShadowMetrics,
  EMPTY_SHADOW_METRICS,
  type ShadowEnvelopeInput,
  type ShadowMetrics,
} from "./shadow";

const TENANT_SLUG = "zooga";
const TIMEOUT_MS = 3000;
const MAX_BATCH = 20;

let tenantIdCache: { id: string; at: number } | null = null;

export async function resolveTenantId(): Promise<string | null> {
  if (tenantIdCache && Date.now() - tenantIdCache.at < 300_000) return tenantIdCache.id;
  const { data, error } = await supabaseAdmin
    .from("tenants" as any)
    .select("id")
    .eq("slug", TENANT_SLUG)
    .maybeSingle();
  const id = (data as any)?.id;
  if (error || !id) return null;
  tenantIdCache = { id: String(id), at: Date.now() };
  return String(id);
}

/** Idempotent metadata-only enqueue. Returns false on any failure (best-effort). */
export async function enqueueShadowEnvelope(input: ShadowEnvelopeInput): Promise<boolean> {
  const tenantId = await resolveTenantId();
  if (!tenantId) return false;
  const env = buildShadowEnvelope(input);
  const { error } = await supabaseAdmin
    .from("zooga_shadow_outbox" as any)
    .upsert(
      {
        tenant_id: tenantId,
        event_id: env.event_id,
        correlation_id: env.correlation_id,
        source: env.source,
        event_type: env.event_type,
        occurred_at: env.occurred_at,
        payload: env.payload,
      } as any,
      { onConflict: "tenant_id,event_id", ignoreDuplicates: true },
    );
  return !error;
}

type Config = { gateway_url: string; bearer_token: string };

async function loadConfig(): Promise<Config | null> {
  try {
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

export type DrainResult = {
  claimed: number;
  delivered: number;
  failed: number;
  error_code: string | null;
};

/** Bounded drain. One row's failure never stops the rest of the batch. */
export async function drainShadowOutbox(limit = 10): Promise<DrainResult> {
  const bounded = Math.max(1, Math.min(limit, MAX_BATCH));
  const config = await loadConfig();
  if (!config) return { claimed: 0, delivered: 0, failed: 0, error_code: "config_unavailable" };

  const worker = `shadow-${Math.random().toString(36).slice(2, 10)}`;
  const { data, error } = await (supabaseAdmin as any).rpc("zooga_shadow_claim", {
    p_worker: worker,
    p_limit: bounded,
    p_lease_seconds: 60,
  });
  if (error) return { claimed: 0, delivered: 0, failed: 0, error_code: "claim_failed" };

  const rows: any[] = Array.isArray(data) ? data : [];
  let delivered = 0;
  let failed = 0;

  for (const row of rows) {
    let code: string | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${config.gateway_url}/v1/events/shadow`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.bearer_token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            event_id: row.event_id,
            correlation_id: row.correlation_id,
            source: row.source,
            type: row.event_type,
            occurred_at: row.occurred_at,
            payload: row.payload ?? {},
          }),
        });
        if (res.status !== 202) code = deliveryErrorCode(res.status, false);
      } finally {
        clearTimeout(timer);
      }
    } catch (e: any) {
      code = deliveryErrorCode(null, e?.name === "AbortError");
    }

    try {
      if (code) {
        failed++;
        await (supabaseAdmin as any).rpc("zooga_shadow_fail", { p_id: row.id, p_error: code });
      } else {
        delivered++;
        await (supabaseAdmin as any).rpc("zooga_shadow_complete", { p_id: row.id });
      }
    } catch {
      // bookkeeping failure: the lease expires and the row is retried later
    }
  }

  return { claimed: rows.length, delivered, failed, error_code: null };
}

/** Supabase-side, non-sensitive transport counters for tenant zooga. */
export async function getShadowMetrics(): Promise<ShadowMetrics> {
  try {
    const tenantId = await resolveTenantId();
    if (!tenantId) return { ...EMPTY_SHADOW_METRICS };
    const { data, error } = await supabaseAdmin
      .from("zooga_shadow_outbox" as any)
      .select("status, created_at")
      .eq("tenant_id", tenantId)
      .limit(5000);
    if (error || !Array.isArray(data)) return { ...EMPTY_SHADOW_METRICS };
    const acc: Record<string, number> = {};
    let oldest: number | null = null;
    for (const r of data as any[]) {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      if (r.status === "queued" || r.status === "retry") {
        const t = new Date(r.created_at).getTime();
        if (Number.isFinite(t) && (oldest === null || t < oldest)) oldest = t;
      }
    }
    return sanitizeShadowMetrics({
      ...acc,
      oldest_queued_age_seconds: oldest === null ? null : Math.floor((Date.now() - oldest) / 1000),
    });
  } catch {
    return { ...EMPTY_SHADOW_METRICS };
  }
}
