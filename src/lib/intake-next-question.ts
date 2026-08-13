/**
 * CANONICAL next-intake-question resolver.
 *
 * Single source of truth shared by the webhook engine, the stored workflow
 * state (contacts.intake_last_step_id / baseline_intake_status /
 * intake_state / intake_stage) and every CRM surface. No other module may
 * derive its own "next question" text or ordering.
 *
 * Canonical order comes from intake_field_definitions.order_index:
 *   first_name (10) -> city (20) -> interests (40) -> primary_goal (50)
 * birth_date (30) is PROGRESSIVE/optional: it is never a baseline blocker and
 * is only offered once every baseline field is resolved.
 */
import {
  isKnown,
  nextIntakeStep,
  nextProgressiveStep,
  type IntakeSnapshot,
} from "./onboarding/baseline-intake";
import type { IntakeFieldDefinition } from "./onboarding/types";

export type NextIntakeQuestion = {
  field_key: string;
  label: string;
  question_text: string;
  purpose_text: string | null;
  stage: "baseline" | "progressive";
  optional: boolean;
};

export type IntakeStatePlan = {
  next: NextIntakeQuestion | null;
  /** mirrors contacts.baseline_intake_status */
  status: "not_started" | "in_progress" | "completed";
  /** mirrors contacts.intake_stage — the canonical current question key */
  stage: string;
  known: string[];
  missing: string[];
};

/** Fields that represent "where do you live" — answered by city OR region. */
export const LOCATION_FIELD_KEYS = ["city", "region", "city_or_region", "residence_city"];

export function locationKnown(snap: IntakeSnapshot): boolean {
  return LOCATION_FIELD_KEYS.some((k) => isKnown(snap.facts[k]));
}

function toQuestion(def: IntakeFieldDefinition): NextIntakeQuestion {
  const stage = (def.stage ?? "baseline") as "baseline" | "progressive";
  return {
    field_key: def.field_key,
    label: def.label,
    question_text: def.question_text,
    purpose_text: def.purpose_text ?? null,
    stage,
    optional: stage === "progressive" || !def.required,
  };
}

/**
 * The one and only next question. Baseline first (canonical order), then the
 * optional progressive fields. A location question is never a candidate once
 * city OR region is known.
 */
export function getNextMissingIntakeQuestion(
  defs: IntakeFieldDefinition[],
  snap: IntakeSnapshot,
): NextIntakeQuestion | null {
  const filtered = locationKnown(snap)
    ? defs.filter((d) => !LOCATION_FIELD_KEYS.includes(d.field_key))
    : defs;
  const def = nextIntakeStep(filtered, snap) ?? nextProgressiveStep(filtered, snap);
  return def ? toQuestion(def) : null;
}

/** Canonical stored-state projection — what the DB row must look like. */
export function planIntakeState(
  defs: IntakeFieldDefinition[],
  snap: IntakeSnapshot,
): IntakeStatePlan {
  const active = defs.filter((d) => d.enabled !== false);
  const known = active.filter((d) => isKnown(snap.facts[d.field_key])).map((d) => d.field_key);
  const missing = active
    .filter((d) => !isKnown(snap.facts[d.field_key]) && !snap.skipped.includes(d.field_key))
    .map((d) => d.field_key);
  const next = getNextMissingIntakeQuestion(defs, snap);
  const baselineDone = !nextIntakeStep(defs, snap);
  const status: IntakeStatePlan["status"] = baselineDone
    ? "completed"
    : known.length || snap.skipped.length
      ? "in_progress"
      : "not_started";
  return { next, status, stage: next?.field_key ?? "completed", known, missing };
}