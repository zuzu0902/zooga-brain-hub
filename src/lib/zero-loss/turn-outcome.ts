/**
 * TURN OUTCOME CLASSIFIER — pure, no I/O.
 *
 * A processing job may only be closed as `succeeded` when the required
 * business result actually happened. For an inbound message that requires an
 * answer that means: a real contact_id AND an outbound send — unless there is
 * an explicit, documented no-reply reason (opt-out, human ownership,
 * duplicate, simulate, policy silence...).
 *
 * `sends = []` with no valid reason is a FAILURE, never a success.
 */

export const VALID_NO_REPLY_REASONS = [
  "opt_out_suppressed",
  "suppressed_human_owned",
  "suppressed_brain_gate",
  "duplicate_inbound",
  "simulate",
  "unsupported_message_type",
  "silent_by_policy",
  "onboarding_duplicate",
  "status_event",
] as const;

export type NoReplyReason = (typeof VALID_NO_REPLY_REASONS)[number];

export function isValidNoReplyReason(reason: string | null | undefined): reason is NoReplyReason {
  return !!reason && (VALID_NO_REPLY_REASONS as readonly string[]).includes(reason);
}

export type TurnOutcome = {
  success: boolean;
  reason: string;
  retryable: boolean;
  quarantine: boolean;
};

export function classifyTurnOutcome(input: {
  contactId?: string | null;
  sends?: Array<{ ok: boolean }>;
  noReplyReason?: string | null;
  error?: string | null;
  requiresReply?: boolean;
  attempt?: number;
  maxAttempts?: number;
}): TurnOutcome {
  const attempt = Number(input.attempt ?? 1);
  const maxAttempts = Number(input.maxAttempts ?? 5);
  const exhausted = attempt >= maxAttempts;
  const fail = (reason: string): TurnOutcome => ({
    success: false,
    reason,
    retryable: !exhausted,
    quarantine: exhausted,
  });
  const ok = (reason: string): TurnOutcome => ({ success: true, reason, retryable: false, quarantine: false });

  if (input.error) return fail(input.error);

  // Explicit, documented no-reply paths are legitimate completions.
  if (isValidNoReplyReason(input.noReplyReason)) return ok(input.noReplyReason);
  if (input.noReplyReason) return fail(`invalid_no_reply_reason:${input.noReplyReason}`);

  if (input.requiresReply === false) return ok("no_reply_not_required");

  if (!input.contactId) return fail("contact_missing");

  const sends = input.sends ?? [];
  if (!sends.length) return fail("no_outbound_without_reason");
  if (sends.some((s) => !s.ok)) return fail("send_failed");
  return ok("replied");
}
