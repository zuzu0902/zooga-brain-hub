/**
 * Intake Workflow V1 — stateful, deterministic intake layer.
 *
 * Runs every turn in parallel with memory / offer / handoff. Never replaces
 * an answer — only adds at most one soft intake nudge after the answer.
 */

export type IntakeFieldKey =
  | "first_name"
  | "age_or_birth_date"
  | "city_or_region"
  | "social_or_relationship_goal"
  | "preferred_activity_type"
  | "budget_sensitivity_or_range"
  | "language_style_preference"
  | "source_attribution";

export const INTAKE_REQUIRED_FIELDS: IntakeFieldKey[] = [
  "first_name",
  "age_or_birth_date",
  "city_or_region",
  "social_or_relationship_goal",
  "preferred_activity_type",
  "budget_sensitivity_or_range",
  "language_style_preference",
  "source_attribution",
];

export const INTAKE_FIELD_STAGE: Record<IntakeFieldKey, IntakeStage> = {
  first_name: "identity",
  source_attribution: "identity",
  age_or_birth_date: "demographic",
  city_or_region: "demographic",
  social_or_relationship_goal: "preferences",
  preferred_activity_type: "preferences",
  budget_sensitivity_or_range: "qualification",
  language_style_preference: "qualification",
};

export type IntakeStage =
  | "identity"
  | "demographic"
  | "preferences"
  | "qualification"
  | "completed";

export type IntakeState =
  | "not_started"
  | "active"
  | "paused"
  | "completed"
  | "blocked"
  | "handoff";

export type IntakeSnapshot = {
  state: IntakeState;
  stage: IntakeStage;
  completed: IntakeFieldKey[];
  missing: IntakeFieldKey[];
  completion_score: number;
  required: IntakeFieldKey[];
};

function fieldSatisfied(contact: any, key: IntakeFieldKey): boolean {
  if (!contact) return false;
  const ack = Array.isArray(contact.intake_completed_fields)
    ? (contact.intake_completed_fields as string[])
    : [];
  if (ack.includes(key)) return true;
  switch (key) {
    case "first_name":
      return !!(contact.first_name || contact.full_name);
    case "age_or_birth_date":
      return !!(contact.birth_date || contact.age || contact.age_range);
    case "city_or_region":
      return !!(contact.city || contact.region);
    case "social_or_relationship_goal":
      return !!(
        (Array.isArray(contact.social_goals) && contact.social_goals.length) ||
        (Array.isArray(contact.relationship_goals) && contact.relationship_goals.length) ||
        contact.relationship_status
      );
    case "preferred_activity_type":
      return !!(
        (Array.isArray(contact.favorite_activity_types) && contact.favorite_activity_types.length) ||
        (Array.isArray(contact.preferred_events) && contact.preferred_events.length) ||
        (Array.isArray(contact.interests) && contact.interests.length)
      );
    case "budget_sensitivity_or_range":
      return !!(contact.budget_sensitivity || contact.price_sensitivity || contact.income_range);
    case "language_style_preference":
      return !!contact.preferred_language_style;
    case "source_attribution":
      return !!(contact.source || contact.acquisition_source || contact.campaign_source || contact.first_touch_campaign_id);
  }
}

export function computeIntakeSnapshot(contact: any): IntakeSnapshot {
  const completed: IntakeFieldKey[] = [];
  const missing: IntakeFieldKey[] = [];
  for (const key of INTAKE_REQUIRED_FIELDS) {
    if (fieldSatisfied(contact, key)) completed.push(key);
    else missing.push(key);
  }
  const score = Math.round((completed.length / INTAKE_REQUIRED_FIELDS.length) * 100);
  const nextMissing = missing[0];
  const stage: IntakeStage = nextMissing ? INTAKE_FIELD_STAGE[nextMissing] : "completed";
  let state: IntakeState = "active";
  if (!contact) state = "not_started";
  else if (!missing.length) state = "completed";
  else if (completed.length === 0 && !contact.intake_last_question_at) state = "not_started";
  return {
    state,
    stage,
    completed,
    missing,
    completion_score: score,
    required: INTAKE_REQUIRED_FIELDS,
  };
}

export function selectNextIntakeField(
  snapshot: IntakeSnapshot,
  opts: {
    lastAskedKey?: string | null;
    lastAskedAt?: string | null;
    lastInboundLooksLikeAnswer?: boolean;
    mode: string;
  },
): IntakeFieldKey | null {
  if (snapshot.state === "completed" || !snapshot.missing.length) return null;
  // Never produce a new question during handoff turns; state still updates.
  if (opts.mode === "handoff") return null;

  // Skip source_attribution — captured silently, never asked aloud.
  const askable = snapshot.missing.filter((k) => k !== "source_attribution");
  if (!askable.length) return null;

  const top = askable[0];
  // If we asked this same field last turn and the user ignored it, defer 1 turn.
  if (
    opts.lastAskedKey === top &&
    opts.lastInboundLooksLikeAnswer === false &&
    askable.length > 1
  ) {
    return askable[1];
  }
  return top;
}

const INTAKE_FIELD_PROMPT: Record<IntakeFieldKey, string> = {
  first_name: "ask gently for their preferred first name (Hebrew, one short sentence)",
  age_or_birth_date: "ask roughly which decade / age range they're in (Hebrew, casual, no exact birthdate pressure)",
  city_or_region: "ask which area or city they're based in (Hebrew, casual)",
  social_or_relationship_goal: "ask what they're hoping to find socially / relationally (Hebrew, warm, non-judgmental)",
  preferred_activity_type: "ask what kinds of activities they most enjoy (Hebrew, casual)",
  budget_sensitivity_or_range: "ask softly about their comfort range for spending on these activities (Hebrew, never pushy)",
  language_style_preference: "ask how they prefer to be addressed (formal / casual, gender form) — Hebrew, one short sentence",
  source_attribution: "",
};

export function composeIntakeDirective(nextField: IntakeFieldKey | null): string | null {
  if (!nextField) return null;
  const instruction = INTAKE_FIELD_PROMPT[nextField];
  if (!instruction) return null;
  return [
    `MANDATORY intake target this turn: ${nextField}.`,
    `You MUST include ONE short, natural question in this reply to ${instruction}.`,
    `Placement: AFTER you answer the user's actual question / topic (offer, support, etc.), in the same reply. Do NOT skip it just because the offer answer feels complete.`,
    `Hard rules: (a) never replace the user-facing answer with the intake question, (b) never stack multiple intake questions in one reply, (c) skip ONLY if the user already implicitly answered this field in the current message, (d) do not defer with "later" / "בהמשך" — ask it now.`,
  ].join(" ");
}

// --- Deterministic extractor ---

type Capture = {
  field: IntakeFieldKey;
  value: string;
  confidence: number; // 0-100
  columnUpdates: Record<string, any>;
};

const HEBREW_CITIES = [
  "תל אביב","תל-אביב","ירושלים","חיפה","באר שבע","ראשון לציון","פתח תקווה","אשדוד","נתניה",
  "רמת גן","הרצליה","רעננה","כפר סבא","חולון","בת ים","אילת","מודיעין","רחובות","חדרה","עפולה",
  "טבריה","נצרת","קריות","קריית גת","אשקלון","לוד","רמלה","גבעתיים","ראש העין","קיסריה",
];

const NAME_PATTERNS: RegExp[] = [
  /קוראים\s+לי\s+([\u0590-\u05FFA-Za-z]{2,20})/,
  /השם\s+שלי\s+([\u0590-\u05FFA-Za-z]{2,20})/,
  /אני\s+([\u0590-\u05FFA-Za-z]{2,20})\b/,
  /\bmy name is\s+([A-Za-z]{2,20})/i,
  /\bi['’]?m\s+([A-Za-z]{2,20})\b/i,
];

function extractFirstName(text: string): Capture | null {
  for (const re of NAME_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) {
      const val = m[1].trim();
      if (val.length < 2) continue;
      // Avoid common Hebrew filler captured by "אני X"
      if (/^(לא|כן|רוצה|מחפש|מחפשת|חושב|חושבת|פנוי|פנויה|רווק|רווקה|נשוי|נשואה|גרוש|גרושה)$/.test(val))
        continue;
      return {
        field: "first_name",
        value: val,
        confidence: 85,
        columnUpdates: { first_name: val },
      };
    }
  }
  return null;
}

function extractAgeOrBirth(text: string): Capture | null {
  const ageRange = text.match(/בן\s+(\d{2})|בת\s+(\d{2})|גיל\s+(\d{2})|\b(\d{2})\s*שנים?\b|\bage\s+(\d{2})\b|\bi['’]?m\s+(\d{2})\b/i);
  if (ageRange) {
    const n = Number(ageRange.slice(1).find((x) => x));
    if (n >= 16 && n <= 95) {
      return {
        field: "age_or_birth_date",
        value: String(n),
        confidence: 85,
        columnUpdates: { age: n },
      };
    }
  }
  const decade = text.match(/בשנות\s+ה(20|30|40|50|60|70)|\b(20|30|40|50|60|70)['s]?\b/);
  if (decade) {
    const d = decade[1] ?? decade[2];
    return {
      field: "age_or_birth_date",
      value: `${d}s`,
      confidence: 75,
      columnUpdates: { age_range: `${d}s` },
    };
  }
  return null;
}

function extractCityOrRegion(text: string): Capture | null {
  for (const city of HEBREW_CITIES) {
    if (text.includes(city)) {
      return {
        field: "city_or_region",
        value: city,
        confidence: 90,
        columnUpdates: { city },
      };
    }
  }
  const regionMatch = text.match(/(מרכז|צפון|דרום|שרון|שפלה|גליל|נגב|ירושלים והסביבה)/);
  if (regionMatch) {
    return {
      field: "city_or_region",
      value: regionMatch[1],
      confidence: 80,
      columnUpdates: { region: regionMatch[1] },
    };
  }
  return null;
}

function extractLanguageStyle(text: string): Capture | null {
  if (/בגוף ראשון|תדברי אלי(י)?\s+ב(לשון )?זכר|אני גבר|זכר/i.test(text)) {
    return {
      field: "language_style_preference",
      value: "male_casual",
      confidence: 80,
      columnUpdates: { preferred_language_style: "male_casual" },
    };
  }
  if (/אני אישה|נקבה|תפני אלי(י)?\s+ב(לשון )?נקבה/i.test(text)) {
    return {
      field: "language_style_preference",
      value: "female_casual",
      confidence: 80,
      columnUpdates: { preferred_language_style: "female_casual" },
    };
  }
  return null;
}

function extractBudget(text: string): Capture | null {
  if (/(לא יקר|זול|תקציב נמוך|חסכוני|cheap|budget)/i.test(text)) {
    return {
      field: "budget_sensitivity_or_range",
      value: "low",
      confidence: 75,
      columnUpdates: { budget_sensitivity: "low" },
    };
  }
  if (/(לא משנה הכסף|לא משנה המחיר|פרימיום|יוקרתי|vip|premium|luxury)/i.test(text)) {
    return {
      field: "budget_sensitivity_or_range",
      value: "high",
      confidence: 80,
      columnUpdates: { budget_sensitivity: "high" },
    };
  }
  return null;
}

const ACTIVITY_KEYWORDS: Array<[RegExp, string]> = [
  [/(טיול|טיולים|טבע|הליכה|trek|hike)/i, "outdoor"],
  [/(מסיבה|מסיבות|חיי לילה|בר|club|party|nightlife)/i, "nightlife"],
  [/(סדנה|סדנאות|workshop|לימוד)/i, "workshops"],
  [/(אוכל|מסעדה|טעימות|food|culinary)/i, "culinary"],
  [/(תרבות|הצגה|תיאטרון|מוזיאון|culture|theatre|museum)/i, "culture"],
];

function extractActivity(text: string): Capture | null {
  const tags: string[] = [];
  for (const [re, tag] of ACTIVITY_KEYWORDS) {
    if (re.test(text)) tags.push(tag);
  }
  if (!tags.length) return null;
  return {
    field: "preferred_activity_type",
    value: tags.join(","),
    confidence: 70,
    columnUpdates: { favorite_activity_types: tags },
  };
}

const GOAL_PATTERNS: Array<[RegExp, string]> = [
  [/(זוגיות|בן זוג|בת זוג|partner|relationship)/i, "relationship"],
  [/(חברים|חברה חדשה|להכיר אנשים|friendship|meet people)/i, "friendship"],
  [/(קהילה|לחלק חוויות|להשתייך|community|belong)/i, "community"],
  [/(להתפתח|לצמוח|רוחני|growth|spiritual)/i, "growth"],
];

function extractSocialGoal(text: string): Capture | null {
  for (const [re, tag] of GOAL_PATTERNS) {
    if (re.test(text)) {
      return {
        field: "social_or_relationship_goal",
        value: tag,
        confidence: 75,
        columnUpdates: { social_goals: [tag] },
      };
    }
  }
  return null;
}

export function extractIntakeCaptures(inbound: string, contact: any): Capture[] {
  const text = String(inbound ?? "").trim();
  if (!text) return [];
  const out: Capture[] = [];
  const tryFns = [
    extractFirstName,
    extractAgeOrBirth,
    extractCityOrRegion,
    extractLanguageStyle,
    extractBudget,
    extractActivity,
    extractSocialGoal,
  ];
  for (const fn of tryFns) {
    const cap = fn(text);
    if (cap && !fieldSatisfied(contact, cap.field)) out.push(cap);
  }
  return out;
}

/**
 * Heuristic: did the inbound message look like an answer to a specific intake
 * field we asked last turn? Used to decide whether to defer the same question.
 */
export function inboundAnswersField(inbound: string, fieldKey: string | null | undefined): boolean {
  if (!fieldKey || !inbound) return false;
  const txt = inbound.trim();
  switch (fieldKey) {
    case "first_name":
      return NAME_PATTERNS.some((re) => re.test(txt)) || /^[\u0590-\u05FFA-Za-z]{2,20}$/.test(txt);
    case "age_or_birth_date":
      return /\b\d{2}\b|בן|בת|גיל|שנות/.test(txt);
    case "city_or_region":
      return HEBREW_CITIES.some((c) => txt.includes(c)) || /(מרכז|צפון|דרום|שרון|שפלה|גליל|נגב)/.test(txt);
    case "language_style_preference":
      return /זכר|נקבה|גבר|אישה|פורמלי|קליל/.test(txt);
    case "budget_sensitivity_or_range":
      return /(זול|יקר|תקציב|פרימיום|חסכוני)/.test(txt);
    case "preferred_activity_type":
      return ACTIVITY_KEYWORDS.some(([re]) => re.test(txt));
    case "social_or_relationship_goal":
      return GOAL_PATTERNS.some(([re]) => re.test(txt));
    default:
      return false;
  }
}
