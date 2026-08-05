/**
 * TAMAR BRAIN V2 — shared types.
 *
 * The workflow is deterministic. AI contributes ONLY:
 *   intent interpretation, entity extraction, grounded wording.
 * It never chooses the state, the next field, eligibility or handoff.
 */

export type V2State =
  | "new_inbound"
  | "consent_asked"
  | "consented"
  | "intake_active"
  | "recommendation_ready"
  | "value_delivered"
  | "human_handoff_queued"
  | "human_owned"
  | "opted_out"
  | "paused"
  | "closed";

export const V2_STATES: V2State[] = [
  "new_inbound",
  "consent_asked",
  "consented",
  "intake_active",
  "recommendation_ready",
  "value_delivered",
  "human_handoff_queued",
  "human_owned",
  "opted_out",
  "paused",
  "closed",
];

/** Legacy (v1) state values still stored on existing contacts. */
const LEGACY_MAP: Record<string, V2State> = {
  consent_pending: "consent_asked",
  value_delivery: "value_delivered",
  offer_recommended: "recommendation_ready",
};

export function normalizeState(raw: string | null | undefined): V2State | null {
  if (!raw) return null;
  if ((V2_STATES as string[]).includes(raw)) return raw as V2State;
  return LEGACY_MAP[raw] ?? null;
}

export type Sentiment = "positive" | "neutral" | "negative" | "distress";

/** Structured output of the intent interpreter stage. */
export type Interpretation = {
  intent: string;
  consent_answer: "yes" | "no" | "unknown";
  wants_human: boolean;
  confusion: boolean;
  sentiment: Sentiment;
  entities: Record<string, string>;
  confidence: number;
  /** internal only — never shown to a customer */
  rationale: string;
  source: "model" | "deterministic" | "fallback";
};

export type FlowOption = {
  option_id: string;
  label: string;
  value: string;
  order_index: number;
  enabled: boolean;
};

export type FlowStep = {
  step_key: string;
  field_key: string | null;
  stage: string;
  question_text: string;
  help_text: string | null;
  presentation: "text" | "buttons" | "list";
  required: boolean;
  skippable: boolean;
  conditions: Record<string, any>;
  order_index: number;
  enabled: boolean;
  options: FlowOption[];
};

export type AgentIdentity = {
  name: string;
  role: string;
  tone: string;
  warmth: string;
  verbosity: string;
  phrases: string[];
  forbidden_phrases: string[];
  examples: string[];
};

export type AgentSafety = {
  min_confidence_state_change: number;
  min_confidence_marketing: number;
  ambiguity_limit: number;
  max_offers: number;
  max_questions_per_message: number;
  handoff_on_explicit_request: boolean;
  handoff_on_distress: boolean;
  optout_requires_explicit: boolean;
};

export type AgentVersion = {
  id: string | null;
  version: number;
  status: string;
  identity: AgentIdentity;
  safety: AgentSafety;
  steps: FlowStep[];
};

export type SellableOffer = {
  id: string;
  title: string;
  offer_url: string | null;
  summary: string | null;
};

export type OutboundMessage =
  | { kind: "text"; body: string }
  | {
      kind: "buttons" | "list";
      body: string;
      header?: string | null;
      /** stable option ids travel back on button_reply/list_reply */
      options: Array<{ id: string; label: string; value: string }>;
    };

export type TurnDecision = {
  from_state: V2State;
  next_state: V2State;
  messages: OutboundMessage[];
  /** deterministic actions the runtime must execute */
  actions: Array<
    | "handoff"
    | "handoff_followup"
    | "freeze"
    | "opt_out"
    | "opt_in"
    | "consent_granted"
    | "capture_field"
    | "recommend"
  >;
  ask_step_key: string | null;
  captured: Record<string, string>;
  offer_ids: string[];
  marketing_allowed: boolean;
  confidence_gate: "pass" | "blocked" | "n/a";
  ambiguity_turns: number;
  reason_codes: string[];
  silent: boolean;
};

export const DEFAULT_IDENTITY: AgentIdentity = {
  name: "תמר",
  role: "העוזרת הדיגיטלית של זוגה",
  tone: "חמה, ישירה, אנושית",
  warmth: "high",
  verbosity: "short",
  phrases: [],
  forbidden_phrases: [],
  examples: [],
};

export const DEFAULT_SAFETY: AgentSafety = {
  min_confidence_state_change: 70,
  min_confidence_marketing: 75,
  ambiguity_limit: 2,
  max_offers: 2,
  max_questions_per_message: 1,
  handoff_on_explicit_request: true,
  handoff_on_distress: true,
  optout_requires_explicit: true,
};
