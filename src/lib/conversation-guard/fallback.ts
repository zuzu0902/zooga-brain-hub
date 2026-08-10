/**
 * CUSTOMER-SAFE RECOVERY FALLBACK — pure logic, no I/O.
 *
 * When the decision layer fails (model timeout, invalid output, parser
 * failure, unexpected exception) while the vault + DB are healthy and policy
 * allows a reply, silence is the wrong answer: the customer gets exactly ONE
 * short, honest acknowledgement plus an open question. The fallback invents
 * nothing, never repeats the last question, and is never re-sent on retry.
 */
import { OPEN_QUESTION, questionSignature, semanticallyEquivalent } from "./core";

export const RECOVERABLE_FAILURE_KINDS = [
  "model_timeout",
  "invalid_model_output",
  "parser_failure",
  "decision_error",
] as const;

export type FailureKind = (typeof RECOVERABLE_FAILURE_KINDS)[number];

/** Failures that must stay silent: infrastructure is not trustworthy. */
export const INFRA_FAILURE_KINDS = ["db_unavailable", "vault_unavailable", "meta_unavailable"] as const;

/**
 * Map an arbitrary processing error to a fallback-eligible failure kind.
 * Anything infrastructural (or unknown-but-infrastructural) returns null.
 */
export function classifyFailureKind(error: unknown): FailureKind | null {
  const raw = String((error as any)?.code ?? (error as any)?.message ?? error ?? "").toLowerCase();
  if (!raw) return null;
  if (/(vault|database|db_|supabase|pgbouncer|connection|econnrefused|meta_unavailable|graph_api)/.test(raw)) return null;
  if (/(timeout|timed out|aborted|etimedout|deadline)/.test(raw)) return "model_timeout";
  if (/(json|parse|unexpected token|schema|zod|invalid_output|malformed)/.test(raw)) return "parser_failure";
  if (/(empty_reply|no_reply|invalid_model|model_error|ai_gateway|429|502|503_model)/.test(raw)) return "invalid_model_output";
  return "decision_error";
}

/** Documented reasons that forbid ANY outbound, fallback included. */
export const FALLBACK_BLOCKED_REASONS = [
  "opt_out_suppressed",
  "suppressed_human_owned",
  "suppressed_brain_gate",
  "duplicate_inbound",
  "simulate",
  "unsupported_message_type",
  "silent_by_policy",
  "onboarding_duplicate",
  "status_event",
  "invalid_recipient",
  "window_closed_no_template",
] as const;

export type FallbackDecision = {
  send: boolean;
  /** Documented no-reply reason when `send` is false. */
  reason: string;
};

export function decideRecoveryFallback(input: {
  failureKind: FailureKind | null;
  noReplyReason?: string | null;
  contactId?: string | null;
  infraAvailable?: boolean;
  optedOut?: boolean;
  suppressed?: boolean;
  humanOwned?: boolean;
  validRecipient?: boolean;
  windowOpen?: boolean;
  hasTemplate?: boolean;
  alreadySent?: boolean;
}): FallbackDecision {
  if (input.alreadySent) return { send: false, reason: "fallback_already_sent" };
  if (!input.failureKind) return { send: false, reason: "not_a_recoverable_failure" };
  if (input.infraAvailable === false) return { send: false, reason: "infrastructure_unavailable" };
  if (!input.contactId) return { send: false, reason: "contact_missing" };
  if (input.validRecipient === false) return { send: false, reason: "invalid_recipient" };
  if (input.optedOut) return { send: false, reason: "opt_out_suppressed" };
  if (input.humanOwned) return { send: false, reason: "suppressed_human_owned" };
  if (input.suppressed) return { send: false, reason: "suppressed_brain_gate" };
  if (input.noReplyReason && (FALLBACK_BLOCKED_REASONS as readonly string[]).includes(input.noReplyReason)) {
    return { send: false, reason: input.noReplyReason };
  }
  if (input.windowOpen === false && !input.hasTemplate) {
    return { send: false, reason: "window_closed_no_template" };
  }
  return { send: true, reason: `recovery_fallback:${input.failureKind}` };
}

const PRIMARY = `קיבלתי את ההודעה שלך 🙏\nרגע לא הצלחתי לנסח תשובה מדויקת, ואני לא רוצה לכתוב משהו לא נכון.\n${OPEN_QUESTION}`;
const ALTERNATE = `קיבלתי את ההודעה שלך 🙏\nאני לא רוצה לענות משהו לא מדויק, אז בוא/י נתקדם ממקום אחר:\nעל מה הכי נעים לך להתמקד כרגע?`;

/**
 * Short acknowledgement + open question. If it would echo the question that
 * was just asked, the alternate phrasing is used instead.
 */
export function buildFallbackText(lastQuestionSignature?: string | null): string {
  if (lastQuestionSignature && semanticallyEquivalent(lastQuestionSignature, questionSignature(PRIMARY))) {
    return ALTERNATE;
  }
  return PRIMARY;
}