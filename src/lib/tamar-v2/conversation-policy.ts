/** Canonical, customer-visible Tamar conversation policy (pure). */
export const POST_CONSENT_OPENING = "האם אתה מכיר את זוגה או שתרצה שאספר לך קצת עלינו?";

/**
 * The ONLY permitted reply to a true first inbound message (the customer
 * wrote first and there is no prior accepted inbound conversation turn).
 * Product-owned copy: never rephrased, never appended to, never followed by
 * a question, an offer, a destination or any technical text.
 */
export const FIRST_INBOUND_GREETING =
  "היי, איזה כיף שכתבת לי! אני תמר. אתה כבר מכיר את זוגה או שתרצה שאספר לך קצת עלינו?";

export const KNOWN_ZOOGA_REPLY =
  "איזה כיף! אני אשמח להכיר אותך קצת יותר אישית כדי להתאים לך רעיונות בהמשך. יש לך כמה דקות שנדבר?";

export const NEW_TO_ZOOGA_REPLY =
  "בשמחה. זוגה היא קהילה ישראלית שמחברת בין אנשים דרך טיולים, אירועים ומפגשים חברתיים. יש לך כמה דקות שנכיר קצת?";

export const ZOOGA_FAMILIARITY_STEP = "zooga_familiarity";

const KNOWS_ZOOGA_RE =
  /^(כן|בטח|בוודאי|ברור|מכיר|מכירה|אני\s+מכיר|אני\s+מכירה|כן[,! ]+אני\s+מכיר|כן[,! ]+אני\s+מכירה)(?:[\s.!?,]|$)/i;
const NEW_TO_ZOOGA_RE =
  /^(לא|לא\s+מכיר|לא\s+מכירה|לא\s+ממש|ספרי|תספרי|אשמח\s+לשמוע|אני\s+לא\s+מכיר|אני\s+לא\s+מכירה)(?:[\s.!?,]|$)/i;

export type ZoogaFamiliarity = "known" | "new" | "unknown";

export function classifyZoogaFamiliarity(message: string | null | undefined): ZoogaFamiliarity {
  const text = String(message ?? "").trim();
  if (!text) return "unknown";
  if (NEW_TO_ZOOGA_RE.test(text)) return "new";
  if (KNOWS_ZOOGA_RE.test(text)) return "known";
  return "unknown";
}

const INTERNAL_JARGON_RE =
  /\b(model|tool|prompt|system|state|workflow|runtime|fallback|handoff|intent|json|api)\b|\b(?:consent_asked|intake_active|recommendation_ready|value_delivered|human_owned)\b/i;

/** Reject implementation language that must never reach a customer. */
export function isCustomerFacingHebrewClean(text: string | null | undefined): boolean {
  const value = String(text ?? "").trim();
  return !!value && !INTERNAL_JARGON_RE.test(value);
}