/**
 * PROGRESSIVE PROFILING — fact/inference merge rules. Pure.
 *
 * Hard rules:
 *  - an inference NEVER becomes an explicit fact
 *  - a new explicit statement always beats an older inference
 *  - socio-economic reads are stored as signals with evidence, never as a score
 *  - protected/sensitive attributes are never inferred or stored
 */
import type { FactKind, ProfileFact } from "./types";

export type IncomingFact = {
  field_key: string;
  value: string;
  kind: FactKind;
  confidence: number;
  source: string;
  source_message_id?: string | null;
  evidence?: string | null;
  observed_at?: string;
};

/** Never inferred, never stored from model output. */
export const FORBIDDEN_INFERENCE_FIELDS = [
  "ethnicity", "religion", "religious_level", "sexual_orientation", "health",
  "disability", "political_affiliation", "race", "income_exact", "wealth_score",
];

/** Socio-economic reads live here as signals with evidence, not as facts. */
export const SIGNAL_FIELDS = [
  "budget_signal", "spending_signal", "availability_signal", "engagement_signal",
  "objection_signal", "travel_preference_signal",
];

export function isForbiddenField(field_key: string): boolean {
  return FORBIDDEN_INFERENCE_FIELDS.includes(field_key);
}

export function isSignalField(field_key: string): boolean {
  return SIGNAL_FIELDS.includes(field_key) || field_key.endsWith("_signal");
}

export type MergeResult =
  | { action: "insert"; fact: ProfileFact }
  | { action: "update"; fact: ProfileFact; supersedes: ProfileFact }
  | { action: "reject"; reason: string };

export function mergeFact(current: ProfileFact | undefined, incoming: IncomingFact): MergeResult {
  const value = String(incoming.value ?? "").trim();
  if (!value) return { action: "reject", reason: "empty_value" };
  if (isForbiddenField(incoming.field_key)) return { action: "reject", reason: "protected_attribute" };
  if (isSignalField(incoming.field_key) && incoming.kind === "explicit" && incoming.confidence > 90) {
    // signals stay signals; never promoted to hard truth
    incoming = { ...incoming, confidence: 90 };
  }
  const next: ProfileFact = {
    field_key: incoming.field_key,
    value_text: value,
    explicit_or_inferred: incoming.kind,
    confidence: Math.max(0, Math.min(100, Math.round(incoming.confidence))),
    source: incoming.source,
    source_message_id: incoming.source_message_id ?? null,
    evidence: incoming.evidence ?? null,
    observed_at: incoming.observed_at ?? new Date().toISOString(),
  };

  if (!current) return { action: "insert", fact: next };
  if (current.value_text === next.value_text && current.explicit_or_inferred === next.explicit_or_inferred) {
    return { action: "reject", reason: "unchanged" };
  }
  // explicit always wins over inference
  if (current.explicit_or_inferred === "inferred" && next.explicit_or_inferred === "explicit") {
    return { action: "update", fact: next, supersedes: current };
  }
  // an inference may never overwrite an explicit statement
  if (current.explicit_or_inferred === "explicit" && next.explicit_or_inferred === "inferred") {
    return { action: "reject", reason: "inference_cannot_override_explicit" };
  }
  // same kind: newer wins only with at least equal confidence
  if (next.confidence >= current.confidence) return { action: "update", fact: next, supersedes: current };
  return { action: "reject", reason: "lower_confidence" };
}