/**
 * Reply policy for a "עדכון על פעילות חדשה" (re-engagement) activation.
 *
 * Pure logic only. The template itself never carries activity details — those
 * are sent only after the customer replies, inside the service window, and
 * only from stored facts.
 */

export type ReengagementReply = "interested" | "not_interested" | "unsubscribe" | "unclear";

const UNSUBSCRIBE = [
  /אל\s*תפנו\s*אלי/i,
  /אל\s*תפני\s*אלי/i,
  /הסר(?:ו|י)?\s*אותי/i,
  /הסירו\s*אותי/i,
  /להסיר\s*אותי/i,
  /תפסיקו\s*לשלוח/i,
  /הפסיקו\s*לשלוח/i,
  /לא\s*רוצה\s*לקבל\s*(?:יותר\s*)?הודעות/i,
  /unsubscribe/i,
];

const INTERESTED = [
  /\bכן\b/,
  /שלחי/,
  /תשלחי/,
  /פרטים/,
  /מעוניינ/,
  /מעניין/,
  /בשמחה/,
  /אשמח/,
  /ספרי\s*לי/,
  /קישור/,
];

const NOT_INTERESTED = [
  /לא\s*מעוניינ/,
  /לא\s*רלוונטי/,
  /לא\s*מתאים/,
  /לא\s*עכשיו/,
  /לא\s*הפעם/,
  /^לא\s*תודה/,
  /^לא$/,
];

/**
 * "לא מעוניין בפעילות" is NOT a global opt-out; only an explicit removal
 * request is.
 */
export function classifyReengagementReply(text: string | null | undefined): ReengagementReply {
  const t = String(text ?? "").trim();
  if (!t) return "unclear";
  if (UNSUBSCRIBE.some((r) => r.test(t))) return "unsubscribe";
  if (NOT_INTERESTED.some((r) => r.test(t))) return "not_interested";
  if (INTERESTED.some((r) => r.test(t))) return "interested";
  return "unclear";
}

export type ReengagementOfferFacts = {
  title: string;
  offer_url?: string | null;
  summary?: string | null;
  event_date?: string | null;
  event_end_date?: string | null;
};

export type ReengagementRouting = {
  reply: ReengagementReply;
  /** clears the pending re-engagement marker on the contact */
  consume: boolean;
  opt_out: boolean;
  send_details: boolean;
  next: "continue_intake" | "relationship_survey" | "none";
  path: string;
};

export function routeReengagementReply(args: {
  message: string;
  intakeCompleted: boolean;
  relationshipPending: boolean;
}): ReengagementRouting {
  const reply = classifyReengagementReply(args.message);
  if (reply === "unsubscribe")
    return { reply, consume: true, opt_out: true, send_details: false, next: "none", path: "reengagement_opt_out" };
  if (reply === "interested")
    return {
      reply,
      consume: true,
      opt_out: false,
      send_details: true,
      next: "none",
      path: "reengagement_details",
    };
  if (reply === "not_interested") {
    // Never restart a completed intake.
    const next = !args.intakeCompleted
      ? "continue_intake"
      : args.relationshipPending
        ? "relationship_survey"
        : "none";
    return { reply, consume: true, opt_out: false, send_details: false, next, path: "reengagement_declined" };
  }
  return { reply, consume: false, opt_out: false, send_details: false, next: "none", path: "reengagement_unclear" };
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
}

/** Factual details message. Only stored facts — never invented. */
export function buildActivityDetails(offer: ReengagementOfferFacts | null): string {
  if (!offer) {
    return "אני בודקת מול הצוות את הפרטים המדויקים וחוזרת אלייך כאן.";
  }
  const lines: string[] = [`הנה הפרטים על ${offer.title}:`];
  if (offer.summary) lines.push(String(offer.summary).slice(0, 400));
  const start = fmtDate(offer.event_date);
  const end = fmtDate(offer.event_end_date);
  if (start) lines.push(end && end !== start ? `תאריכים: ${start} עד ${end}` : `תאריך: ${start}`);
  if (offer.offer_url) lines.push(offer.offer_url);
  lines.push("יש משהו שחשוב לך לדעת לפני שנתקדם?");
  return lines.join("\n");
}

export const REENGAGEMENT_DECLINE_TEXT =
  "מובן לגמרי, תודה שאמרת 🙏 לא אציע לך את הפעילות הזו שוב.";

/** No reply at all: log only, never free text and never intake progress. */
export const NO_RESPONSE_OUTCOME = "no_response" as const;