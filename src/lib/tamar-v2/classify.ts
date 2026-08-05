/**
 * TAMAR BRAIN V2 — deterministic inbound classification (pure, pre-model).
 *
 * These detectors run BEFORE any model call and are authoritative:
 * a human request, an explicit opt-out or a distress signal never depends
 * on an LLM. Confusion is explicitly separated from refusal — "לא הבנתי"
 * is a clarification request, never a "no".
 */

/** Explicit, unambiguous request for a human. */
const HUMAN_RE =
  /(נציג(ה)?\b|לדבר\s+עם\s+(אדם|מישהו|בן\s?אדם|נציג|מנהל|איש)|בן\s?אדם\s+אמיתי|אדם\s+אמיתי|תעביר(י|ו)?\s+(אותי\s+)?ל(אדם|נציג|מנהל|מישהו)|העבר(י|ו)?\s+(אותי\s+)?ל(אדם|נציג|מנהל|מישהו)|רוצה\s+לדבר\s+עם|אפשר\s+לדבר\s+עם|שיחזרו?\s+אלי|תתקשר(י|ו)?\s+אלי|human|real\s+person|speak\s+to\s+(a\s+|an\s+)?(agent|human|manager|representative))/i;

/** Implicit human need: frustration with the bot itself. */
const IMPLICIT_HUMAN_RE =
  /(את\s+בוט|זה\s+בוט|לא\s+עוזר(ת)?\s+לי|לא\s+מבינה\s+אותי|נמאס\s+לי|תפסיקי\s+לשאול|מספיק\s+שאלות)/i;

const COMPLAINT_RE =
  /(תלונה|מתלונן|מתלוננת|מאוכזב(ת)?|לא\s+מרוצה|גרוע|שערורי|רמאות|רמיתם|הונאה|תבע|עורך\s+דין|complaint|scam|refund)/i;

const PAYMENT_RE =
  /(חיוב\s+כפול|חויבתי|החזר\s+כספי|לא\s+קיבלתי\s+החזר|תשלום\s+נכשל|בעיה\s+בתשלום|כרטיס\s+אשראי|chargeback)/i;

const DISTRESS_RE =
  /(לא\s+רוצה\s+לחיות|אובדני|להתאבד|התאבד|דיכאון|מדוכא(ת)?|משבר\s+קשה|חרדה\s+קשה|מצוקה\s+נפשית|בעלי\s+נפטר|אשתי\s+נפטרה|התאלמנתי|suicid|depress)/i;

/** Confusion / clarification request — NEVER an opt-out or a "no". */
const CONFUSION_RE =
  /^(\s*)(מה\s*\?*$|מה\s+זה|מה\s+זאת\s+אומרת|לא\s+הבנתי|לא\s+ברור|תסביר(י)?|הסבר|אפשר\s+הסבר|מי\s+זאת|מי\s+את|\?+$|ha\?|what\?)/i;

const EXPLAIN_RE = /(רוצה\s+הסבר|תסביר(י)?|הסבר|מה\s+זה\s+זוגה|מי\s+את)/i;

/** Explicit opt-out only: a standalone command or an unmistakable phrase. */
const EXPLICIT_OPTOUT_PHRASE_RE =
  /(אל\s+תשלח(י|ו)?\s+(לי)?|הסירו?\s+אותי|תסירו?\s+אותי|להסיר\s+אותי|תוריד(י|ו)?\s+אותי|לא\s+מעוניין(ת)?\s+לקבל|הפסיקו?\s+לשלוח|תפסיקו?\s+לשלוח|unsubscribe|remove\s+me|stop\s+messages)/i;
const OPTOUT_TOKENS = ["הסר", "הסירו", "הסירי", "להסרה", "stop", "unsubscribe"];

const OPTIN_TOKENS = ["התחל", "start", "subscribe", "הצטרף", "הצטרפי"];

function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function isExplicitOptOut(text: string | null | undefined): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (EXPLICIT_OPTOUT_PHRASE_RE.test(raw)) return true;
  const t = tokenize(raw);
  return t.length > 0 && t.length <= 2 && t.some((w) => OPTOUT_TOKENS.includes(w));
}

export function isExplicitOptIn(text: string | null | undefined): boolean {
  const t = tokenize(String(text ?? ""));
  return t.length > 0 && t.length <= 3 && t.some((w) => OPTIN_TOKENS.includes(w));
}

export function wantsHuman(text: string | null | undefined): boolean {
  const raw = String(text ?? "");
  return HUMAN_RE.test(raw) || IMPLICIT_HUMAN_RE.test(raw);
}

export function isConfusion(text: string | null | undefined): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  return CONFUSION_RE.test(raw);
}

export function wantsExplanation(text: string | null | undefined): boolean {
  return EXPLAIN_RE.test(String(text ?? ""));
}

export type SafetySignal = {
  handoff: boolean;
  urgency: "low" | "normal" | "high";
  reason: string;
  reason_codes: string[];
};

/** Deterministic handoff triggers — supreme, model-independent. */
export function detectSafetySignal(text: string | null | undefined): SafetySignal {
  const raw = String(text ?? "");
  const codes: string[] = [];
  let urgency: SafetySignal["urgency"] = "normal";
  if (DISTRESS_RE.test(raw)) {
    codes.push("distress");
    urgency = "high";
  }
  if (COMPLAINT_RE.test(raw)) {
    codes.push("complaint");
    urgency = "high";
  }
  if (PAYMENT_RE.test(raw)) {
    codes.push("payment_issue");
    urgency = "high";
  }
  if (HUMAN_RE.test(raw)) codes.push("explicit_human_request");
  else if (IMPLICIT_HUMAN_RE.test(raw)) codes.push("implicit_human_request");
  return { handoff: codes.length > 0, urgency, reason: codes[0] ?? "none", reason_codes: codes };
}

/**
 * Consent classification. ONLY valid while state === "consent_asked".
 * Negation inside a sentence is never an automatic "no".
 */
const YES_RE =
  /^(\s*)(כן|כן[!,. ]|כן\s*בשמחה|בשמחה|בטח|בהחלט|אפשר|אוקיי|אוקי|אישור|מאשר(ת)?|סבבה|יאללה|בסדר|למה\s+לא|נשמע\s+טוב|מעוניין(ת)?|רוצה|yes|yep|sure|ok(ay)?)([\s.!?,]|$)/i;
const NO_RE =
  /^(\s*)(לא|לא[!,. ]|לא\s*תודה|לא\s+מעוניין(ת)?|לא\s+רוצה|תודה\s+לא|אין\s+צורך|no|nope|no\s+thanks|not\s+interested)([\s.!?,]|$)/i;

export type ConsentAnswerV2 = "yes" | "no" | "explain" | "unknown";

export function classifyConsent(
  text: string | null | undefined,
  opts?: { optionValue?: string | null },
): ConsentAnswerV2 {
  const optionValue = opts?.optionValue?.trim();
  if (optionValue === "yes" || optionValue === "no" || optionValue === "explain") return optionValue;

  const raw = String(text ?? "").trim();
  if (!raw) return "unknown";
  if (isExplicitOptOut(raw)) return "no";
  // Confusion always wins over a bare "no" pattern.
  if (isConfusion(raw)) return "unknown";
  if (wantsExplanation(raw)) return "explain";
  if (NO_RE.test(raw)) return "no";
  if (isExplicitOptIn(raw) || YES_RE.test(raw)) return "yes";
  return "unknown";
}

const QUESTION_RE = /[?？]|(^|\s)(מה|מתי|איפה|כמה|האם|איך|למה|מי|אילו|איזה|יש\s+לכם|יש\s+לך)(\s|$)/;
export function isUserQuestion(text: string | null | undefined): boolean {
  const raw = String(text ?? "").trim();
  return !!raw && QUESTION_RE.test(raw);
}

const GREETING_RE = /^(\s*)(היי|הי|שלום|בוקר\s+טוב|ערב\s+טוב|צהריים\s+טובים|הלו|אהלן|hi|hello|hey)[\s!.,🙂]*$/i;
export function isGreeting(text: string | null | undefined): boolean {
  return GREETING_RE.test(String(text ?? "").trim());
}
