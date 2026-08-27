/**
 * TAMAR BRAIN V2 — CRM + memory writeback plan (PURE, no I/O).
 *
 * The plan is derived from the SAME structured interpretation the turn
 * already produced — no extra LLM call. It separates truth by provenance:
 *
 *   explicit + high confidence -> canonical facts (profile facts + history)
 *   inferred / low confidence  -> pending internal insights ONLY
 *
 * Inference may never overwrite something the customer stated.
 */
import type { ProposedFact } from "@/lib/fact-audit/audit";
import type { Interpretation } from "./types";

/** Confidence at or above which an entity is treated as customer-stated. */
export const EXPLICIT_MIN_CONFIDENCE = 75;
export const SUMMARY_MAX_CHARS = 600;

/** Interpretation entities we are allowed to persist, mapped to field keys. */
export const ENTITY_FIELD_MAP: Record<string, string> = {
  first_name: "first_name",
  relationship_status: "relationship_status",
  goal: "goal",
  preferred_activity: "preferred_activity",
  region: "region",
  travel_party: "travel_party",
  budget_sensitivity: "budget_sensitivity",
  special_requests: "special_requests",
  destination: "destination",
};

export type MemoryCandidate = {
  memory_key: string;
  memory_type: string;
  memory_value: string;
  confidence_score: number;
};

export type InsightCandidate = {
  category: string;
  field_name: string;
  proposed_value: string;
  confidence_score: number;
  reasoning: string;
};

export type WritebackPlan = {
  facts: ProposedFact[];
  memories: MemoryCandidate[];
  insights: InsightCandidate[];
  summary: string | null;
};

function clean(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Build the writeback plan for one inbound turn.
 *
 * `capturedFields` are values the deterministic engine already accepted for
 * this turn (answers to a question it asked) — always explicit.
 */
export function planWriteback(args: {
  message: string;
  interpretation: Interpretation;
  capturedFields?: Record<string, string>;
  previousSummary?: string | null;
  /** the final outbound text actually sent, for the rolling summary */
  outboundText?: string | null;
}): WritebackPlan {
  const confidence = Number(args.interpretation?.confidence ?? 0);
  const evidence = clean(args.message).slice(0, 240);
  const facts: ProposedFact[] = [];
  const memories: MemoryCandidate[] = [];
  const insights: InsightCandidate[] = [];
  const seen = new Set<string>();

  const pushExplicit = (field_key: string, value: string, conf: number) => {
    if (!value || seen.has(field_key)) return;
    seen.add(field_key);
    facts.push({ field_key, value, kind: "explicit", confidence: conf, correction: false, evidence });
    memories.push({
      memory_key: field_key,
      memory_type: "profile",
      memory_value: value,
      confidence_score: conf,
    });
  };

  // 1. Values the deterministic engine captured this turn are customer-stated.
  for (const [k, v] of Object.entries(args.capturedFields ?? {})) {
    const value = clean(v);
    if (value) pushExplicit(k, value, 95);
  }

  // 2. Interpretation entities: explicit only above the confidence floor.
  for (const [entity, raw] of Object.entries(args.interpretation?.entities ?? {})) {
    const field_key = ENTITY_FIELD_MAP[entity];
    const value = clean(raw);
    if (!field_key || !value) continue;
    if (confidence >= EXPLICIT_MIN_CONFIDENCE) {
      pushExplicit(field_key, value, Math.min(95, Math.round(confidence)));
    } else if (!seen.has(field_key)) {
      insights.push({
        category: "profile",
        field_name: field_key,
        proposed_value: value,
        confidence_score: Math.max(1, Math.round(confidence)),
        reasoning: `low-confidence interpretation (${Math.round(confidence)}) — review before trusting`,
      });
    }
  }

  return {
    facts,
    memories,
    insights,
    summary: buildSummary({
      previous: args.previousSummary ?? null,
      inbound: args.message,
      outbound: args.outboundText ?? null,
    }),
  };
}

/**
 * Rolling compact summary — deterministic, bounded, no model call. Oldest
 * lines fall off the front so the summary can never grow unbounded.
 */
export function buildSummary(args: { previous: string | null; inbound: string; outbound: string | null }): string | null {
  const line = [
    clean(args.inbound) ? `לקוח: ${clean(args.inbound).slice(0, 160)}` : "",
    clean(args.outbound) ? `תמר: ${clean(args.outbound).slice(0, 160)}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  if (!line) return args.previous ? clean(args.previous).slice(0, SUMMARY_MAX_CHARS) : null;

  const lines = [...clean(args.previous).split(" ~ ").filter(Boolean), line];
  let out = lines.join(" ~ ");
  while (out.length > SUMMARY_MAX_CHARS && lines.length > 1) {
    lines.shift();
    out = lines.join(" ~ ");
  }
  return out.slice(0, SUMMARY_MAX_CHARS);
}

/** Stable idempotency key for one inbound turn's writeback. */
export function writebackKey(args: { inboundMessageId?: string | null; contactId: string; message: string }): string {
  if (args.inboundMessageId) return args.inboundMessageId;
  let h = 0;
  const s = `${args.contactId}:${clean(args.message)}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `derived:${args.contactId}:${(h >>> 0).toString(36)}`;
}
