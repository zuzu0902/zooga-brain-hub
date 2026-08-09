/**
 * DECISION ROUTER — runs before every proactive open / campaign send and
 * before every inbound-triggered opening. Pure and deterministic.
 *
 * Fail-closed: anything that is not explicitly allowed returns may_send=false.
 */
import { normalizePhone } from "@/lib/phone";
import type { RoutableContact, RouterResult } from "./types";

export type RouterInput = {
  /** raw phone as typed/imported; normalized inside */
  phone: string | null | undefined;
  contact: RoutableContact | null;
  /** documented opt-in evidence (import consent, web form, prior inbound) */
  hasOptInEvidence: boolean;
  /** approved opening template available for this language */
  openingTemplateApproved: boolean;
  /** true when the customer wrote in the last 24h (free-form allowed) */
  serviceWindowOpen?: boolean;
  /** customer-initiated inbound may always resume, even after a deferral */
  inboundInitiated?: boolean;
};

export function routeConversationStart(input: RouterInput): RouterResult {
  const phone = normalizePhone(input.phone ?? null);
  if (!phone) {
    return {
      decision: "blocked_invalid_phone",
      branch: "A",
      reason: "invalid_or_missing_phone",
      may_send: false,
      requires_opening_template: false,
      create_contact: false,
      next_action: "none",
    };
  }

  const c = input.contact;

  // A — contact not found
  if (!c) {
    const canOpen = input.hasOptInEvidence && input.openingTemplateApproved;
    return {
      decision: canOpen
        ? "new_intake"
        : input.hasOptInEvidence
          ? "blocked_missing_template"
          : "blocked_missing_optin",
      branch: "A",
      reason: canOpen
        ? "new_contact_opt_in_documented"
        : input.hasOptInEvidence
          ? "opening_template_not_approved"
          : "no_documented_opt_in_evidence",
      may_send: canOpen,
      requires_opening_template: true,
      create_contact: true,
      next_action: canOpen ? "create_lead_and_open" : "none",
    };
  }

  // B — denied / opted out: absolute suppression
  if (c.consent.consent_status === "denied" || c.consent.opt_out_at) {
    return {
      decision: "suppressed",
      branch: "B",
      reason: "consent_denied_or_opted_out",
      may_send: false,
      requires_opening_template: false,
      create_contact: false,
      next_action: "none",
    };
  }

  // H — availability deferred ("לא עכשיו"). Not a refusal, but no auto re-contact.
  if (c.opening.opening_status === "deferred" && !input.inboundInitiated) {
    return {
      decision: "deferred_not_now",
      branch: "H",
      reason: "opening_deferred_not_now",
      may_send: false,
      requires_opening_template: true,
      create_contact: false,
      next_action: "none",
    };
  }

  const status = c.consent.consent_status;

  // C — consent unknown / pending
  if (status === "unknown" || status === "pending") {
    if (!input.hasOptInEvidence) {
      return {
        decision: "blocked_missing_optin",
        branch: "C",
        reason: c.conversation.has_prior_conversation
          ? "prior_conversation_is_not_consent"
          : "no_documented_opt_in_evidence",
        may_send: false,
        requires_opening_template: true,
        create_contact: false,
        next_action: "none",
      };
    }
    if (!input.openingTemplateApproved && !input.serviceWindowOpen) {
      return {
        decision: "blocked_missing_template",
        branch: "C",
        reason: "opening_template_not_approved",
        may_send: false,
        requires_opening_template: true,
        create_contact: false,
        next_action: "none",
      };
    }
    return {
      decision: c.intake.baseline_intake_status === "in_progress" ? "resume_intake" : "new_intake",
      branch: "C",
      reason: "consent_pending_opening_template_allowed",
      may_send: true,
      requires_opening_template: !input.serviceWindowOpen,
      create_contact: false,
      next_action: "send_opening_template",
    };
  }

  // D/E/F — consent granted
  switch (c.intake.baseline_intake_status) {
    case "not_started":
      return {
        decision: "new_intake",
        branch: "D",
        reason: "consent_granted_intake_not_started",
        may_send: true,
        requires_opening_template: false,
        create_contact: false,
        next_action: "start_baseline_intake",
      };
    case "in_progress":
      return {
        decision: "resume_intake",
        branch: "E",
        reason: "consent_granted_intake_in_progress",
        may_send: true,
        requires_opening_template: false,
        create_contact: false,
        next_action: "resume_baseline_intake",
      };
    default:
      return {
        decision: "known_contact",
        branch: "F",
        reason: "consent_granted_intake_completed",
        may_send: true,
        requires_opening_template: false,
        create_contact: false,
        next_action: "contextual_conversation",
      };
  }
}

/**
 * G — a prior conversation never implies consent or a finished intake.
 * Exposed for tests and audits.
 */
export function priorConversationImpliesNothing(c: RoutableContact): boolean {
  return (
    c.conversation.has_prior_conversation &&
    (c.consent.consent_status === "unknown" || c.intake.baseline_intake_status !== "completed")
  );
}