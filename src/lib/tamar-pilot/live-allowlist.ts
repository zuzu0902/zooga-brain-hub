/**
 * LIVE SEND ALLOWLIST (PURE).
 *
 * The approved production pilot is restricted to the canonical Tamar phone
 * allowlist. UI state, pilot-file eligibility or an operator click are NEVER
 * sufficient: every real outbound pilot message (opener and 48h follow-up)
 * must pass this check at the last possible point before the network call.
 *
 * Fail closed: an empty or missing allowlist blocks every live send.
 */
import { normalizePhone } from "@/lib/phone";

export type AllowlistDecision = {
  allowed: boolean;
  reason: "allowlist_hit" | "allowlist_blocked" | "invalid_phone" | "allowlist_empty";
  reason_he: string;
  phone: string | null;
};

const digits = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/** Compare two phone values across +972 / 972 / 0 shapes. */
export function samePhone(a: unknown, b: unknown): boolean {
  const x = digits(normalizePhone(String(a ?? "")) ?? a);
  const y = digits(normalizePhone(String(b ?? "")) ?? b);
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}

export function isLiveSendAllowed(phone: unknown, allowlist: unknown): AllowlistDecision {
  const normalized = normalizePhone(String(phone ?? ""));
  const list = (Array.isArray(allowlist) ? allowlist : []).map(String).filter(Boolean);
  if (!normalized) {
    return { allowed: false, reason: "invalid_phone", reason_he: "מספר טלפון לא תקין", phone: null };
  }
  if (!list.length) {
    return {
      allowed: false,
      reason: "allowlist_empty",
      reason_he: "רשימת ההיתר לשליחה חיה ריקה — השליחה נחסמה",
      phone: normalized,
    };
  }
  const hit = list.some((a) => samePhone(a, normalized));
  return hit
    ? { allowed: true, reason: "allowlist_hit", reason_he: "מספר מאושר לפיילוט חי", phone: normalized }
    : {
        allowed: false,
        reason: "allowlist_blocked",
        reason_he: "המספר אינו ברשימת ההיתר המאושרת לשליחה חיה",
        phone: normalized,
      };
}
