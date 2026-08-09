/**
 * STAGE 1 — conversation opening, one-time baseline intake, progressive profiling.
 * Explicit state model. Pure types only (safe on client and server).
 */

export type ConsentStatus = "unknown" | "pending" | "granted" | "denied";
export type BaselineIntakeStatus = "not_started" | "in_progress" | "completed";
export type FactKind = "explicit" | "inferred";

export type ConsentState = {
  consent_status: ConsentStatus;
  consent_source: string | null;
  consent_at: string | null;
  consent_version: string | null;
  consent_evidence: Record<string, string | number | boolean | null>;
  opt_out_at: string | null;
};

export type IntakeState = {
  baseline_intake_status: BaselineIntakeStatus;
  intake_version: number;
  started_at: string | null;
  completed_at: string | null;
  last_step_id: string | null;
};

export type ConversationFacts = {
  first_seen_at: string | null;
  first_inbound_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  total_messages: number;
  has_prior_conversation: boolean;
  service_window_open_until: string | null;
};

export type IntakeFieldDefinition = {
  field_key: string;
  label: string;
  question_text: string;
  purpose_text: string | null;
  presentation: "text" | "menu" | "multi";
  options: Array<{ id: string; label: string; value: string }>;
  required: boolean;
  skippable: boolean;
  order_index: number;
  enabled: boolean;
};

export type ProfileFact = {
  field_key: string;
  value_text: string | null;
  value_json?: string | number | boolean | null;
  explicit_or_inferred: FactKind;
  confidence: number;
  source: string;
  source_message_id: string | null;
  evidence: string | null;
  observed_at: string;
};

export type FieldCompleteness = {
  field_key: string;
  label: string;
  known: boolean;
  kind: FactKind | null;
  confidence: number;
  value: string | null;
  required: boolean;
  skipped: boolean;
};

/** Minimal shape the router needs from a resolved contact. */
export type RoutableContact = {
  id: string;
  phone: string | null;
  whatsapp_number: string | null;
  consent: ConsentState;
  intake: IntakeState;
  conversation: ConversationFacts;
};

export type RouteDecision =
  | "new_intake"
  | "resume_intake"
  | "known_contact"
  | "suppressed"
  | "blocked_missing_optin"
  | "blocked_missing_template"
  | "blocked_invalid_phone";

export type RouterResult = {
  decision: RouteDecision;
  branch: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  reason: string;
  /** send is allowed only when true; false is always fail-closed. */
  may_send: boolean;
  /** true when the send must go out as the approved opening template. */
  requires_opening_template: boolean;
  create_contact: boolean;
  next_action:
    | "create_lead_and_open"
    | "send_opening_template"
    | "start_baseline_intake"
    | "resume_baseline_intake"
    | "contextual_conversation"
    | "none";
};

export const CONSENT_VERSION = "zooga_opening_consent_v1";
export const OPENING_TEMPLATE_NAME = "zooga_opening_consent";
export const OPENING_TEMPLATE_BODY =
  "שלום {{1}}, אני תמר, העוזרת הדיגיטלית של קהילת זוגה. פנוי/ה לשיחה קצרה כדי שאכיר אותך ואוכל לשלוח לך מידע והצעות מתאימות?";
export const OPENING_TEMPLATE_BUTTONS = [
  { id: "consent_yes", label: "כן, בשמחה" },
  { id: "consent_no", label: "לא כרגע" },
];
export const OPT_OUT_CLOSING_TEXT = "תודה ולהתראות.";