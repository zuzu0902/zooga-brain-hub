/**
 * TWO-STAGE CONVERSATION OPENING — pure logic.
 *
 * Stage 1 (outside the 24h window): an approved template that asks ONLY about
 * availability. "לא עכשיו" is a deferral (opening_status=deferred) and is
 * never treated as consent denied or opt-out.
 *
 * Stage 2 (inside the service window, after availability=yes or after a
 * customer-initiated inbound): one interactive consent question. Consent is
 * obtained here and nowhere else — availability never implies consent.
 */
import {
  CONSENT_QUESTION_BUTTONS,
  CONSENT_QUESTION_TEXT,
  OPENING_DEFERRED_TEXT,
  OPENING_TEMPLATE_BODY,
  OPENING_TEMPLATE_BUTTONS,
  OPT_OUT_CLOSING_TEXT,
  RELATIONSHIP_INTAKE_BUTTONS,
  RELATIONSHIP_INTAKE_LATER_TEXT,
  RELATIONSHIP_INTAKE_QUESTION_TEXT,
  RELATIONSHIP_INTAKE_READY_TEXT,
  type RelationshipIntakeStatus,
  type IntakeFieldDefinition,
  type OpeningStatus,
  type RoutableContact,
} from "./types";
import { nextIntakeStep, nextProgressiveStep, type IntakeSnapshot } from "./baseline-intake";

export const OPENING_BUTTON_YES = "opening_available_yes";
export const OPENING_BUTTON_NOT_NOW = "opening_not_now";
export const CONSENT_BUTTON_YES = "consent_yes";
export const CONSENT_BUTTON_NO = "consent_no";
export const RELATIONSHIP_BUTTON_YES = "relationship_intake_yes";
export const RELATIONSHIP_BUTTON_LATER = "relationship_intake_later";

export type OnboardingButtonId =
  | typeof OPENING_BUTTON_YES
  | typeof OPENING_BUTTON_NOT_NOW
  | typeof CONSENT_BUTTON_YES
  | typeof CONSENT_BUTTON_NO
  | typeof RELATIONSHIP_BUTTON_YES
  | typeof RELATIONSHIP_BUTTON_LATER;

const BY_TITLE: Record<string, OnboardingButtonId> = {};
for (const b of OPENING_TEMPLATE_BUTTONS) BY_TITLE[b.label] = b.id as OnboardingButtonId;
for (const b of CONSENT_QUESTION_BUTTONS) BY_TITLE[b.label] = b.id as OnboardingButtonId;
for (const b of RELATIONSHIP_INTAKE_BUTTONS) BY_TITLE[b.label] = b.id as OnboardingButtonId;

const VALID_IDS = new Set<string>([
  OPENING_BUTTON_YES,
  OPENING_BUTTON_NOT_NOW,
  CONSENT_BUTTON_YES,
  CONSENT_BUTTON_NO,
  RELATIONSHIP_BUTTON_YES,
  RELATIONSHIP_BUTTON_LATER,
]);

/**
 * Exact button parsing. Meta may deliver a button reply as an id, as a title,
 * or (for template quick replies) as plain text equal to the title.
 */
export function parseOnboardingButton(input: {
  id?: string | null;
  title?: string | null;
  text?: string | null;
}): OnboardingButtonId | null {
  const id = String(input.id ?? "").trim();
  if (VALID_IDS.has(id)) return id as OnboardingButtonId;
  const title = String(input.title ?? "").trim();
  if (BY_TITLE[title]) return BY_TITLE[title]!;
  const text = String(input.text ?? "").trim();
  if (BY_TITLE[text]) return BY_TITLE[text]!;
  return null;
}

// ------------------------------------------------------------- transitions

export type OpeningTransition = {
  opening_status: OpeningStatus;
  /** consent is NEVER touched by an availability answer */
  consent_touched: false;
  reply_text: string | null;
  next: "ask_consent" | "stop_no_recontact";
};

export function applyOpeningReply(button: OnboardingButtonId): OpeningTransition | null {
  if (button === OPENING_BUTTON_YES) {
    return { opening_status: "available", consent_touched: false, reply_text: null, next: "ask_consent" };
  }
  if (button === OPENING_BUTTON_NOT_NOW) {
    return {
      opening_status: "deferred",
      consent_touched: false,
      reply_text: OPENING_DEFERRED_TEXT,
      next: "stop_no_recontact",
    };
  }
  return null;
}

export type ConsentTransition = {
  granted: boolean;
  suppress: boolean;
  reply_text: string | null;
  next: "start_baseline" | "close";
};

export function applyConsentReply(button: OnboardingButtonId): ConsentTransition | null {
  if (button === CONSENT_BUTTON_YES) {
    return { granted: true, suppress: false, reply_text: null, next: "start_baseline" };
  }
  if (button === CONSENT_BUTTON_NO) {
    return { granted: false, suppress: true, reply_text: OPT_OUT_CLOSING_TEXT, next: "close" };
  }
  return null;
}

// ------------------------------------------------ relationship intake gate

export type RelationshipGateTransition = {
  relationship_intake_status: RelationshipIntakeStatus;
  /** "מאוחר יותר" is a scheduling answer, never a marketing refusal. */
  is_opt_out: false;
  consent_touched: false;
  /** the contact may still receive a natural offer in a future conversation */
  eligible_for_future_offer: true;
  reply_text: string;
  next: "handoff_to_relationship_intake" | "continue_normal_conversation";
};

export function applyRelationshipGateReply(
  button: OnboardingButtonId,
): RelationshipGateTransition | null {
  if (button === RELATIONSHIP_BUTTON_YES) {
    return {
      relationship_intake_status: "ready_to_start",
      is_opt_out: false,
      consent_touched: false,
      eligible_for_future_offer: true,
      reply_text: RELATIONSHIP_INTAKE_READY_TEXT,
      next: "handoff_to_relationship_intake",
    };
  }
  if (button === RELATIONSHIP_BUTTON_LATER) {
    return {
      relationship_intake_status: "deferred",
      is_opt_out: false,
      consent_touched: false,
      eligible_for_future_offer: true,
      reply_text: RELATIONSHIP_INTAKE_LATER_TEXT,
      next: "continue_normal_conversation",
    };
  }
  return null;
}

/** A deferral may only be resumed by the customer writing first. */
export function mayAutoRecontactAfterDeferral(): boolean {
  return false;
}

// --------------------------------------------------------------- stage plan

export type StagePlan =
  | { stage: "suppressed"; reason: string }
  | { stage: "deferred"; reason: string }
  | { stage: "send_opening"; body: string; buttons: typeof OPENING_TEMPLATE_BUTTONS }
  | { stage: "await_opening_reply" }
  | { stage: "ask_consent"; body: string; buttons: typeof CONSENT_QUESTION_BUTTONS }
  | { stage: "baseline_intake"; field: IntakeFieldDefinition; question_index: number }
  | { stage: "deliver_value"; reason: string }
  | { stage: "relationship_gate"; body: string; buttons: typeof RELATIONSHIP_INTAKE_BUTTONS }
  | { stage: "progressive_question"; field: IntakeFieldDefinition }
  | { stage: "known_contact" };

export type StageInput = {
  contact: RoutableContact;
  defs: IntakeFieldDefinition[];
  snapshot: IntakeSnapshot;
  /** questions already asked in the current conversation */
  questionsAskedThisConversation: number;
  /** the customer wrote in the last 24h */
  serviceWindowOpen: boolean;
  /** this turn was triggered by a customer inbound message */
  inboundInitiated: boolean;
  /** value (offer/link) was already delivered in this conversation */
  valueDelivered?: boolean;
  /** current relationship-questionnaire gate status */
  relationshipIntakeStatus?: RelationshipIntakeStatus;
};

/** Hard cap of profiling questions before Tamar must deliver value. */
export const MAX_PROFILING_QUESTIONS_BEFORE_VALUE = 5;

export function nextOnboardingStage(input: StageInput): StagePlan {
  const { contact: c } = input;

  // consent refusal / opt-out is absolute
  if (c.consent.consent_status === "denied" || c.consent.opt_out_at) {
    return { stage: "suppressed", reason: "consent_denied_or_opted_out" };
  }

  if (c.consent.consent_status !== "granted") {
    const windowOpen = input.serviceWindowOpen || input.inboundInitiated;
    if (windowOpen || c.opening.opening_status === "available") {
      return { stage: "ask_consent", body: CONSENT_QUESTION_TEXT, buttons: CONSENT_QUESTION_BUTTONS };
    }
    if (c.opening.opening_status === "deferred") {
      return { stage: "deferred", reason: "opening_deferred_not_now" };
    }
    if (c.opening.opening_status === "asked") return { stage: "await_opening_reply" };
    return { stage: "send_opening", body: OPENING_TEMPLATE_BODY, buttons: OPENING_TEMPLATE_BUTTONS };
  }

  // consent granted -> baseline intake, once, one question per turn
  const asked = input.questionsAskedThisConversation;
  const next = nextIntakeStep(input.defs, input.snapshot);
  if (next) {
    if (asked >= MAX_PROFILING_QUESTIONS_BEFORE_VALUE) {
      return { stage: "deliver_value", reason: "profiling_question_budget_reached" };
    }
    return { stage: "baseline_intake", field: next, question_index: asked + 1 };
  }

  if (!input.valueDelivered) return { stage: "deliver_value", reason: "baseline_complete" };

  // value delivered -> offer the relationship questionnaire exactly once
  if ((input.relationshipIntakeStatus ?? "not_offered") === "not_offered") {
    return {
      stage: "relationship_gate",
      body: RELATIONSHIP_INTAKE_QUESTION_TEXT,
      buttons: RELATIONSHIP_INTAKE_BUTTONS,
    };
  }

  const progressive = nextProgressiveStep(input.defs, input.snapshot);
  if (progressive) return { stage: "progressive_question", field: progressive };

  return { stage: "known_contact" };
}
