/**
 * TAMAR BRAIN V2 — cost-aware model routing (PURE, no I/O).
 *
 * One rule, applied everywhere: a NORMAL turn runs on the cheapest capable
 * configured model; the stronger model is reserved for genuinely complex /
 * ambiguous / sensitive turns and for exactly ONE validation retry after a
 * structured-output failure. Every choice carries an explicit reason code
 * that is logged next to tokens, latency and estimated cost.
 */

export type TurnComplexity = "simple" | "complex";

/** Default cheap / strong models per stage when the registry says nothing. */
export const DEFAULT_CHEAP_MODEL = "openai/gpt-5.6-luna";
export const DEFAULT_STRONG_MODEL = "openai/gpt-5.6-terra";

/** USD per 1M tokens (input, output). Estimation only — never billing truth. */
export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  "openai/gpt-5.6-luna": { in: 0.1, out: 0.4 },
  "openai/gpt-5.6-terra": { in: 1.25, out: 10 },
  "openai/gpt-5.6-sol": { in: 2.5, out: 20 },
  "openai/gpt-5.4-mini": { in: 0.25, out: 2 },
  "openai/gpt-5.4": { in: 1.25, out: 10 },
  "google/gemini-3.1-flash-lite": { in: 0.1, out: 0.4 },
  "google/gemini-3.6-flash": { in: 0.3, out: 2.5 },
  "google/gemini-3.7-flash": { in: 0.3, out: 2.5 },
  "google/gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "google/gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "google/gemini-2.5-pro": { in: 1.25, out: 10 },
  "google/gemini-3.1-pro-preview": { in: 1.25, out: 10 },
};

export function estimateCostUsd(modelId: string, promptTokens = 0, completionTokens = 0): number | null {
  const p = MODEL_PRICES[modelId];
  if (!p) return null;
  const usd = (promptTokens / 1_000_000) * p.in + (completionTokens / 1_000_000) * p.out;
  return Math.round(usd * 1e6) / 1e6;
}

export type RoutePlan = {
  /** ordered model candidates: primary first, then escalation/fallback */
  candidates: string[];
  model_id: string;
  routing_reason: string;
  complexity: TurnComplexity;
};

/**
 * Choose the model for one stage call.
 *
 * simple  -> cheap model (registry `cheap_model`, else the stage model)
 * complex -> strong model (registry `model_id`, else configured strong)
 * retry   -> forced escalation to the strong model, once.
 */
export function planModelRoute(args: {
  stage: string;
  /** the registry's configured (strong) model for this stage */
  model_id: string;
  /** the registry's configured cheap model for this stage, when any */
  cheap_model?: string | null;
  fallback_model?: string | null;
  complexity?: TurnComplexity;
  /** true when a previous structured-output attempt failed validation */
  validationRetry?: boolean;
  /** models the admin allowlist has verified; empty = no restriction */
  allowlist?: string[];
}): RoutePlan {
  const complexity: TurnComplexity = args.complexity ?? "simple";
  const allowed = (m: string | null | undefined): m is string =>
    !!m && (!args.allowlist?.length || args.allowlist.includes(m));

  const strong = allowed(args.model_id) ? args.model_id : allowed(DEFAULT_STRONG_MODEL) ? DEFAULT_STRONG_MODEL : args.model_id;
  const cheap = allowed(args.cheap_model) ? args.cheap_model : allowed(DEFAULT_CHEAP_MODEL) ? DEFAULT_CHEAP_MODEL : null;

  if (args.validationRetry) {
    return {
      candidates: [strong],
      model_id: strong,
      routing_reason: "validation_retry_escalation",
      complexity,
    };
  }
  if (complexity === "complex" || !cheap || cheap === strong) {
    return {
      candidates: [strong, ...(allowed(args.fallback_model) ? [args.fallback_model] : [])],
      model_id: strong,
      routing_reason: complexity === "complex" ? "complex_turn_strong_model" : "no_cheap_model_configured",
      complexity,
    };
  }
  return {
    candidates: [cheap, strong],
    model_id: cheap,
    routing_reason: "simple_turn_cheap_model",
    complexity,
  };
}
