/**
 * TAMAR BRAIN v1 — consent gate classification (pure).
 *
 * The first proactive message is an approved WhatsApp template with
 * quick-reply buttons. Meta delivers a button tap as plain text equal to the
 * button label, so free text and button taps are classified by one function.
 *
 * No AI intake, no offer, no marketing happens before consent === yes.
 */
import { isOptInMessage, isOptOutMessage } from "@/lib/optout";

export type ConsentAnswer = "yes" | "no" | "ambiguous";

const YES_RE =
  /^(\s*)(כן|כן,?\s*בשמחה|בשמחה|בטח|בהחלט|אפשר|אוקיי|אוקי|אישור|מאשר(ת)?|סבבה|יאללה|בסדר|למה\s+לא|נשמע\s+טוב|שלח(י|ו)?|מעוניין(ת)?|רוצה|yes|yep|yeah|sure|ok(ay)?|go\s+ahead)([\s.!?,]|$)/i;

const NO_RE =
  /^(\s*)(לא|לא,?\s*תודה|לא\s+מעוניין(ת)?|לא\s+רוצה|תודה\s+לא|אין\s+צורך|תפסיק(י|ו)?|די|no|nope|no\s+thanks|not\s+interested|stop)([\s.!?,]|$)/i;

/**
 * Classify a reply to the consent question.
 * Explicit opt-out stop-words always win over anything else.
 */
export function classifyConsentReply(text: string | null | undefined): ConsentAnswer {
  const raw = String(text ?? "").trim();
  if (!raw) return "ambiguous";
  if (isOptOutMessage(raw)) return "no";
  if (NO_RE.test(raw)) return "no";
  if (isOptInMessage(raw)) return "yes";
  if (YES_RE.test(raw)) return "yes";
  return "ambiguous";
}

/** Has the contact already been asked the clarification question once? */
export function consentClarifyExhausted(interactions: any[]): boolean {
  const outbound = (interactions ?? []).filter(
    (i: any) => i?.source === "tamar_outbound" || i?.type === "tamar_outbound",
  );
  return outbound.some((i: any) => String(i?.content ?? "").includes("רק כדי לוודא שהבנתי נכון"));
}

/** Render the consent template body with the contact's first name. */
export function renderConsentBody(body: string, firstName: string | null | undefined): string {
  const name = String(firstName ?? "").trim();
  return body.replace(/\{\{\s*(1|first_name)\s*\}\}/g, name || "שלום");
}

export const CONSENT_QUICK_REPLIES = ["כן, בשמחה", "לא, תודה"];