/**
 * RELATIONSHIP AI INSIGHTS — pure logic (safe on client and server).
 *
 * Internal, admin-only, NON-CLINICAL behavioural/relationship profile built
 * only from the relationship questionnaire answers. Never customer facing.
 * Every item is labelled explicit_fact / supported_hypothesis / unknown and
 * carries evidence pointing at real question keys.
 */
import type { RelationshipAnswer } from "@/lib/relationship-intake/questions";

export const INSIGHTS_PROMPT_VERSION = "rel-insights-v1";

export const INSIGHT_SECTION_KEYS = [
  "relationship_goal_readiness",
  "communication_style",
  "values_expectations",
  "lifestyle_family_fit",
  "partner_preferences_flexibility",
  "strengths_resources",
  "needs_boundaries",
] as const;

export type InsightSectionKey = (typeof INSIGHT_SECTION_KEYS)[number];

export const SECTION_LABELS: Record<InsightSectionKey, string> = {
  relationship_goal_readiness: "מטרה ומוכנות לקשר",
  communication_style: "סגנון תקשורת ואינטראקציה",
  values_expectations: "ערכים וציפיות",
  lifestyle_family_fit: "אורח חיים, משפחה והתאמה לוגיסטית",
  partner_preferences_flexibility: "העדפות בן/בת זוג וגמישות",
  strengths_resources: "חוזקות ומשאבים",
  needs_boundaries: "צרכים וגבולות",
};

export type Certainty = "explicit_fact" | "supported_hypothesis" | "unknown";
export const CERTAINTY_VALUES: Certainty[] = ["explicit_fact", "supported_hypothesis", "unknown"];

export type InsightItem = {
  text: string;
  certainty: Certainty;
  evidence_keys: string[];
  evidence_answer_ids: string[];
};

export type InsightSection = {
  key: InsightSectionKey;
  label: string;
  items: InsightItem[];
};

export type InsightsPayload = {
  summary_he: string;
  sections: InsightSection[];
  contradictions: InsightItem[];
  missing_info: Array<{ question_key: string; question: string }>;
  matching_tags: Array<{ tag: string; certainty: Certainty; evidence_keys: string[] }>;
  confidence: number;
  section_confidence: Partial<Record<InsightSectionKey, number>>;
};

export type InsightsStatus = "ok" | "degraded" | "fallback" | "error";

// ----------------------------------------------------------- source hash

/** Deterministic, dependency-free 128-bit-ish hash (FNV-1a x4 lanes). */
export function stableHash(input: string): string {
  const lanes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    for (let l = 0; l < 4; l++) {
      lanes[l] = (lanes[l]! ^ (c + l)) >>> 0;
      lanes[l] = Math.imul(lanes[l]!, 16777619) >>> 0;
    }
  }
  return lanes.map((l) => (l >>> 0).toString(16).padStart(8, "0")).join("");
}

/**
 * Hash of the SOURCE answers only. Changes exactly when a current answer's
 * text, skip flag or source changes — never when unrelated CRM data moves.
 */
export function answersSourceHash(answers: Record<string, RelationshipAnswer>): string {
  const parts = Object.keys(answers)
    .sort()
    .map((k) => {
      const a = answers[k]!;
      return [k, a.skipped_by_user ? "SKIP" : String(a.raw_text ?? "").trim(), a.source].join("\u0001");
    });
  return stableHash(`${INSIGHTS_PROMPT_VERSION}\u0002${parts.join("\u0002")}`);
}

export function answeredKeys(answers: Record<string, RelationshipAnswer>): string[] {
  return Object.keys(answers)
    .filter((k) => !answers[k]!.skipped_by_user && !!String(answers[k]!.raw_text ?? "").trim())
    .sort();
}

// ------------------------------------------------------------- safeguards

/**
 * Clinical / diagnostic / worthiness language is forbidden in an internal
 * behavioural profile. Any item that trips this is dropped.
 */
const FORBIDDEN_RE = new RegExp(
  [
    "דיכאון", "חרדה קלינית", "הפרעת", "הפרעה נפשית", "פוסט טראומ", "פוסט־טראומ", "טראומה מורכבת",
    "נרקיסיסט", "פסיכופת", "סוציופת", "בורדרליין", "ביפולר", "סכיזופרנ", "פתולוג", "אבחנה",
    "טיפול פסיכולוגי נדרש", "לא ראוי", "לא שווה", "ציון התאמה", "לפסול", "יש לפסול", "נמוכה מדי כדי",
    "depress", "bipolar", "narcissis", "psychopath", "borderline", "diagnos", "disorder", "unworthy",
  ].join("|"),
  "i",
);

export function containsClinicalClaim(text: string): boolean {
  return FORBIDDEN_RE.test(String(text ?? ""));
}

// -------------------------------------------------------------- parsing

function str(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clampPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function certaintyOf(v: unknown): Certainty {
  return CERTAINTY_VALUES.includes(v as Certainty) ? (v as Certainty) : "unknown";
}

function parseItem(raw: any, validKeys: Set<string>, idByKey: Record<string, string>): InsightItem | null {
  const text = str(raw?.text, 400);
  if (!text) return null;
  if (containsClinicalClaim(text)) return null;
  const keys = (Array.isArray(raw?.evidence_keys) ? raw.evidence_keys : [])
    .map((k: unknown) => str(k, 60))
    .filter((k: string) => validKeys.has(k));
  let certainty = certaintyOf(raw?.certainty);
  // No evidence => cannot be a fact or a supported hypothesis.
  if (!keys.length) certainty = "unknown";
  return {
    text,
    certainty,
    evidence_keys: Array.from(new Set<string>(keys)),
    evidence_answer_ids: Array.from(new Set<string>(keys)).map((k) => idByKey[k]).filter(Boolean) as string[],
  };
}

export type ParseContext = {
  /** question keys that actually exist in this contact's answers */
  validKeys: Set<string>;
  /** question_key -> answer row id */
  idByKey: Record<string, string>;
  /** unanswered/skipped questions, for the missing-info section */
  missing: Array<{ question_key: string; question: string }>;
};

/** Strict structured-output validation. Returns null when unusable. */
export function parseInsights(raw: string | null, ctx: ParseContext): InsightsPayload | null {
  if (!raw) return null;
  const match = String(raw).match(/\{[\s\S]*\}/);
  if (!match) return null;
  let json: any;
  try {
    json = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const summary = str(json?.summary_he, 1200);
  if (!summary || containsClinicalClaim(summary)) return null;

  const sections: InsightSection[] = [];
  const rawSections: any[] = Array.isArray(json?.sections) ? json.sections : [];
  for (const key of INSIGHT_SECTION_KEYS) {
    const found = rawSections.find((s) => str(s?.key, 60) === key);
    const items = (Array.isArray(found?.items) ? found.items : [])
      .map((i: any) => parseItem(i, ctx.validKeys, ctx.idByKey))
      .filter(Boolean) as InsightItem[];
    sections.push({ key, label: SECTION_LABELS[key], items: items.slice(0, 8) });
  }
  if (!sections.some((s) => s.items.length)) return null;

  const contradictions = (Array.isArray(json?.contradictions) ? json.contradictions : [])
    .map((i: any) => parseItem(i, ctx.validKeys, ctx.idByKey))
    .filter(Boolean)
    .slice(0, 6) as InsightItem[];

  const matching_tags = (Array.isArray(json?.matching_tags) ? json.matching_tags : [])
    .map((t: any) => {
      const tag = str(t?.tag, 60);
      if (!tag || containsClinicalClaim(tag)) return null;
      const keys = (Array.isArray(t?.evidence_keys) ? t.evidence_keys : [])
        .map((k: unknown) => str(k, 60))
        .filter((k: string) => ctx.validKeys.has(k));
      return {
        tag,
        certainty: keys.length ? certaintyOf(t?.certainty) : ("unknown" as Certainty),
        evidence_keys: Array.from(new Set<string>(keys)),
      };
    })
    .filter(Boolean)
    .slice(0, 20) as InsightsPayload["matching_tags"];

  const section_confidence: Partial<Record<InsightSectionKey, number>> = {};
  for (const key of INSIGHT_SECTION_KEYS) {
    const v = json?.section_confidence?.[key];
    section_confidence[key] = v == null ? evidenceConfidence(sections.find((s) => s.key === key)!) : clampPct(v);
  }

  return {
    summary_he: summary,
    sections,
    contradictions,
    missing_info: ctx.missing.slice(0, 30),
    matching_tags,
    confidence: json?.confidence == null ? overallConfidence(sections) : clampPct(json.confidence),
    section_confidence,
  };
}

function evidenceConfidence(section: InsightSection | undefined): number {
  if (!section || !section.items.length) return 0;
  const score = section.items.reduce(
    (acc, i) => acc + (i.certainty === "explicit_fact" ? 100 : i.certainty === "supported_hypothesis" ? 60 : 20),
    0,
  );
  return Math.round(score / section.items.length);
}

export function overallConfidence(sections: InsightSection[]): number {
  const scored = sections.filter((s) => s.items.length);
  if (!scored.length) return 0;
  return Math.round(scored.reduce((a, s) => a + evidenceConfidence(s), 0) / scored.length);
}

// -------------------------------------------------------------- fallback

const FALLBACK_MAP: Array<{ section: InsightSectionKey; keys: string[] }> = [
  { section: "relationship_goal_readiness", keys: ["relationship_status", "last_relationship", "readiness_feeling", "desired_relationship_type"] },
  { section: "communication_style", keys: ["anything_else"] },
  { section: "values_expectations", keys: ["relationship_values", "religiosity", "future_plans"] },
  { section: "lifestyle_family_fit", keys: ["lifestyle", "children", "occupation", "education", "geography", "habits_preferences", "height"] },
  { section: "partner_preferences_flexibility", keys: ["desired_partner_gender", "age_range", "important_traits", "geography"] },
  { section: "strengths_resources", keys: ["occupation", "education", "lifestyle"] },
  { section: "needs_boundaries", keys: ["dealbreakers", "habits_preferences"] },
];

/**
 * Deterministic, model-free profile built ONLY from explicit answers. Used
 * when the model times out or returns invalid JSON, so an admin always sees
 * something truthful. Every item is an explicit_fact quote — no inference.
 */
export function buildFallbackInsights(
  answers: Record<string, RelationshipAnswer>,
  labels: Record<string, string>,
  ctx: Pick<ParseContext, "idByKey" | "missing">,
): InsightsPayload {
  const sections: InsightSection[] = FALLBACK_MAP.map(({ section, keys }) => ({
    key: section,
    label: SECTION_LABELS[section],
    items: keys
      .filter((k) => answers[k] && !answers[k]!.skipped_by_user && String(answers[k]!.raw_text ?? "").trim())
      .map((k) => ({
        text: `${labels[k] ?? k}: ${String(answers[k]!.raw_text).trim().slice(0, 300)}`,
        certainty: "explicit_fact" as Certainty,
        evidence_keys: [k],
        evidence_answer_ids: ctx.idByKey[k] ? [ctx.idByKey[k]!] : [],
      })),
  }));
  const answered = answeredKeys(answers);
  const section_confidence: Partial<Record<InsightSectionKey, number>> = {};
  for (const s of sections) section_confidence[s.key] = evidenceConfidence(s);
  return {
    summary_he:
      answered.length > 0
        ? `סיכום דטרמיניסטי מתוך תשובות מפורשות בלבד (${answered.length} תשובות). לא בוצעה פרשנות אוטומטית בשלב זה — ניתן לנסות לרענן את התובנות.`
        : "אין עדיין תשובות בשאלון הזוגיות, ולכן לא ניתן להפיק תובנות.",
    sections,
    contradictions: [],
    missing_info: ctx.missing.slice(0, 30),
    matching_tags: [],
    confidence: overallConfidence(sections),
    section_confidence,
  };
}

// ---------------------------------------------------------------- prompt

export const INSIGHTS_SYSTEM_PROMPT = `אתה שכבת ניתוח פנימית של מערכת CRM ישראלית. אתה מפיק פרופיל התנהגותי/זוגי פנימי לצוות בלבד, על בסיס שאלון זוגיות שהלקוח/ה מילא/ה.
חוקים מוחלטים:
1. אין אבחון. אין מונחים קליניים, אין תוויות אישיות או בריאות נפש, אין הסקות רגישות שאינן נתמכות בטקסט.
2. אין ציון "שווי" או "ראוי", ואין המלצה לפסול אדם.
3. כל פריט חייב סיווג certainty: explicit_fact (נאמר במפורש), supported_hypothesis (נשען על ציטוט ברור), unknown (אין מספיק מידע).
4. אם אין ראיה מספקת — כתוב unknown. אל תמציא.
5. evidence_keys חייבים להיות מפתחות שאלות שקיימים ברשימת התשובות שסופקה בלבד.
6. הכל בעברית, תמציתי, מקצועי ולא שיפוטי. תגיות התאמה הן עזר בלבד ולא החלטה.
החזר JSON בלבד במבנה:
{"summary_he":string,"sections":[{"key":string,"items":[{"text":string,"certainty":"explicit_fact"|"supported_hypothesis"|"unknown","evidence_keys":[string]}]}],"contradictions":[{"text":string,"certainty":string,"evidence_keys":[string]}],"matching_tags":[{"tag":string,"certainty":string,"evidence_keys":[string]}],"confidence":0-100,"section_confidence":{}}
sections keys חייבים להיות בדיוק: ${INSIGHT_SECTION_KEYS.join(", ")}.`;

export function buildInsightsUserPrompt(
  answers: Record<string, RelationshipAnswer>,
  labels: Record<string, string>,
  missing: Array<{ question_key: string; question: string }>,
): string {
  const lines = answeredKeys(answers).map(
    (k) => `- ${k} (${labels[k] ?? k}): ${String(answers[k]!.raw_text).trim().slice(0, 600)}`,
  );
  const skipped = Object.keys(answers).filter((k) => answers[k]!.skipped_by_user).sort();
  return [
    "תשובות השאלון (המקור היחיד המותר):",
    lines.length ? lines.join("\n") : "(אין תשובות)",
    skipped.length ? `שאלות שהלקוח/ה דילג/ה עליהן: ${skipped.join(", ")}` : "",
    missing.length ? `שאלות שטרם נענו: ${missing.map((m) => m.question_key).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}