/**
 * ZOOGA OS SHADOW BRAIN — server-only, READ-ONLY admin projection.
 *
 * Lovable never calls OpenAI. The Shadow Brain executes exclusively inside the
 * Zooga Gateway container on Hostinger, which authenticates with its own
 * gateway token and uses the SECURITY DEFINER RPCs
 * (zooga_brain_claim_runs / zooga_brain_record_proposal /
 *  zooga_brain_release_run / zooga_brain_usage_today).
 *
 * This module only reads sanitized counters for the admin Control Center.
 * No API key is stored, read, or returned anywhere.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveTenantId } from "./shadow-outbox.server";
import {
  sanitizeBrainStatus,
  EMPTY_BRAIN_STATUS,
  type ShadowBrainStatus,
} from "./shadow-brain-contract";

const CONFIG_TABLE = "zooga_shadow_brain_config";
const USAGE_TABLE = "zooga_shadow_brain_usage";

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Aggregate, non-sensitive brain counters for tenant zooga. Never throws. */
export async function getShadowBrainStatus(): Promise<ShadowBrainStatus> {
  try {
    const tenantId = await resolveTenantId();
    if (!tenantId) return { ...EMPTY_BRAIN_STATUS };

    const [cfgRes, usageRes, leasedRes] = await Promise.all([
      supabaseAdmin
        .from(CONFIG_TABLE as any)
        .select(
          "enabled, model_id, model_version, prompt_version, daily_request_limit, daily_input_token_limit, daily_output_token_limit, daily_cost_limit_usd",
        )
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabaseAdmin
        .from(USAGE_TABLE as any)
        .select("requests, successes, errors, input_tokens, output_tokens, cost_usd")
        .eq("tenant_id", tenantId)
        .eq("usage_date", utcToday())
        .maybeSingle(),
      supabaseAdmin
        .from("zooga_shadow_runs" as any)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("brain_state", "leased"),
    ]);

    const cfg = (cfgRes.data ?? {}) as any;
    const usage = (usageRes.data ?? {}) as any;

    return sanitizeBrainStatus({
      enabled: cfg.enabled === true,
      model_id: cfg.model_id,
      model_version: cfg.model_version,
      prompt_version: cfg.prompt_version,
      requests_today: usage.requests,
      successes_today: usage.successes,
      errors_today: usage.errors,
      input_tokens_today: usage.input_tokens,
      output_tokens_today: usage.output_tokens,
      cost_usd_today: usage.cost_usd,
      daily_request_limit: cfg.daily_request_limit,
      daily_input_token_limit: cfg.daily_input_token_limit,
      daily_output_token_limit: cfg.daily_output_token_limit,
      daily_cost_limit_usd: cfg.daily_cost_limit_usd,
      leased_runs: (leasedRes as any)?.count ?? 0,
    });
  } catch {
    return { ...EMPTY_BRAIN_STATUS };
  }
}
