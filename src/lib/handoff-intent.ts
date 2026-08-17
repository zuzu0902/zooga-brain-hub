/**
 * HANDOFF INTENT — pure, deterministic separation between:
 *   - a positive request to talk to a human           ("תעבירי אותי לנציג")
 *   - an explicit refusal / correction                ("אבל לא ביקשתי לעבור מנהל")
 *   - a confirmation of a handoff Tamar itself offered ("כן" after the offer)
 *
 * Only `requested` and `confirmed` may flip ownership to a human.
 * Tamar merely OFFERING a representative never changes ownership.
 */

export type HandoffIntent = "none" | "requested" | "declined" | "confirmed";

export type HandoffIntentResult = {
  intent: HandoffIntent;
  /** convenience: true only for requested/confirmed */
  positive: boolean;
  declined: boolean;
  reason: string;
};

/** Explicit refusal / correction of a transfer to a human. */
const DECLINE_RE = new RegExp(
  [
    "לא\\s*ביקשתי",
    "לא\\s*ביקשנו",
    "לא\\s*רוצה\\s*(לעבור|נציג|מנהל|לדבר\\s*עם)",
    "לא\\s*צריך\\s*(נציג|מנהל|אדם|בן\\s?אדם)",
    "לא\\s*צריכה\\s*(נציג|מנהל)",
    "אל\\s*תעביר(י|ו)?",
    "אין\\s*צורך\\s*(ב)?(נציג|מנהל)",
    "בלי\\s*(נציג|מנהל)",
    "לא\\s*מעוניינ(ת|ים)?\\s*(ב)?(נציג|מנהל)",
    "אני\\s*רוצה\\s*להמשיך\\s*אית?ך",
    "תמשיכי\\s*את",
    "don'?t\\s*transfer",
    "no\\s*(need\\s*for\\s*)?(agent|human|manager|representative)",
    "i\\s*did\\s*n[o']?t\\s*ask",
  ].join("|"),
  "i",
);

/** Short affirmative used to confirm a handoff Tamar just offered. */
const AFFIRM_RE =
  /^(כן|כן\s*בבקשה|בבקשה|אשמח|בטח|סבבה|אוקיי|אוקי|ok|okay|yes|yep|נשמע\s*טוב|מאשר(ת)?)[\s!.,]*$/i;

/** Tamar offered a human — detected on the OUTBOUND text, not the inbound. */
const OFFER_RE =
  /(להעביר\s*אות(ך|ה)\s*ל(נציג|מנהל)|לחבר\s*אות(ך|ה)\s*ל(נציג|מנהל)|רוצה\s*שאעביר|שנציג\s*(אנושי\s*)?יחזור|שאחבר\s*אות(ך|ה)|connect\s*you\s*(with|to)\s*(a\s*)?(human|agent|manager))/i;

export function assistantOfferedHandoff(outboundText: string | null | undefined): boolean {
  return OFFER_RE.test(String(outboundText ?? ""));
}

export function isHandoffDecline(text: string | null | undefined): boolean {
  return DECLINE_RE.test(String(text ?? ""));
}

export function classifyHandoffIntent(input: {
  text: string | null | undefined;
  /** did Tamar's immediately preceding message offer a human? */
  offeredHandoff?: boolean;
  /** deterministic positive signal from the caller's own detector */
  explicitRequest?: boolean;
}): HandoffIntentResult {
  const text = String(input.text ?? "").trim();

  if (isHandoffDecline(text)) {
    return { intent: "declined", positive: false, declined: true, reason: "explicit_decline" };
  }
  if (input.offeredHandoff && AFFIRM_RE.test(text)) {
    return { intent: "confirmed", positive: true, declined: false, reason: "confirmed_offer" };
  }
  if (input.explicitRequest) {
    return { intent: "requested", positive: true, declined: false, reason: "explicit_human_request" };
  }
  return { intent: "none", positive: false, declined: false, reason: "none" };
}
