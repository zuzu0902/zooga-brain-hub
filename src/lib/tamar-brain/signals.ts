/**
 * TAMAR BRAIN v1 — deterministic inbound signal detection (pure).
 * Handoff is the supreme rule, so these detectors are intentionally broad
 * and never depend on the model.
 */

import { classifyHandoffIntent, isHandoffDecline } from "@/lib/handoff-intent";

export type HandoffSignal = {
  handoff: boolean;
  urgency: "low" | "normal" | "high";
  reason: string;
  reason_codes: string[];
  /** requested / confirmed / declined / none — ownership may change on the first two */
  intent?: "none" | "requested" | "declined" | "confirmed";
};

const EXPLICIT_HUMAN_RE =
  /(נציג|לדבר\s+עם\s+(אדם|מישהו|בן\s?אדם|נציג|מנהל)|אדם\s+אמיתי|בן\s?אדם|אלכס|מנהל(ת)?|תעביר(י|ו)?\s+(אותי\s+)?ל|העבר(ו|י)?\s+(אותי\s+)?ל|אפשר\s+לדבר|תתקשר(ו|י)?|טלפון\s+אלי|שיחזרו\s+אלי|human|real\s+person|speak\s+to\s+(a\s+|an\s+)?(agent|representative|manager|human)|call\s+me)/i;

const COMPLAINT_RE =
  /(תלונה|מתלונן|מאוכזב|לא\s+מרוצה|גרוע|שערורי|נורא|רמאות|רמיתם|הונאה|תבע|עורך\s+דין|complaint|scam|awful|terrible|refund)/i;

const PAYMENT_RE =
  /(חיוב\s+כפול|חויבתי|לא\s+קיבלתי\s+החזר|החזר\s+כספי|תשלום\s+נכשל|בעיה\s+בתשלום|כרטיס\s+אשראי|chargeback|double\s+charge)/i;

const DISTRESS_RE =
  /(מדוכא|דיכאון|בודד\s+מאוד|אני\s+בודדה?\s+נורא|לא\s+רוצה\s+לחיות|אובדני|מצוקה|משבר|חרדה\s+קשה|אלמן|אלמנה|נפטר|התאבד|suicid|depress|crisis)/i;

/**
 * Deterministic handoff triggers on the INBOUND message.
 * An explicit refusal ("אבל לא ביקשתי לעבור מנהל") NEVER produces a handoff.
 */
export function detectHandoffSignal(
  message: string | null | undefined,
  opts?: { offeredHandoff?: boolean },
): HandoffSignal {
  const text = String(message ?? "");
  const codes: string[] = [];
  let urgency: HandoffSignal["urgency"] = "normal";
  const declined = isHandoffDecline(text);

  if (DISTRESS_RE.test(text)) {
    codes.push("distress");
    urgency = "high";
  }
  if (COMPLAINT_RE.test(text)) {
    codes.push("complaint");
    urgency = "high";
  }
  if (PAYMENT_RE.test(text)) {
    codes.push("payment_issue");
    urgency = "high";
  }
  const intentRes = classifyHandoffIntent({
    text,
    offeredHandoff: opts?.offeredHandoff,
    explicitRequest: EXPLICIT_HUMAN_RE.test(text),
  });
  if (intentRes.positive) codes.push("explicit_human_request");
  if (declined) codes.push("handoff_declined");

  const positiveCodes = codes.filter((c) => c !== "handoff_declined");
  // A correction like "לא ביקשתי מנהל" must not escalate on its own.
  const handoff = declined ? positiveCodes.some((c) => c !== "explicit_human_request") : positiveCodes.length > 0;

  return {
    handoff,
    urgency,
    reason: (handoff ? positiveCodes[0] : codes[0]) ?? "none",
    reason_codes: codes,
    intent: intentRes.intent,
  };
}

const QUESTION_RE = /[?？]|(^|\s)(מה|מתי|איפה|כמה|האם|איך|למה|מי|אילו|איזה)(\s|$)/;

/** Is the user asking something? User-led conversation: answer before asking. */
export function isUserQuestion(message: string | null | undefined): boolean {
  const text = String(message ?? "").trim();
  if (!text) return false;
  return QUESTION_RE.test(text);
}

/** Natural goodbye — ends the conversation session (not the relationship). */
/** Explicit farewell words — enough on their own (e.g. "תודה, להתראות"). */
const FAREWELL_RE = /(להתראות|ביי\b|נדבר\s+בהמשך|נדבר\b|bye|goodbye|see\s+you)/i;
/** A bare thanks with nothing else asked. */
const BARE_THANKS_RE = /^(תודה\s*(רבה)?|מעולה\s*תודה|thanks|thank\s+you)[\s,.!?😊🙏]*$/i;
export function isGoodbye(message: string | null | undefined): boolean {
  const t = String(message ?? "").trim();
  if (!t || t.length > 40) return false;
  // A question is never a goodbye, even when it opens with "תודה".
  if (/[?？]/.test(t)) return false;
  return FAREWELL_RE.test(t) || BARE_THANKS_RE.test(t);
}