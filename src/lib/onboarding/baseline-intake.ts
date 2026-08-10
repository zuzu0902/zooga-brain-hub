/**
 * BASELINE INTAKE — one question at a time, never re-asks a known field,
 * a single free-text answer may fill several fields, and after 2-4 questions
 * the conversation must move to value. Pure logic.
 */
import type {
  FieldCompleteness,
  IntakeFieldDefinition,
  ProfileFact,
} from "./types";
import { isDontKnowAnswer } from "@/lib/conversation-guard/core";

export { isDontKnowAnswer };

/** Confidence at/above which a known value blocks re-asking. */
export const KNOWN_CONFIDENCE_MIN = 70;
/** Hard ceiling of baseline questions before Tamar must deliver value. */
export const MAX_BASELINE_QUESTIONS_PER_CONVERSATION = 5;
export const VALUE_AFTER_QUESTIONS = 5;

/**
 * Baseline, one question per turn, asked once ever:
 *   A city
 *   B looking for a relationship
 *   C likes travel
 *   D travel scope        (only when likes_travel = yes)
 *   E last trip           (only when likes_travel = yes)
 * Date of birth is progressive: only after value was delivered, and it never
 * blocks completion.
 */
export const DEFAULT_INTAKE_FIELDS: IntakeFieldDefinition[] = [
  {
    field_key: "city", label: "עיר מגורים",
    question_text: "באיזו עיר את/ה גר/ה?",
    purpose_text: "כדי להתאים אירועים וטיולים קרובים אלייך",
    presentation: "text", options: [], required: true, skippable: true,
    order_index: 10, enabled: true, stage: "baseline",
  },
  {
    field_key: "looking_for_relationship", label: "מחפש/ת זוגיות",
    question_text: "האם את/ה מחפש/ת זוגיות?",
    purpose_text: "כדי לדעת אם להזמין אותך לאירועי היכרויות",
    presentation: "text", options: [], required: true, skippable: true,
    order_index: 20, enabled: true, stage: "baseline",
  },
  {
    field_key: "likes_travel", label: "אוהב/ת טיולים",
    question_text: "האם את/ה אוהב/ת טיולים?",
    purpose_text: "כדי להתאים טיולים רלוונטיים",
    presentation: "text", options: [], required: true, skippable: true,
    order_index: 30, enabled: true, stage: "baseline",
  },
  {
    field_key: "travel_scope", label: "העדפת טיולים",
    question_text: "מה מושך אותך יותר — טיולים בארץ, בחו״ל או גם וגם?",
    purpose_text: null,
    presentation: "text", options: [], required: true, skippable: true,
    order_index: 40, enabled: true, stage: "baseline",
    depends_on: { field_key: "likes_travel", equals: ["yes"] },
  },
  {
    field_key: "last_trip_destination", label: "הטיול האחרון",
    question_text: "איפה היה הטיול האחרון שלך?",
    purpose_text: null,
    presentation: "text", options: [], required: false, skippable: true,
    order_index: 50, enabled: true, stage: "baseline",
    depends_on: { field_key: "likes_travel", equals: ["yes"] },
  },
  {
    field_key: "birth_date", label: "תאריך לידה (אופציונלי)",
    question_text: "כדי שנוכל לשמח אותך ביום ההולדת, תרצה/י לשתף את תאריך הלידה? אפשר גם לבחור 'מעדיפ/ה לא לציין'.",
    purpose_text: "ברכה ומתנת יום הולדת",
    presentation: "text", options: [], required: false, skippable: true,
    order_index: 100, enabled: true, stage: "progressive",
  },
];

export type IntakeSnapshot = {
  /** current facts keyed by field_key */
  facts: Record<string, ProfileFact>;
  /** fields the customer explicitly declined */
  skipped: string[];
};

export function isKnown(fact: ProfileFact | undefined): boolean {
  if (!fact) return false;
  const v = (fact.value_text ?? "").trim();
  if (!v) return false;
  if (fact.explicit_or_inferred === "explicit") return true;
  return fact.confidence >= KNOWN_CONFIDENCE_MIN;
}

/**
 * A conditional question is only relevant when its dependency is already
 * known AND matches. When the dependency is known and does not match, the
 * question is permanently irrelevant (e.g. travel questions for someone who
 * does not like travelling).
 */
export function isFieldRelevant(def: IntakeFieldDefinition, snap: IntakeSnapshot): boolean {
  const dep = def.depends_on;
  if (!dep || !dep.field_key) return true;
  const f = snap.facts[dep.field_key];
  if (!isKnown(f)) return false; // not askable yet
  return dep.equals.includes(String(f?.value_text ?? "").trim());
}

/** Known and permanently ruled out by an unmet dependency. */
function isRuledOut(def: IntakeFieldDefinition, snap: IntakeSnapshot): boolean {
  const dep = def.depends_on;
  if (!dep || !dep.field_key) return false;
  const f = snap.facts[dep.field_key];
  if (!isKnown(f)) return false;
  return !dep.equals.includes(String(f?.value_text ?? "").trim());
}

export function completeness(
  defs: IntakeFieldDefinition[],
  snap: IntakeSnapshot,
): { fields: FieldCompleteness[]; percent: number; missing: string[] } {
  const active = defs
    .filter((d) => d.enabled && !isRuledOut(d, snap))
    .sort((a, b) => a.order_index - b.order_index);
  const fields: FieldCompleteness[] = active.map((d) => {
    const f = snap.facts[d.field_key];
    const known = isKnown(f);
    return {
      field_key: d.field_key,
      label: d.label,
      known,
      kind: f?.explicit_or_inferred ?? null,
      confidence: f?.confidence ?? 0,
      value: f?.value_text ?? null,
      required: d.required,
      skipped: snap.skipped.includes(d.field_key),
    };
  });
  const resolved = fields.filter((f) => f.known || f.skipped).length;
  const percent = fields.length ? Math.round((resolved / fields.length) * 100) : 100;
  return { fields, percent, missing: fields.filter((f) => !f.known && !f.skipped).map((f) => f.field_key) };
}

function pick(defs: IntakeFieldDefinition[], stage: "baseline" | "progressive", snap: IntakeSnapshot) {
  const active = defs
    .filter((d) => d.enabled && (d.stage ?? "baseline") === stage)
    .sort((a, b) => a.order_index - b.order_index);
  for (const d of active) {
    if (isKnown(snap.facts[d.field_key])) continue;
    if (snap.skipped.includes(d.field_key)) continue;
    if (!isFieldRelevant(d, snap)) continue;
    return d;
  }
  return null;
}

/** The next baseline question to ask, or null when baseline intake is done. */
export function nextIntakeStep(
  defs: IntakeFieldDefinition[],
  snap: IntakeSnapshot,
): IntakeFieldDefinition | null {
  return pick(defs, "baseline", snap);
}

/** Optional questions offered only after value was delivered. */
export function nextProgressiveStep(
  defs: IntakeFieldDefinition[],
  snap: IntakeSnapshot,
): IntakeFieldDefinition | null {
  return pick(defs, "progressive", snap);
}

export function baselineComplete(defs: IntakeFieldDefinition[], snap: IntakeSnapshot): boolean {
  return nextIntakeStep(defs, snap) === null;
}

/** True once Tamar must stop asking and deliver value in this conversation. */
export function mustDeliverValue(questionsAskedThisConversation: number): boolean {
  return questionsAskedThisConversation >= VALUE_AFTER_QUESTIONS;
}

export function questionBudgetExhausted(questionsAskedThisConversation: number): boolean {
  return questionsAskedThisConversation >= MAX_BASELINE_QUESTIONS_PER_CONVERSATION;
}

// ---------------------------------------------------------------- DOB

export type DobResult =
  | { ok: true; iso: string; day: number; month: number; year: number | null }
  | { ok: false; reason: "declined" | "unparsable" | "out_of_range" };

const DECLINE_RE = /(מעדיפ|לא רוצה|לא מעוניינ|דלג|לא לציין|בלי תאריך|prefer not)/i;

/** Strict DOB parsing — never guesses, never stores a wrong age. */
export function parseBirthDate(raw: string, today = new Date()): DobResult {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, reason: "unparsable" };
  if (DECLINE_RE.test(s)) return { ok: false, reason: "declined" };
  const m = s.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (!m) return { ok: false, reason: "unparsable" };
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year: number | null = m[3] ? Number(m[3]) : null;
  if (year != null && year < 100) year = year > 30 ? 1900 + year : 2000 + year;
  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, reason: "out_of_range" };
  const thisYear = today.getFullYear();
  if (year != null && (year < thisYear - 110 || year > thisYear - 16)) return { ok: false, reason: "out_of_range" };
  const probeYear = year ?? 2000;
  const d = new Date(Date.UTC(probeYear, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return { ok: false, reason: "out_of_range" };
  const iso = year != null
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : `--${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { ok: true, iso, day, month, year };
}

export function ageFromBirthDate(iso: string, today = new Date()): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null; // no year -> never fabricate an age
  const year = Number(m[1]);
  let age = today.getFullYear() - year;
  const md = (today.getMonth() + 1) * 100 + today.getDate();
  if (md < Number(m[2]) * 100 + Number(m[3])) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

// ------------------------------------------------- free-text multi-fill

const REGION_WORDS = [
  "תל אביב", "ירושלים", "חיפה", "באר שבע", "ראשון לציון", "נתניה", "פתח תקווה", "אשדוד",
  "רעננה", "הרצליה", "מודיעין", "אילת", "רמת גן", "גבעתיים", "כפר סבא", "רחובות",
  "השרון", "הצפון", "הדרום", "המרכז", "השפלה",
];

const INTEREST_WORDS: Array<[RegExp, string]> = [
  [/טיול(ים)? (ב)?חו"?״?ל|חו"?״?ל/, "טיולים בחו״ל"],
  [/טיול(ים)? בארץ|טיולים בישראל/, "טיולים בארץ"],
  [/אירוע|מסיב/, "אירועים"],
  [/היכרו|זוגי|קהיל/, "היכרויות/קהילה"],
  [/תרבות|תיאטרון|הופע|קונצרט/, "תרבות"],
  [/טבע|מסלול|הליכ|צעד/, "טבע"],
  [/אוכל|קולינר|מסעד/, "אוכל"],
];

// ------------------------------------------------------------ normalizers

export type YesNoValue = "yes" | "no" | "unsure" | "prefer_not_to_say";

/** Hebrew letters are not \w, so boundaries are expressed explicitly. */
const B = "(?:^|[^\\u0590-\\u05FFa-zA-Z])";
const E = "(?![\\u0590-\\u05FFa-zA-Z])";
const YES_RE = new RegExp(
  `${B}(כן|בטח|בהחלט|נכון|כמובן|בשמחה|אשמח|ברור|אוהב|אוהבת|מחפש|מחפשת|yes|yep|sure)${E}`,
);
const NO_RE = new RegExp(`${B}(לא|no|nope)${E}`);
const UNSURE_RE = /(אולי|לא יודע|לא יודעת|תלוי|לא בטוח|לא בטוחה|בערך|ככה ככה|maybe)/;

/** Natural Hebrew answer -> normalized yes/no/unsure/prefer_not_to_say. */
export function normalizeYesNo(raw: string): YesNoValue | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (DECLINE_RE.test(s)) return "prefer_not_to_say";
  if (UNSURE_RE.test(s)) return "unsure";
  const negative = NO_RE.test(s);
  // "לא אוהב" / "לא מחפש" is a negation, not a positive statement
  const positive = YES_RE.test(s) && !/לא\s+(אוהב|אוהבת|מחפש|מחפשת|מעוניינ)/.test(s);
  if (negative && !positive) return "no";
  if (positive && !negative) return "yes";
  if (negative && positive) return "unsure";
  return null;
}

export type TravelScopeValue = "israel" | "abroad" | "both" | "other";

/** Natural answer -> israel / abroad / both / other. */
export function normalizeTravelScope(raw: string): TravelScopeValue | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const abroad = /חו"?״?ל|בחו|לחו|abroad|חוץ לארץ/.test(s);
  const israel = /בארץ|ישראל|מקומי|פנים הארץ|domestic/.test(s);
  if (/גם וגם|שניהם|both|גם בארץ וגם/.test(s)) return "both";
  if (abroad && israel) return "both";
  if (abroad) return "abroad";
  if (israel) return "israel";
  return "other";
}

/**
 * Deterministic multi-field extraction from one free-text answer.
 * Only what was clearly said; everything else stays unknown.
 */
export function extractFieldsFromFreeText(
  text: string,
  askedField?: string | null,
): Record<string, { value: string; kind: "explicit" | "inferred"; confidence: number; evidence: string }> {
  const out: Record<string, { value: string; kind: "explicit" | "inferred"; confidence: number; evidence: string }> = {};
  const s = String(text ?? "").trim();
  if (!s) return out;
  const ev = s.slice(0, 200);

  const nameMatch = s.match(/(?:קוראים לי|שמי|אני)\s+([\u0590-\u05FFA-Za-z]{2,15})/);
  if (nameMatch) out["first_name"] = { value: nameMatch[1]!, kind: "explicit", confidence: 95, evidence: ev };
  else if (askedField === "first_name" && /^[\u0590-\u05FFA-Za-z]{2,20}$/.test(s))
    out["first_name"] = { value: s, kind: "explicit", confidence: 95, evidence: ev };

  const city = REGION_WORDS.find((w) => s.includes(w));
  if (city) out["city"] = { value: city, kind: "explicit", confidence: 90, evidence: ev };
  else if (askedField === "city" && s.length <= 30 && !/\d/.test(s))
    out["city"] = { value: s, kind: "explicit", confidence: 85, evidence: ev };

  const interests = INTEREST_WORDS.filter(([re]) => re.test(s)).map(([, label]) => label);
  if (interests.length)
    out["interests"] = { value: Array.from(new Set(interests)).join(", "), kind: "explicit", confidence: 90, evidence: ev };
  else if (askedField === "interests" && s.length >= 2 && !isDontKnowAnswer(s) && !isSkipAnswer(s))
    out["interests"] = { value: s.slice(0, 200), kind: "explicit", confidence: 80, evidence: ev };

  // --- B: looking for a relationship (normalized + raw kept) -------------
  if (askedField === "looking_for_relationship") {
    const v = normalizeYesNo(s);
    if (v) {
      out["looking_for_relationship"] = { value: v, kind: "explicit", confidence: 90, evidence: ev };
      out["looking_for_relationship_raw"] = { value: s.slice(0, 200), kind: "explicit", confidence: 90, evidence: ev };
    }
  } else if (/מחפש(ת)? זוגיות|רוצה זוגיות|מעוניינ(ת)? בזוגיות/.test(s)) {
    out["looking_for_relationship"] = { value: "yes", kind: "inferred", confidence: 65, evidence: ev };
  }

  // --- C: likes travel ----------------------------------------------------
  if (askedField === "likes_travel") {
    const v = normalizeYesNo(s);
    if (v) {
      out["likes_travel"] = { value: v === "prefer_not_to_say" ? "unsure" : v, kind: "explicit", confidence: 90, evidence: ev };
      out["likes_travel_raw"] = { value: s.slice(0, 200), kind: "explicit", confidence: 90, evidence: ev };
    }
  }

  // --- D: travel scope ----------------------------------------------------
  if (askedField === "travel_scope") {
    const v = normalizeTravelScope(s);
    if (v) {
      out["travel_scope"] = { value: v, kind: "explicit", confidence: 90, evidence: ev };
      out["travel_scope_raw"] = { value: s.slice(0, 200), kind: "explicit", confidence: 90, evidence: ev };
    }
  }

  // --- E: last trip destination ------------------------------------------
  if (askedField === "last_trip_destination" && s.length >= 2) {
    out["last_trip_destination"] = { value: s.slice(0, 120), kind: "explicit", confidence: 90, evidence: ev };
    out["last_trip_destination_raw"] = { value: s.slice(0, 200), kind: "explicit", confidence: 90, evidence: ev };
  }

  const dob = parseBirthDate(s);
  if (dob.ok && (askedField === "birth_date" || /נולדתי|יום הולדת|תאריך לידה/.test(s)))
    out["birth_date"] = { value: dob.iso, kind: "explicit", confidence: 95, evidence: ev };

  if (askedField === "primary_goal" && s.length > 3)
    out["primary_goal"] = { value: s.slice(0, 200), kind: "explicit", confidence: 85, evidence: ev };
  else if (!askedField && /רוצה למצוא|בא לי למצוא/.test(s))
    out["primary_goal"] = { value: s.slice(0, 200), kind: "inferred", confidence: 60, evidence: ev };

  return out;
}

/** Explicit customer refusal of the field currently being asked. */
export function isSkipAnswer(text: string): boolean {
  return DECLINE_RE.test(String(text ?? "")) || /^\s*(דלג|skip|לא עכשיו)\s*$/i.test(String(text ?? ""));
}