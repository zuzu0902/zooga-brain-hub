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
  type IntakeFieldDefinition,
  type OpeningStatus,
  type RoutableContact,
} from "./types";
import { nextIntakeStep, nextProgressiveStep, type IntakeSnapshot } from "./baseline-intake";

export const OPENING_BUTTON_YES = "opening_available_yes";
export const OPENING_BUTTON_NOT_NOW = "opening_not_now";
export const CONSENT_BUTTON_YES = "consent_yes";
export const CONSENT_BUTTON_NO = "consent_no";

export type OnboardingButtonId =
  | typeof OPENING_BUTTON_YES
  | typeof OPENING_BUTTON_NOT_NOW
  | typeof CONSENT_BUTTON_YES
  | typeof CONSENT_BUTTON_NO;

const BY_TITLE: Record<string, OnboardingButtonId> = {};
for (const b of OPENING_TEMPLATE_BUTTONS) BY_TITLE[b.label] = b.id as OnboardingButtonId;
for (const b of CONSENT_QUESTION_BUTTONS) BY_TITLE[b.label] = b.id as OnboardingButtonId;

const VALID_IDS = new Set<string>([
  OPENING_BUTTON_YES,
  OPENING_BUTTON_NOT_NOW,
  CONSENT_BUTTON_YES,
  CONSENT_BUTTON_NO,
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
};

/** Hard cap of profiling questions before Tamar must deliver value. */
export const MAX_PROFILING_QUESTIONS_BEFORE_VALUE = 3;

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

  const progressive = nextProgressiveStep(input.defs, input.snapshot);
  if (progressive) return { stage: "progressive_question", field: progressive };

  return { stage: "known_contact" };
}
