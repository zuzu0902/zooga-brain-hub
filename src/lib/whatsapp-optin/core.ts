/**
 * WhatsApp opt-in is NOT marketing consent.
 *
 *  whatsapp_opt_in_status : may we open a WhatsApp conversation at all
 *                           (unknown | verified | denied)
 *  consent_marketing      : may we send marketing / campaign content
 *
 * The consent-opening route needs opt-in ONLY. Regular campaigns still
 * require consent_marketing = true. This module is pure and testable.
 */

export type OptInStatus = "unknown" | "verified" | "denied";

export const OPT_IN_STATUSES: OptInStatus[] = ["unknown", "verified", "denied"];

export const OPT_IN_LABELS_HE: Record<OptInStatus, string> = {
  unknown: "לא ידוע",
  verified: "מאומת",
  denied: "נדחה",
};

export const OPT_IN_SOURCE_LABELS_HE: Record<string, string> = {
  legacy_consent: "הסכמה היסטורית",
  legacy_opt_out: "הסרה היסטורית",
  manual_admin: "אישור ידני של הצוות",
  import_file: "קובץ ייבוא",
  phone_call: "שיחת טלפון",
  web_form: "טופס באתר",
  whatsapp_reply: "תשובה בוואטסאפ",
};

export function normalizeOptInStatus(v: unknown): OptInStatus {
  const s = String(v ?? "unknown").trim();
  return (OPT_IN_STATUSES as string[]).includes(s) ? (s as OptInStatus) : "unknown";
}

export type OptInContact = {
  whatsapp_opt_in_status?: string | null;
  whatsapp_opt_in_at?: string | null;
  whatsapp_opt_in_source?: string | null;
  consent_marketing?: boolean | null;
  opted_out_at?: string | null;
  opening_status?: string | null;
  phone?: string | null;
  whatsapp_number?: string | null;
  human_owned?: boolean | null;
  /** operational authorization from an approved pilot file (NOT consent) */
  pilot_eligible_at?: string | null;
  /** the customer wrote to Tamar first */
  last_inbound_at?: string | null;
};

export type Gate = {
  allowed: boolean;
  reason: string | null;
  reason_he: string | null;
  /** why we are allowed to ask for consent at all */
  basis?: "verified_opt_in" | "inbound_initiated" | "pilot_file_eligibility" | null;
};

const deny = (reason: string, he: string): Gate => ({ allowed: false, reason, reason_he: he, basis: null });
const allow = (basis: NonNullable<Gate["basis"]>): Gate => ({
  allowed: true,
  reason: null,
  reason_he: null,
  basis,
});

/** verified is only meaningful with a recorded source AND date. */
export function isVerifiedOptIn(c: OptInContact): boolean {
  return (
    normalizeOptInStatus(c.whatsapp_opt_in_status) === "verified" &&
    !!String(c.whatsapp_opt_in_source ?? "").trim() &&
    !!String(c.whatsapp_opt_in_at ?? "").trim()
  );
}

/**
 * Gate for the consent-opening message ONLY (zooga_opening_consent / he).
 * Three independent bases authorize asking for consent:
 *   1. a verified prior WhatsApp opt-in,
 *   2. an inbound-initiated conversation,
 *   3. approved pilot-file eligibility (Alex explicitly imported the person).
 * None of them is marketing consent — regular campaigns still go through
 * evaluateCampaignSend and require consent_marketing.
 */
export function evaluateConsentOpening(c: OptInContact): Gate {
  const status = normalizeOptInStatus(c.whatsapp_opt_in_status);
  if (c.opted_out_at) return deny("opted_out", "הלקוח ביקש להפסיק קבלת הודעות");
  if (status === "denied") return deny("opt_in_denied", "אישור הפנייה בוואטסאפ נדחה");

  const basis: NonNullable<Gate["basis"]> | null = isVerifiedOptIn(c)
    ? "verified_opt_in"
    : String(c.last_inbound_at ?? "").trim()
      ? "inbound_initiated"
      : String(c.pilot_eligible_at ?? "").trim()
        ? "pilot_file_eligibility"
        : null;
  if (!basis) {
    return status === "verified"
      ? deny("opt_in_incomplete", "אישור מאומת חייב מקור ומועד")
      : deny("no_opening_authorization", "אין אישור לפתיחת שיחה: נדרש אופט-אין מאומת, פנייה נכנסת או קובץ פיילוט מאושר");
  }

  if (!(c.whatsapp_number || c.phone)) return deny("missing_phone", "אין מספר טלפון");
  if (c.human_owned) return deny("human_owned", "השיחה בטיפול אנושי");
  const opening = String(c.opening_status ?? "not_sent");
  if (opening !== "not_sent") return deny("opening_already_sent", "הודעת הפתיחה כבר נשלחה");
  return allow(basis);
}


/** Gate for a regular marketing campaign — consent_marketing is mandatory. */
export function evaluateCampaignSend(c: OptInContact): Gate {
  if (c.opted_out_at) return deny("opted_out", "הלקוח ביקש להפסיק קבלת הודעות");
  if (normalizeOptInStatus(c.whatsapp_opt_in_status) === "denied")
    return deny("opt_in_denied", "אישור הפנייה בוואטסאפ נדחה");
  if (!c.consent_marketing) return deny("no_marketing_consent", "אין הסכמה שיווקית");
  if (!(c.whatsapp_number || c.phone)) return deny("missing_phone", "אין מספר טלפון");
  return allow("verified_opt_in");
}

const YES = [
  "כן", "כן בשמחה", "בשמחה", "מאשר", "מאשרת", "מאשר/ת", "אישור", "אוקיי", "אוקי", "בטח",
  "סבבה", "מסכים", "מסכימה", "אפשר", "yes", "y", "ok", "okay", "sure",
];
const NO = [
  "לא", "לא תודה", "לא מעוניין", "לא מעוניינת", "לא מאשר", "לא מאשרת", "תסירו", "הסר",
  "הסירו אותי", "להסיר", "עצור", "די", "no", "n", "stop", "unsubscribe",
];

function cleanText(text: string | null | undefined): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,׳״"'()]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Answer to the consent-opening message. Only short, unambiguous answers are
 * accepted; anything longer goes back to the normal Tamar engine.
 */
export function classifyConsentReply(input: {
  buttonId?: string | null;
  buttonTitle?: string | null;
  text?: string | null;
}): "yes" | "no" | null {
  const id = cleanText(input.buttonId);
  if (id.includes("consent_yes") || id.includes("opt_in_yes")) return "yes";
  if (id.includes("consent_no") || id.includes("opt_in_no")) return "no";

  const raw = cleanText(input.buttonTitle) || cleanText(input.text);
  if (!raw) return null;
  if (NO.includes(raw)) return "no";
  if (YES.includes(raw)) return "yes";
  if (raw.split(" ").length > 5) return null;
  if (/^לא\b/.test(raw) && NO.some((n) => raw.startsWith(n))) return "no";
  if (/^כן\b/.test(raw)) return "yes";
  return null;
}

export const CONSENT_OPENING_TEMPLATE = "zooga_opening_consent";
export const CONSENT_OPENING_LANGUAGE = "he";

export function consentOpeningText(firstName: string): string {
  const name = String(firstName ?? "").trim() || "שלום";
  return (
    `שלום ${name}, אני תמר, העוזרת הדיגיטלית של קהילת זוגה. ` +
    `אשמח לשוחח איתך — האם את/ה מאשר/ת לי לשלוח לך הודעות למספר הזה? ` +
    `בכל שלב אפשר לבקש לדבר עם אדם מהצוות.`
  );
}

export const CONSENT_YES_REPLY = "תודה! נעים להכיר 🙂 האם נוח לך לצ׳וטט עכשיו?";
export const CONSENT_NO_REPLY =
  "תודה על העדכון, לא נשלח לך יותר הודעות. אם תשנה/י את דעתך תמיד אפשר לכתוב לנו.";
/** Version of the consent wording actually sent. Persisted as evidence. */
export const CONSENT_WORDING_VERSION = "pilot_consent_v1";

export type ConsentAskEvidence = {
  template: string;
  language: string;
  transport: "template" | "session";
  wording_version: string;
  wording: string;
  provider_message_id: string | null;
  basis: string | null;
  asked_at: string;
};

export type ConsentResponseEvidence = {
  answer: "yes" | "no";
  provider_message_id: string | null;
  button_id: string | null;
  button_title: string | null;
  text: string | null;
  source: string;
  responded_at: string;
};

/** Structured evidence for the consent question that was actually sent. */
export function consentAskEvidence(args: {
  transport: "template" | "session";
  text: string;
  providerMessageId: string | null;
  basis: string | null;
  askedAt: string;
}): ConsentAskEvidence {
  return {
    template: CONSENT_OPENING_TEMPLATE,
    language: CONSENT_OPENING_LANGUAGE,
    transport: args.transport,
    wording_version: CONSENT_WORDING_VERSION,
    wording: String(args.text ?? "").slice(0, 1000),
    provider_message_id: args.providerMessageId,
    basis: args.basis,
    asked_at: args.askedAt,
  };
}

/** Structured evidence for the customer's answer, linked to the question. */
export function consentResponseEvidence(args: {
  answer: "yes" | "no";
  buttonId?: string | null;
  buttonTitle?: string | null;
  text?: string | null;
  sourceMessageId?: string | null;
  respondedAt: string;
}): ConsentResponseEvidence {
  return {
    answer: args.answer,
    provider_message_id: args.sourceMessageId ?? null,
    button_id: args.buttonId ?? null,
    button_title: args.buttonTitle ?? null,
    text: String(args.text ?? "").slice(0, 500) || null,
    source: "whatsapp_reply",
    responded_at: args.respondedAt,
  };
}
