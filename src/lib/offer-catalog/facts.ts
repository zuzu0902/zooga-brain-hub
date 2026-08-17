/**
 * Deterministic conversation fact extraction (PURE, no AI).
 * Works identically on typed text and on a voice transcript.
 */
import { parseIntent } from "./match";
import { normHe, tokenize, containsTerm } from "./normalize";

export type ConversationFacts = {
  destination: string | null;
  holiday: string | null;
  months: number[];
  travel_party: "solo" | "with_partner" | null;
  mobility_limit: boolean;
  preferences: string[];
};

const SOLO_TERMS = ["לבד", "solo", "בלי בן זוג", "בלי בת זוג", "אין לי בן זוג", "רווקה", "רווק"];
const PARTNER_TERMS = ["עם בן זוג", "עם בת זוג", "עם בעלי", "עם אשתי", "זוג", "שנינו", "בן זוגי", "בת זוגי"];
const MOBILITY_RE =
  /(כאב(י)?\s*רגל|בעיה\s*ברגל|קושי\s*בהליכה|לא\s*יכול(ה)?\s*ללכת\s*הרבה|הליכות\s*ארוכות\s*קשות|ניתוח\s*ברך|בעיות\s*גב|נגישות|כסא\s*גלגלים)/;
const PREFERENCE_TERMS: Array<[string, string[]]> = [
  ["kosher", ["כשר", "כשרות"]],
  ["vegetarian", ["צמחוני", "טבעוני"]],
  ["culture", ["תרבות", "היסטוריה", "מוזיאון"]],
  ["nature", ["טבע", "נופים", "טיולי טבע"]],
  ["luxury", ["יוקרה", "מפנק", "5 כוכבים"]],
  ["budget", ["זול", "תקציב", "חסכוני"]],
  ["beach", ["חוף", "ים", "בריכה"]],
];

export function extractConversationFacts(text: string): ConversationFacts {
  const raw = String(text ?? "");
  const norm = normHe(raw);
  const tokens = tokenize(raw);
  const intent = parseIntent(raw);

  let travel_party: ConversationFacts["travel_party"] = null;
  if (PARTNER_TERMS.some((t) => containsTerm(tokens, t))) travel_party = "with_partner";
  else if (SOLO_TERMS.some((t) => containsTerm(tokens, t))) travel_party = "solo";

  const preferences: string[] = [];
  for (const [key, terms] of PREFERENCE_TERMS) {
    if (terms.some((t) => containsTerm(tokens, t))) preferences.push(key);
  }

  return {
    destination: intent.destinations[0] ?? null,
    holiday: intent.holidays[0] ?? null,
    months: intent.months,
    travel_party,
    mobility_limit: MOBILITY_RE.test(norm) || MOBILITY_RE.test(raw),
    preferences,
  };
}

/** Merge new facts over stored ones without ever erasing a known value. */
export function mergeConversationFacts(
  stored: Partial<ConversationFacts> | null | undefined,
  next: ConversationFacts,
): ConversationFacts {
  const base = stored ?? {};
  return {
    destination: next.destination ?? base.destination ?? null,
    holiday: next.holiday ?? base.holiday ?? null,
    months: next.months.length ? next.months : (base.months ?? []),
    travel_party: next.travel_party ?? base.travel_party ?? null,
    mobility_limit: next.mobility_limit || !!base.mobility_limit,
    preferences: [...new Set([...(base.preferences ?? []), ...next.preferences])],
  };
}