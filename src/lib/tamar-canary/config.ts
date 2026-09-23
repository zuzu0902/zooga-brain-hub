/**
 * TAMAR CANARY — the single, explicit configuration point for the
 * production-safe inbound-and-reply canary.
 *
 * Exactly ONE individual WhatsApp number may reach the live Tamar path.
 * Every other inbound customer message is hard-blocked at the verified Meta
 * webhook boundary, before CRM/contact creation, model calls, workflow state
 * transitions or any outbound reply.
 *
 * This module is pure (no IO) so it can be unit-tested and reused by both the
 * webhook boundary and the server-side restart path. No magic strings may be
 * duplicated anywhere else.
 */
import { normalizePhone } from "@/lib/phone";

/**
 * Canonical canary number in E.164 (primary line; also the only number the
 * handoff override / manager-alert suppression applies to).
 */
export const CANARY_PHONE_E164 = "+972512277533";

/**
 * The complete, explicit canary allowlist. Exactly these two individual
 * numbers may reach the live Tamar path. Every other number and every group
 * JID stays hard-blocked before contact creation, model call or send.
 */
export const CANARY_PHONES_E164 = ["+972512277533", "+972547702620"] as const;

/** Canonical digits, used for equivalence across +972 / 972 / 0 shapes. */
const CANARY_DIGITS_SET = new Set(
  CANARY_PHONES_E164.flatMap((p) => {
    const d = p.replace(/\D/g, "");
    return [d, "0" + d.slice(3)];
  }),
);


/** The exact Hebrew restart phrase honoured for the canary contact only. */
export const CANARY_RESTART_PHRASE = "התחל מחדש";

/** Audit labels (kept here so the ledger vocabulary is not duplicated). */
export const CANARY_BLOCK_SOURCE = "tamar_canary_gate";
export const CANARY_BLOCK_STATUS = "inbound_blocked_non_canary";
export const CANARY_RESTART_REASON = "canary_restart_phrase";

const onlyDigits = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/** Group JIDs are never individual canary traffic. */
export function isGroupJid(value: unknown): boolean {
  const s = String(value ?? "");
  return /@g\.us$/i.test(s) || /^\d{5,}-\d{5,}$/.test(s.trim());
}

/**
 * True only for the canonical canary number, accepting the equivalent
 * normalized forms +972512277533 / 972512277533 / 0512277533.
 */
export function isCanaryPhone(phone: unknown): boolean {
  if (phone == null) return false;
  const raw = String(phone).trim();
  if (!raw || isGroupJid(raw)) return false;
  const digits = onlyDigits(raw);
  if (!digits) return false;
  if (digits === CANARY_DIGITS || digits === onlyDigits(CANARY_LOCAL_DIGITS)) return true;
  const normalized = normalizePhone(raw);
  return !!normalized && onlyDigits(normalized) === CANARY_DIGITS;
}

/** Webhook boundary decision for one inbound message. */
export type CanaryGateDecision = {
  allowed: boolean;
  reason: "canary_allowed" | "blocked_non_canary" | "blocked_group" | "blocked_invalid_phone";
};

export function canaryInboundDecision(phone: unknown): CanaryGateDecision {
  if (isGroupJid(phone)) return { allowed: false, reason: "blocked_group" };
  if (!onlyDigits(phone)) return { allowed: false, reason: "blocked_invalid_phone" };
  if (isCanaryPhone(phone)) return { allowed: true, reason: "canary_allowed" };
  return { allowed: false, reason: "blocked_non_canary" };
}

/**
 * The exact Hebrew restart phrase. Surrounding whitespace and a trailing
 * punctuation mark are forgiven; nothing else is.
 */
export function isCanaryRestartPhrase(text: unknown): boolean {
  const s = String(text ?? "")
    .trim()
    .replace(/[.!?׃:]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return s === CANARY_RESTART_PHRASE;
}
