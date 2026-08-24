/**
 * ZOOGA OS SHADOW COMPARISON — pure helpers (client-safe, deterministic).
 *
 * METADATA ONLY. `input_signals` is a CLOSED allow-list of derived
 * enum/boolean/numeric signals. Raw message text, phone, email, name,
 * provider_message_id, facebook_id, contact id or hash, tokens, and full CRM
 * rows can never enter this projection — unknown keys are dropped.
 */

export type ShadowSignalValue = string | number | boolean;

/** Closed allow-list. Adding a key here is a deliberate, reviewed decision. */
export const SHADOW_SIGNAL_KEYS = [
  "kind",
  "event_type",
  "provider_event_present",
  "duplicate",
  "has_text",
  "text_length_bucket",
  "consent_state",
  "conversation_phase",
  "human_owned",
  "intake_complete",
  "has_active_offer",
  "offer_count_bucket",
  "hours_since_last_inbound_bucket",
  "locale",
] as const;

export type ShadowSignalKey = (typeof SHADOW_SIGNAL_KEYS)[number];

export type ShadowInputSignals = Partial<Record<ShadowSignalKey, ShadowSignalValue>>;

const KEY_SET = new Set<string>(SHADOW_SIGNAL_KEYS);
/** Enum-ish strings only: short, no whitespace, no punctuation that could carry text. */
const ENUM_RE = /^[a-z0-9_.:-]{1,32}$/i;

function sanitizeValue(v: unknown): ShadowSignalValue | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const s = v.trim();
    return ENUM_RE.test(s) ? s : undefined;
  }
  return undefined;
}

/** Strict allow-list projection. Never throws; drops everything unrecognised. */
export function buildShadowInputSignals(raw: unknown): ShadowInputSignals {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ShadowInputSignals = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY_SET.has(k)) continue;
    const val = sanitizeValue(v);
    if (val !== undefined) out[k as ShadowSignalKey] = val;
  }
  return out;
}

/** Stable, dependency-free hash of the sanitized signals (order independent). */
export function hashInputSignals(signals: ShadowInputSignals): string {
  const canonical = Object.keys(signals)
    .sort()
    .map((k) => `${k}=${String(signals[k as ShadowSignalKey])}`)
    .join("&");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export type ShadowEvalStatus =
  | "pending"
  | "match"
  | "mismatch_action"
  | "mismatch_state"
  | "mismatch_reason_only"
  | "proposal_missing"
  | "canonical_missing"
  | "error";

export type ShadowOutcome = {
  action?: string | null;
  state_after?: string | null;
  reason_codes?: string[] | null;
};

export type ShadowEvaluation = {
  eval_status: ShadowEvalStatus;
  eval_reason_codes: string[];
};

function norm(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s ? s.slice(0, 48) : null;
}

function normCodes(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(
    new Set(v.map((c) => norm(c)).filter((c): c is string => !!c && ENUM_RE.test(c))),
  ).sort();
}

function hasOutcome(o: ShadowOutcome | null | undefined): boolean {
  return !!o && (norm(o.action) !== null || norm(o.state_after) !== null);
}

/**
 * Deterministic comparison. Reason codes are short, closed-vocabulary strings
 * — never free text and never derived from customer content.
 */
export function evaluateShadowRun(args: {
  canonical?: ShadowOutcome | null;
  proposed?: ShadowOutcome | null;
  errorCode?: string | null;
}): ShadowEvaluation {
  const errorCode = norm(args.errorCode);
  if (errorCode) {
    return { eval_status: "error", eval_reason_codes: [`error:${errorCode}`] };
  }
  const canonicalPresent = hasOutcome(args.canonical);
  const proposedPresent = hasOutcome(args.proposed);

  if (!proposedPresent && !canonicalPresent) {
    return { eval_status: "proposal_missing", eval_reason_codes: ["no_proposal", "no_canonical"] };
  }
  if (!proposedPresent) return { eval_status: "proposal_missing", eval_reason_codes: ["no_proposal"] };
  if (!canonicalPresent) return { eval_status: "canonical_missing", eval_reason_codes: ["no_canonical"] };

  const ca = norm(args.canonical?.action);
  const pa = norm(args.proposed?.action);
  if (ca !== pa) {
    return { eval_status: "mismatch_action", eval_reason_codes: ["action_differs"] };
  }

  const cs = norm(args.canonical?.state_after);
  const ps = norm(args.proposed?.state_after);
  if (cs !== ps) {
    return { eval_status: "mismatch_state", eval_reason_codes: ["state_after_differs"] };
  }

  const cr = normCodes(args.canonical?.reason_codes);
  const pr = normCodes(args.proposed?.reason_codes);
  if (cr.join("|") !== pr.join("|")) {
    return { eval_status: "mismatch_reason_only", eval_reason_codes: ["reason_codes_differ"] };
  }

  return { eval_status: "match", eval_reason_codes: [] };
}

export type ShadowComparisonMetrics = {
  total: number;
  open: number;
  pending: number;
  match: number;
  mismatch: number;
  proposal_missing: number;
  canonical_missing: number;
  error: number;
  mismatch_rate: number | null;
  p95_latency_ms: number | null;
  adapter_disabled: number;
  top_error_code: string | null;
  oldest_open_age_seconds: number | null;
};

export const EMPTY_COMPARISON_METRICS: ShadowComparisonMetrics = {
  total: 0,
  open: 0,
  pending: 0,
  match: 0,
  mismatch: 0,
  proposal_missing: 0,
  canonical_missing: 0,
  error: 0,
  mismatch_rate: null,
  p95_latency_ms: null,
  adapter_disabled: 0,
  top_error_code: null,
  oldest_open_age_seconds: null,
};

function count(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Allow-list projection of aggregate counters. Never carries row data. */
export function sanitizeComparisonMetrics(raw: unknown): ShadowComparisonMetrics {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_COMPARISON_METRICS };
  const r = raw as Record<string, unknown>;
  const rate = Number(r["mismatch_rate"]);
  const p95 = Number(r["p95_latency_ms"]);
  const age = Number(r["oldest_open_age_seconds"]);
  const code = typeof r["top_error_code"] === "string" ? r["top_error_code"].trim() : "";
  return {
    total: count(r["total"]),
    open: count(r["open"]),
    pending: count(r["pending"]),
    match: count(r["match"]),
    mismatch: count(r["mismatch"]),
    proposal_missing: count(r["proposal_missing"]),
    canonical_missing: count(r["canonical_missing"]),
    error: count(r["error"]),
    mismatch_rate: Number.isFinite(rate) && rate >= 0 ? Math.min(1, rate) : null,
    p95_latency_ms: Number.isFinite(p95) && p95 >= 0 ? Math.floor(p95) : null,
    adapter_disabled: count(r["adapter_disabled"]),
    top_error_code: code && ENUM_RE.test(code) ? code : null,
    oldest_open_age_seconds: Number.isFinite(age) && age >= 0 ? Math.floor(age) : null,
  };
}
