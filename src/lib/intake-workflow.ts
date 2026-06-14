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
  "social_or_relationship_goal",
  "preferred_activity_type",
  "city_or_region",
  "age_or_birth_date",
  "source_attribution",
  // Budget intentionally last and deferred. See selectNextIntakeField:
  // it is only asked once everything else is satisfied OR the mode signals
  // active qualification / offer engagement. Never an early-funnel question.
  "budget_sensitivity_or_range",
  // language_style_preference is intentionally LAST and is treated as
  // inferred-only by default. selectNextIntakeField skips it unless every
  // other askable field is already satisfied. It is still captured silently
  // when the inbound makes it obvious.
  "language_style_preference",
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
      return !!(
        contact.birth_date ||
        contact.age ||
        contact.age_range ||
        (contact.birthday_day && contact.birthday_month)
      );
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
  // Skip language_style_preference too — inferred passively from the inbound;
  // asking it explicitly reads as a low-value administrative form question.
  let askable = snapshot.missing.filter(
    (k) => k !== "source_attribution" && k !== "language_style_preference",
  );
  if (!askable.length) return null;

  // Budget is DEFERRED. Only surface it when:
  //  (a) the conversation is in an offer/qualification mode where price
  //      framing actually helps, OR
  //  (b) every other askable field is already satisfied.
  // This prevents the early-funnel "what's your budget?" pressure that made
  // conversations feel forced before any rapport was built.
  const budgetModesOk = new Set([
    "offer_qualification",
    "qualification",
    "objection_handling",
    "closing",
    "handoff_followup",
  ]);
  const budgetAllowedByMode = budgetModesOk.has(opts.mode);
  const onlyBudgetLeft = askable.length === 1 && askable[0] === "budget_sensitivity_or_range";
  // B1 — deterministic budget gate. Budget is NEVER asked on opener/browse/
  // generic_intake turns just because nothing else is left to ask. If the
  // current mode doesn't permit budget framing, we suppress it even when it
  // is the only remaining askable field. The directive layer must return
  // null so the turn doesn't re-pin intake_last_question_key=budget.
  if (!budgetAllowedByMode) {
    askable = askable.filter((k) => k !== "budget_sensitivity_or_range");
    if (!askable.length) return null;
  }

  // Birth date is also deferred. It is a relationship-trigger field, not a
  // qualification field — pushing it early (especially after we already have
  // meaningful context) makes the conversation feel like a form. Only ask it
  // when (a) every other non-deferred askable field is satisfied, OR
  // (b) the user's current turn is clearly idle small-talk where no higher
  //     priority field is missing. In all other cases prefer the next field.
  const onlyBirthLeft = askable.length === 1 && askable[0] === "age_or_birth_date";
  if (!onlyBirthLeft) {
    const withoutBirth = askable.filter((k) => k !== "age_or_birth_date");
    if (withoutBirth.length) askable = withoutBirth;
  }

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
  // Warm, value-laden framings — never form-like. One short sentence in Hebrew.
  first_name:
    "ask warmly for their first name. Use phrasing like \"אגב, איך קוראים לך?\" or \"ואם נעים, איך לקרוא לך?\" — never \"מה השם שלך?\".",
  age_or_birth_date:
    "ask for their BIRTH DATE (not just age) with a relationship-trigger framing — explain we sometimes prepare a small surprise or send a personal note around their birthday. Example: \"אם בא לך, אפשר לשתף גם תאריך לידה — לפעמים אנחנו מכינים משהו קטן סביב יום ההולדת 🙂\". DD/MM or DD/MM/YYYY is fine. Never dry / form-like.",
  city_or_region:
    "ask which area/city they're in, framed as \"כדי להבין מה יכול להיות לך נגיש ונוח\" — not as a bare \"איפה את/ה גר/ה?\".",
  social_or_relationship_goal:
    "ask what they're hoping to find — connection, friendship, partnership, community, experience — warmly, non-judgmental. Example: \"מה בדרך כלל יותר מושך אותך — חוויה חברתית, טיול, משהו זוגי, או פשוט להכיר אנשים טובים?\"",
  preferred_activity_type:
    "ask which style speaks to them most — \"איזה סגנון הכי מדבר אליך בדרך כלל — טיולים, אירועים חברתיים, משהו רגוע יותר?\". Casual, single sentence.",
  budget_sensitivity_or_range:
    "ask softly, only if relevant context exists. Example: \"כדי לכוון אותך נכון, את/ה מחפש/ת משהו יותר נגיש או שפתוח גם להשקעה קצת יותר גבוהה אם זה ממש שווה את זה?\". Never push price up front.",
  language_style_preference:
    "ask gently how they prefer to be addressed (זכר/נקבה, פורמלי/קליל) — one short sentence, only if it's not already obvious from prior turns.",
  source_attribution: "",
};

/**
 * Public helper: short Hebrew label per intake field, for CRM surfaces
 * (e.g. \"next question preview\" on the contact profile).
 */
export function intakeFieldFraming(field: IntakeFieldKey | null | undefined): string | null {
  if (!field) return null;
  return INTAKE_FIELD_PROMPT[field] || null;
}

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
  // Explicit birth date — DD/MM or DD/MM/YYYY (Hebrew users often write 17/4 or 17/04/1962).
  const dateMatch = text.match(/(?<!\d)(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?(?!\d)/);
  if (dateMatch) {
    const dd = Number(dateMatch[1]);
    const mm = Number(dateMatch[2]);
    let yyyy = dateMatch[3] ? Number(dateMatch[3]) : null;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      if (yyyy != null) {
        if (yyyy < 100) yyyy += yyyy >= 30 ? 1900 : 2000;
        if (yyyy >= 1900 && yyyy <= new Date().getFullYear() - 5) {
          const iso = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
          return {
            field: "age_or_birth_date",
            value: iso,
            confidence: 92,
            // birthday_day/month/year are GENERATED from birth_date — only
            // write birth_date itself.
            columnUpdates: { birth_date: iso },
          };
        }
      } else {
        // DD/MM only — year unknown, still eligible for birthday outreach.
        // Use 1900 as sentinel year so the generated birthday_day/month
        // columns are populated (badge + relationship triggers fire).
        const iso = `1900-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
        return {
          field: "age_or_birth_date",
          value: `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}`,
          confidence: 78,
          columnUpdates: { birth_date: iso },
        };
      }
    }
  }
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

const BARE_NAME_RE = /^[\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z'’\-]{1,19}$/;
const NAME_BLOCKLIST = new Set([
  "כן","לא","אוקיי","אוקי","בסדר","סבבה","תודה","שלום","היי","הי","בוקר","ערב","ביי","אולי","בטח","בהחלט",
  "yes","no","ok","okay","hi","hello","hey","thanks","thank","bye","sure","maybe",
]);

function extractBareFirstName(text: string): Capture | null {
  const t = text.trim();
  if (!BARE_NAME_RE.test(t)) return null;
  if (NAME_BLOCKLIST.has(t.toLowerCase())) return null;
  return {
    field: "first_name",
    value: t,
    confidence: 80,
    columnUpdates: { first_name: t },
  };
}

export function extractIntakeCaptures(
  inbound: string,
  contact: any,
  opts?: { lastAskedKey?: string | null },
): Capture[] {
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
  // Context-aware fallback: if we just asked for the first name and the user
  // replied with a bare token (e.g. "שושו"), accept it as the name.
  if (
    opts?.lastAskedKey === "first_name" &&
    !out.some((c) => c.field === "first_name") &&
    !fieldSatisfied(contact, "first_name")
  ) {
    const bare = extractBareFirstName(text);
    if (bare) out.push(bare);
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

/**
 * Map a field+value pair (produced by the LLM decision layer) into the
 * concrete contact column updates we persist. Keeps the LLM layer schema-light
 * while ensuring deterministic, auditable writes.
 */
export function fieldValueToColumnUpdates(
  field: IntakeFieldKey,
  value: string,
): Record<string, any> {
  const v = String(value ?? "").trim();
  if (!v) return {};
  switch (field) {
    case "first_name":
      return { first_name: v };
    case "age_or_birth_date": {
      // ISO birth date (YYYY-MM-DD)
      const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (iso) {
        const y = Number(iso[1]);
        const m = Number(iso[2]);
        const d = Number(iso[3]);
        return { birth_date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
      }
      // DD/MM/YYYY or DD-MM-YYYY (also DD.MM.YYYY)
      const dmy = v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
      if (dmy) {
        const d = Number(dmy[1]);
        const m = Number(dmy[2]);
        let y = Number(dmy[3]);
        if (y < 100) y += y >= 30 ? 1900 : 2000;
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
          return { birth_date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
        }
      }
      // DD/MM (no year) — also DD-MM, DD.MM
      const md = v.match(/^(\d{1,2})[\/.\-](\d{1,2})$/);
      if (md) {
        const d = Number(md[1]);
        const m = Number(md[2]);
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
          // Sentinel year 1900 — birthday_day/month are generated from
          // birth_date and we still need the day/month to fire triggers.
          return { birth_date: `1900-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
        }
      }
      const n = Number(v);
      if (Number.isFinite(n) && n >= 16 && n <= 95) return { age: n };
      if (/^\d{2}s$/.test(v)) return { age_range: v };
      return { age_range: v };
    }
    case "city_or_region": {
      if (HEBREW_CITIES.includes(v)) return { city: v };
      if (/^(מרכז|צפון|דרום|שרון|שפלה|גליל|נגב|ירושלים והסביבה)$/.test(v)) return { region: v };
      return { city: v };
    }
    case "social_or_relationship_goal":
      return { social_goals: [v] };
    case "preferred_activity_type":
      return { favorite_activity_types: v.split(",").map((s) => s.trim()).filter(Boolean) };
    case "budget_sensitivity_or_range":
      return { budget_sensitivity: v };
    case "language_style_preference":
      return { preferred_language_style: v };
    case "source_attribution":
      return {};
    default:
      return {};
  }
}
