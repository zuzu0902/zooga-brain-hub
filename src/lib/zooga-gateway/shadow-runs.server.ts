/**
 * ZOOGA OS SHADOW COMPARISON — server-only ledger helpers.
 *
 * Observation only: no customer send, no LLM, no CRM mutation, no traffic
 * switch. Every write is best-effort and can never throw into a caller.
 * Only sanitized allow-list signals are persisted.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveTenantId } from "./shadow-outbox.server";
import {
  buildShadowInputSignals,
  evaluateShadowRun,
  hashInputSignals,
  sanitizeComparisonMetrics,
  EMPTY_COMPARISON_METRICS,
  type ShadowComparisonMetrics,
  type ShadowOutcome,
} from "./shadow-compare";
import { ADAPTER_DISABLED_CODE, type ShadowProposal } from "./shadow-decision-adapter";

const RUN_KIND = "shadow_v1";
const TABLE = "zooga_shadow_runs";
const METRICS_ROW_CAP = 5000;

export type OpenShadowRunInput = {
  eventId: string;
  correlationId?: string | null;
  signals: unknown;
  canonical?: ShadowOutcome | null;
  canonicalStateBefore?: string | null;
  canonicalDecisionRef?: string | null;
};

function short(v: unknown, max = 64): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function codes(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map((c) => short(c, 48)).filter((c): c is string => !!c).slice(0, 20)
    : [];
}

/**
 * Idempotent open. A repeat delivery of the same event never creates a second
 * row (unique on tenant_id + event_id + run_kind).
 */
export async function openShadowRun(input: OpenShadowRunInput): Promise<boolean> {
  try {
    const tenantId = await resolveTenantId();
    if (!tenantId) return false;
    const eventId = short(input.eventId, 200);
    if (!eventId) return false;

    const signals = buildShadowInputSignals(input.signals);
    const { error } = await supabaseAdmin
      .from(TABLE as any)
      .upsert(
        {
          tenant_id: tenantId,
          run_kind: RUN_KIND,
          event_id: eventId,
          correlation_id: short(input.correlationId),
          canonical_decision_ref: short(input.canonicalDecisionRef, 120),
          input_signals: signals,
          input_hash: hashInputSignals(signals),
          canonical_action: short(input.canonical?.action),
          canonical_state_before: short(input.canonicalStateBefore),
          canonical_state_after: short(input.canonical?.state_after),
          canonical_reason_codes: codes(input.canonical?.reason_codes),
          eval_status: "pending",
          status: "open",
        } as any,
        { onConflict: "tenant_id,event_id,run_kind", ignoreDuplicates: true },
      );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Records a proposal. While the adapter is intentionally disabled the run
 * STAYS open/pending — `adapter_disabled` is observability, not a verdict.
 */
export async function recordProposedDecision(args: {
  eventId: string;
  proposal: ShadowProposal;
}): Promise<"pending" | "finalized" | "skipped"> {
  try {
    const tenantId = await resolveTenantId();
    const eventId = short(args.eventId, 200);
    if (!tenantId || !eventId) return "skipped";

    const p = args.proposal;
    const disabled = p.error_code === ADAPTER_DISABLED_CODE;

    const patch: Record<string, unknown> = {
      provider: short(p.provider, 32),
      model_id: short(p.model_id, 64),
      model_version: short(p.model_version, 32),
      latency_ms: Number.isFinite(p.latency_ms as number) ? p.latency_ms : null,
      input_tokens: Number.isFinite(p.input_tokens as number) ? p.input_tokens : null,
      output_tokens: Number.isFinite(p.output_tokens as number) ? p.output_tokens : null,
      cost_usd: Number.isFinite(p.cost_usd as number) ? p.cost_usd : null,
      error_code: short(p.error_code, 48),
    };

    if (disabled) {
      // Intentionally off: keep the run open and pending for a later brain.
      const { error } = await supabaseAdmin
        .from(TABLE as any)
        .update(patch as any)
        .eq("tenant_id", tenantId)
        .eq("event_id", eventId)
        .eq("run_kind", RUN_KIND)
        .eq("status", "open");
      return error ? "skipped" : "pending";
    }

    patch["proposed_action"] = short(p.outcome?.action);
    patch["proposed_state_after"] = short(p.outcome?.state_after);
    patch["proposed_reason_codes"] = codes(p.outcome?.reason_codes);
    patch["proposed_confidence"] =
      typeof p.confidence === "number" && p.confidence >= 0 && p.confidence <= 1 ? p.confidence : null;

    const { error } = await supabaseAdmin
      .from(TABLE as any)
      .update(patch as any)
      .eq("tenant_id", tenantId)
      .eq("event_id", eventId)
      .eq("run_kind", RUN_KIND)
      .eq("status", "open");
    return error ? "skipped" : "pending";
  } catch {
    return "skipped";
  }
}

/** Single-shot finalization. Only ever applied to a run still `open`. */
export async function finalizeShadowRun(eventId: string): Promise<boolean> {
  try {
    const tenantId = await resolveTenantId();
    const id = short(eventId, 200);
    if (!tenantId || !id) return false;

    const { data, error } = await supabaseAdmin
      .from(TABLE as any)
      .select(
        "canonical_action, canonical_state_after, canonical_reason_codes, proposed_action, proposed_state_after, proposed_reason_codes, error_code",
      )
      .eq("tenant_id", tenantId)
      .eq("event_id", id)
      .eq("run_kind", RUN_KIND)
      .eq("status", "open")
      .maybeSingle();
    if (error || !data) return false;

    const row = data as any;
    // A disabled adapter is not a result: nothing to finalize yet.
    if (row.error_code === ADAPTER_DISABLED_CODE) return false;

    const evaluation = evaluateShadowRun({
      canonical: {
        action: row.canonical_action,
        state_after: row.canonical_state_after,
        reason_codes: row.canonical_reason_codes,
      },
      proposed: {
        action: row.proposed_action,
        state_after: row.proposed_state_after,
        reason_codes: row.proposed_reason_codes,
      },
      errorCode: row.error_code,
    });

    const { error: updateError } = await supabaseAdmin
      .from(TABLE as any)
      .update({
        eval_status: evaluation.eval_status,
        eval_reason_codes: evaluation.eval_reason_codes,
        evaluated_at: new Date().toISOString(),
        status: "finalized",
      } as any)
      .eq("tenant_id", tenantId)
      .eq("event_id", id)
      .eq("run_kind", RUN_KIND)
      .eq("status", "open");
    return !updateError;
  } catch {
    return false;
  }
}

/** Bounded retention maintenance. Safe to run on the protected scheduler. */
export async function pruneShadowRuns(limit = 200): Promise<number> {
  try {
    const bounded = Math.max(1, Math.min(limit, 1000));
    const { data, error } = await (supabaseAdmin as any).rpc("zooga_shadow_runs_prune", {
      p_limit: bounded,
    });
    if (error) return 0;
    const n = Number(Array.isArray(data) ? data[0] : data);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Math.floor(sorted[idx] ?? 0);
}

/** Aggregate, non-sensitive counters for the admin Control Center. */
export async function getShadowRunMetrics(): Promise<ShadowComparisonMetrics> {
  try {
    const tenantId = await resolveTenantId();
    if (!tenantId) return { ...EMPTY_COMPARISON_METRICS };

    const { data, error } = await supabaseAdmin
      .from(TABLE as any)
      .select("eval_status, status, error_code, latency_ms, created_at")
      .eq("tenant_id", tenantId)
      .limit(METRICS_ROW_CAP);
    if (error || !Array.isArray(data)) return { ...EMPTY_COMPARISON_METRICS };

    const acc: Record<string, number> = {};
    const errorCodes: Record<string, number> = {};
    const latencies: number[] = [];
    let open = 0;
    let adapterDisabled = 0;
    let oldestOpen: number | null = null;

    for (const r of data as any[]) {
      acc[r.eval_status] = (acc[r.eval_status] ?? 0) + 1;
      if (r.status === "open") {
        open++;
        const t = new Date(r.created_at).getTime();
        if (Number.isFinite(t) && (oldestOpen === null || t < oldestOpen)) oldestOpen = t;
      }
      if (r.error_code === ADAPTER_DISABLED_CODE) adapterDisabled++;
      else if (typeof r.error_code === "string" && r.error_code) {
        errorCodes[r.error_code] = (errorCodes[r.error_code] ?? 0) + 1;
      }
      if (typeof r.latency_ms === "number") latencies.push(r.latency_ms);
    }

    const match = acc["match"] ?? 0;
    const mismatch =
      (acc["mismatch_action"] ?? 0) + (acc["mismatch_state"] ?? 0) + (acc["mismatch_reason_only"] ?? 0);
    const compared = match + mismatch;
    const topError = Object.entries(errorCodes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return sanitizeComparisonMetrics({
      total: data.length,
      open,
      pending: acc["pending"] ?? 0,
      match,
      mismatch,
      proposal_missing: acc["proposal_missing"] ?? 0,
      canonical_missing: acc["canonical_missing"] ?? 0,
      error: acc["error"] ?? 0,
      mismatch_rate: compared > 0 ? mismatch / compared : null,
      p95_latency_ms: percentile(latencies, 0.95),
      adapter_disabled: adapterDisabled,
      top_error_code: topError,
      oldest_open_age_seconds: oldestOpen === null ? null : Math.floor((Date.now() - oldestOpen) / 1000),
    });
  } catch {
    return { ...EMPTY_COMPARISON_METRICS };
  }
}
