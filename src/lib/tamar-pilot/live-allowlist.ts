/**
 * LIVE SEND AUTHORIZATION (PURE).
 *
 * Individual Tamar conversations may run beyond a single test number, but a
 * real outbound is still never authorized by UI state alone:
 *   - a phone on the canonical allowlist is always authorized;
 *   - any other individual number is authorized ONLY when open individual
 *     sending is enabled AND an authenticated admin explicitly triggered this
 *     single-contact action (never automated/bulk paths);
 *   - group targets are never authorized here;
 *   - fail closed otherwise.
 */
import { normalizePhone } from "@/lib/phone";

export type AllowlistDecision = {
  allowed: boolean;
  reason:
    | "allowlist_hit"
    | "admin_individual_send"
    | "allowlist_blocked"
    | "invalid_phone"
    | "allowlist_empty"
    | "group_target_blocked";
  reason_he: string;
  phone: string | null;
};

export type SendAuthorizationContext = {
  /** An authenticated admin explicitly triggered this single-contact action. */
  adminInitiated?: boolean;
  /** Individual conversations are open beyond the canonical allowlist. */
  openIndividualSends?: boolean;
};

const digits = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/** Group JIDs (…@g.us / 1234567890-1234567890) are never individual targets. */
export function isGroupTarget(value: unknown): boolean {
  const s = String(value ?? "");
  return /@g\.us$/i.test(s) || /^\d{5,}-\d{5,}$/.test(s.trim());
}

/** Compare two phone values across +972 / 972 / 0 shapes. */
export function samePhone(a: unknown, b: unknown): boolean {
  const x = digits(normalizePhone(String(a ?? "")) ?? a);
  const y = digits(normalizePhone(String(b ?? "")) ?? b);
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}

export function isLiveSendAllowed(
  phone: unknown,
  allowlist: unknown,
  ctx: SendAuthorizationContext = {},
): AllowlistDecision {
  if (isGroupTarget(phone)) {
    return {
      allowed: false,
      reason: "group_target_blocked",
      reason_he: "שליחה לקבוצה אינה נתמכת בשיחות אישיות",
      phone: null,
    };
  }
  const normalized = normalizePhone(String(phone ?? ""));
  const list = (Array.isArray(allowlist) ? allowlist : []).map(String).filter(Boolean);
  if (!normalized) {
    return { allowed: false, reason: "invalid_phone", reason_he: "מספר טלפון לא תקין", phone: null };
  }
  if (list.some((a) => samePhone(a, normalized))) {
    return { allowed: true, reason: "allowlist_hit", reason_he: "מספר מאושר לפיילוט חי", phone: normalized };
  }
  if (ctx.openIndividualSends && ctx.adminInitiated) {
    return {
      allowed: true,
      reason: "admin_individual_send",
      reason_he: "שליחה אישית יזומה על ידי מנהל מאומת",
      phone: normalized,
    };
  }
  if (!list.length) {
    return {
      allowed: false,
      reason: "allowlist_empty",
      reason_he: "רשימת ההיתר לשליחה חיה ריקה — השליחה נחסמה",
      phone: normalized,
    };
  }
  return {
    allowed: false,
    reason: "allowlist_blocked",
    reason_he: "המספר אינו ברשימת ההיתר המאושרת לשליחה חיה",
    phone: normalized,
  };
}

