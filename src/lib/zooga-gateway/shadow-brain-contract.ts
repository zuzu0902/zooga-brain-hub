/**
 * ZOOGA OS SHADOW BRAIN — pure control/data contract (client-safe).
 *
 * This module describes WHAT the Zooga Gateway (Hostinger) may return for a
 * shadow run. It performs NO network call, NO model call and holds NO secret.
 * The OpenAI API key never exists in Lovable/Supabase — it lives only in the
 * Zooga Hostinger container environment.
 *
 * Structured output is a closed contract: action, state_after, reason_codes,
 * confidence. No free text, no message draft, no contact data, no tools.
 */

export const SHADOW_BRAIN_PROMPT_VERSION = "zooga_shadow_brain_v1";
export const SHADOW_BRAIN_MODEL_ID = "gpt-5.6-luna";
export const SHADOW_BRAIN_PROVIDER = "openai";

export const SHADOW_BRAIN_ACTIONS = [
  "noop",
  "ask_consent",
  "ask_intake_question",
  "deliver_value",
  "recommend_offer",
  "request_handoff",
  "close",
] as const;

export const SHADOW_BRAIN_STATES = [
  "new_inbound",
  "consent_pending",
  "consented",
  "intake_active",
  "value_delivered",
  "offer_recommended",
  "human_handoff_queued",
  "human_owned",
  "opted_out",
  "closed",
  "paused",
] as const;

export const SHADOW_BRAIN_ERROR_CODES = [
  "model_error",
  "timeout",
  "invalid_output",
  "rate_limited",
  "budget_exceeded",
  "internal_error",
] as const;

export type ShadowBrainAction = (typeof SHADOW_BRAIN_ACTIONS)[number];
export type ShadowBrainState = (typeof SHADOW_BRAIN_STATES)[number];
export type ShadowBrainErrorCode = (typeof SHADOW_BRAIN_ERROR_CODES)[number];

export const REASON_CODE_RE = /^[a-z0-9_]{2,32}$/;
export const MAX_REASON_CODES = 8;

export type ShadowBrainOutput = {
  action: ShadowBrainAction;
  state_after: ShadowBrainState;
  reason_codes: string[];
  confidence: number;
};

/** JSON schema handed to the Responses API (structured output, strict). */
export const SHADOW_BRAIN_OUTPUT_SCHEMA = {
  name: "zooga_shadow_decision",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["action", "state_after", "reason_codes", "confidence"],
    properties: {
      action: { type: "string", enum: [...SHADOW_BRAIN_ACTIONS] },
      state_after: { type: "string", enum: [...SHADOW_BRAIN_STATES] },
      reason_codes: {
        type: "array",
        maxItems: MAX_REASON_CODES,
        items: { type: "string", pattern: REASON_CODE_RE.source },
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  },
} as const;

/**
 * Model request contract executed ONLY by the Gateway container.
 * store=false, no tools, bounded output. Declared here for review parity.
 */
export const SHADOW_BRAIN_REQUEST_CONTRACT = {
  api: "responses",
  provider: SHADOW_BRAIN_PROVIDER,
  model: SHADOW_BRAIN_MODEL_ID,
  store: false,
  tools: [] as const,
  tool_choice: "none",
  response_format: "json_schema",
  prompt_version: SHADOW_BRAIN_PROMPT_VERSION,
} as const;

export function isShadowBrainAction(v: unknown): v is ShadowBrainAction {
  return typeof v === "string" && (SHADOW_BRAIN_ACTIONS as readonly string[]).includes(v);
}

export function isShadowBrainState(v: unknown): v is ShadowBrainState {
  return typeof v === "string" && (SHADOW_BRAIN_STATES as readonly string[]).includes(v);
}

export function normalizeReasonCodes(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const c of v) {
    if (typeof c !== "string") continue;
    const s = c.trim().toLowerCase();
    if (REASON_CODE_RE.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= MAX_REASON_CODES) break;
  }
  return out;
}

export type ShadowBrainValidation =
  | { ok: true; output: ShadowBrainOutput }
  | { ok: false; error_code: ShadowBrainErrorCode };

/** Strict validation of a Gateway-supplied structured output. Never throws. */
export function validateShadowBrainOutput(raw: unknown): ShadowBrainValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error_code: "invalid_output" };
  }
  const r = raw as Record<string, unknown>;
  if (!isShadowBrainAction(r["action"]) || !isShadowBrainState(r["state_after"])) {
    return { ok: false, error_code: "invalid_output" };
  }
  const confidence = typeof r["confidence"] === "number" ? r["confidence"] : NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, error_code: "invalid_output" };
  }
  return {
    ok: true,
    output: {
      action: r["action"],
      state_after: r["state_after"],
      reason_codes: normalizeReasonCodes(r["reason_codes"]),
      confidence,
    },
  };
}

/** Deterministic cost model, mirrored by the SQL accounting function. */
export function estimateCostUsd(args: {
  inputTokens: number;
  outputTokens: number;
  inputCostPer1k: number;
  outputCostPer1k: number;
}): number {
  const inTok = Math.max(0, Math.floor(args.inputTokens || 0));
  const outTok = Math.max(0, Math.floor(args.outputTokens || 0));
  const cost = (inTok / 1000) * args.inputCostPer1k + (outTok / 1000) * args.outputCostPer1k;
  return Math.round(cost * 1e6) / 1e6;
}

/** Sanitized, admin-only projection of brain state. Never carries secrets. */
export type ShadowBrainStatus = {
  enabled: boolean;
  model_id: string | null;
  model_version: string | null;
  prompt_version: string | null;
  requests_today: number;
  successes_today: number;
  errors_today: number;
  input_tokens_today: number;
  output_tokens_today: number;
  cost_usd_today: number;
  daily_request_limit: number;
  daily_input_token_limit: number;
  daily_output_token_limit: number;
  daily_cost_limit_usd: number;
  leased_runs: number;
};

export const EMPTY_BRAIN_STATUS: ShadowBrainStatus = {
  enabled: false,
  model_id: null,
  model_version: null,
  prompt_version: null,
  requests_today: 0,
  successes_today: 0,
  errors_today: 0,
  input_tokens_today: 0,
  output_tokens_today: 0,
  cost_usd_today: 0,
  daily_request_limit: 0,
  daily_input_token_limit: 0,
  daily_output_token_limit: 0,
  daily_cost_limit_usd: 0,
  leased_runs: 0,
};

const IDENT_RE = /^[a-z0-9._-]{1,64}$/i;

function num(v: unknown, decimals = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function ident(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return IDENT_RE.test(s) ? s : null;
}

/** Allow-list projection. Any unexpected key (e.g. a secret) is dropped. */
export function sanitizeBrainStatus(raw: unknown): ShadowBrainStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_BRAIN_STATUS };
  const r = raw as Record<string, unknown>;
  return {
    enabled: r["enabled"] === true,
    model_id: ident(r["model_id"]),
    model_version: ident(r["model_version"]),
    prompt_version: ident(r["prompt_version"]),
    requests_today: num(r["requests_today"]),
    successes_today: num(r["successes_today"]),
    errors_today: num(r["errors_today"]),
    input_tokens_today: num(r["input_tokens_today"]),
    output_tokens_today: num(r["output_tokens_today"]),
    cost_usd_today: num(r["cost_usd_today"], 6),
    daily_request_limit: num(r["daily_request_limit"]),
    daily_input_token_limit: num(r["daily_input_token_limit"]),
    daily_output_token_limit: num(r["daily_output_token_limit"]),
    daily_cost_limit_usd: num(r["daily_cost_limit_usd"], 4),
    leased_runs: num(r["leased_runs"]),
  };
}
