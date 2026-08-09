/**
 * RELATIONSHIP QUESTIONNAIRE — pure logic (safe on client and server).
 *
 * Opens only when relationship_intake_status = ready_to_start. One question
 * per turn, free text only, warm short acknowledgment before the next
 * question. A human agent is NEVER offered here; the global handoff path
 * stays reserved for an explicit customer request.
 */

export type RelationshipQuestion = {
  question_key: string;
  label: string;
  question_text: string;
  order_index: number;
  active: boolean;
  skippable: boolean;
  required: boolean;
  is_final_question: boolean;
};

export type AnswerSource = "text" | "voice";

export type RelationshipAnswer = {
  question_key: string;
  raw_text: string | null;
  structured_value: Record<string, string | number | boolean | null>;
  source: AnswerSource;
  evidence_message_id: string | null;
  confidence: number | null;
  skipped_by_user: boolean;
  answered_at: string;
};

export type RelationshipSnapshot = {
  answers: Record<string, RelationshipAnswer>;
};

export const RELATIONSHIP_INTRO_TEXT =
  "מעולה, אשמח להכיר אותך קצת יותר. אשאל בכל פעם שאלה אחת, ואפשר לענות בחופשיות ובכמה מילים שנוח לך. אפשר לענות בכתיבה או בהודעה קולית — מה שנוח לך. אם יש שאלה שפחות נוח לענות עליה, אפשר לדלג ולהמשיך.";

export const RELATIONSHIP_COMPLETION_TEXT =
  "תודה ששיתפת אותי. הדברים שסיפרת עוזרים לי להכיר אותך טוב יותר, ובהמשך אוכל לעדכן אותך על היכרויות ואירועים שעשויים להתאים לך. תמיד אפשר לחזור אליי, להוסיף מידע או לתקן משהו.";

/** Sent when a voice note could not be transcribed. Human, never technical. */
export const VOICE_FAILED_TEXT =
  "לא הצלחתי לשמוע את ההודעה הקולית עד הסוף. אפשר לנסות להקליט שוב, או פשוט לכתוב לי — מה שנוח לך.";

const Q = (
  question_key: string,
  label: string,
  question_text: string,
  order_index: number,
  is_final_question = false,
): RelationshipQuestion => ({
  question_key,
  label,
  question_text,
  order_index,
  active: true,
  skippable: true,
  required: false,
  is_final_question,
});

/** The 18 approved questions plus the closing question, in default order. */
export const DEFAULT_RELATIONSHIP_QUESTIONS: RelationshipQuestion[] = [
  Q("relationship_status", "סטטוס זוגי", "מה הסטטוס הזוגי שלך כיום? לדוגמה: רווקות, גירושין, אלמנות, זוגיות או מצב אחר.", 10),
  Q("last_relationship", "מערכת היחסים האחרונה", "כמה זמן נמשכה מערכת היחסים המשמעותית האחרונה שלך, ומתי היא הסתיימה?", 20),
  Q("readiness_feeling", "תחושה לגבי קשר חדש", "איך מרגיש לך היום להיכנס למערכת יחסים חדשה?", 30),
  Q("desired_relationship_type", "סוג הקשר הרצוי", "איזה סוג של מערכת יחסים היית רוצה לבנות בתקופה הזו?", 40),
  Q("desired_partner_gender", "את מי להכיר", "את מי היית רוצה להכיר? אפשר לציין מגדר או כל העדפה אחרת שרלוונטית עבורך.", 50),
  Q("age_range", "טווח גילאים", "באיזה טווח גילאים היית רוצה להכיר?", 60),
  Q("geography", "אזורים וגמישות", "באילו אזורים בארץ מתאים לך להכיר, ועד כמה יש מבחינתך גמישות גיאוגרפית?", 70),
  Q("important_traits", "תכונות וערכים חשובים", "אילו תכונות וערכים חשוב לך למצוא באדם שאיתו תיבנה מערכת יחסים?", 80),
  Q("dealbreakers", "דברים להימנע מהם", "האם יש תכונות, הרגלים או פערים שחשוב לך להימנע מהם בקשר?", 90),
  Q("height", "גובה", "מה הגובה שלך?", 100),
  Q("education", "השכלה", "מהי רמת ההשכלה שלך, ובאילו תחומים למדת?", 110),
  Q("children", "ילדים", "האם יש לך ילדים? אם כן, כמה ובאילו גילאים — רק אם נוח לך לשתף.", 120),
  Q("occupation", "מקצוע ותעסוקה", "מה המקצוע שלך ובאיזה תחום נמצאת העבודה שלך כיום?", 130),
  Q("lifestyle", "אורח חיים", "איך נראה אורח החיים שלך ביום־יום, ומה אוהבים לעשות בזמן הפנוי?", 140),
  Q("religiosity", "אורח חיים בקשר", "האם יש אורח חיים מסוים שחשוב לך בקשר, למשל חילוני, מסורתי, דתי או משהו אחר?", 150),
  Q("habits_preferences", "העדפות והרגלים", "האם יש העדפות חשובות בנוגע לעישון, תזונה, בעלי חיים או הרגלי חיים אחרים?", 160),
  Q("future_plans", "נישואין ומגורים", "עד כמה חשובים לך נישואין, מגורים משותפים או ילדים בעתיד?", 170),
  Q("relationship_values", "מה עושה קשר טוב", "מה לדעתך הופך מערכת יחסים למערכת יחסים טובה ומצליחה?", 180),
  Q("anything_else", "משהו נוסף", "האם יש עוד משהו שהיית רוצה לספר על עצמך, על האדם שהיית רוצה להכיר או על הציפיות שלך ממערכת יחסים וזוגיות?", 190, true),
];

export function sortedQuestions(questions: RelationshipQuestion[]): RelationshipQuestion[] {
  return questions.filter((q) => q.active).sort((a, b) => a.order_index - b.order_index);
}

/** Answered or explicitly skipped — either way, never asked again. */
export function isResolved(snap: RelationshipSnapshot, key: string): boolean {
  const a = snap.answers[key];
  if (!a) return false;
  return a.skipped_by_user || !!String(a.raw_text ?? "").trim() || Object.keys(a.structured_value ?? {}).length > 0;
}

/** The next unanswered question, or null when the questionnaire is done. */
export function nextRelationshipQuestion(
  questions: RelationshipQuestion[],
  snap: RelationshipSnapshot,
): RelationshipQuestion | null {
  for (const q of sortedQuestions(questions)) if (!isResolved(snap, q.question_key)) return q;
  return null;
}

export function relationshipProgress(questions: RelationshipQuestion[], snap: RelationshipSnapshot) {
  const active = sortedQuestions(questions);
  const answered = active.filter((q) => {
    const a = snap.answers[q.question_key];
    return !!a && !a.skipped_by_user;
  });
  const skipped = active.filter((q) => snap.answers[q.question_key]?.skipped_by_user);
  const missing = active.filter((q) => !isResolved(snap, q.question_key));
  return {
    total: active.length,
    answered: answered.map((q) => q.question_key),
    skipped: skipped.map((q) => q.question_key),
    missing: missing.map((q) => q.question_key),
    percent: active.length
      ? Math.round(((answered.length + skipped.length) / active.length) * 100)
      : 100,
  };
}

// ------------------------------------------------------------------ skip

const SKIP_RE =
  /(דלג|לדלג|לא רוצה לענות|מעדיף לא|מעדיפה לא|מעדיפ\/ה לא|לא רוצה לשתף|לא נוח לי לענות|לא נוח לענות|skip|pass)/i;

export function isSkipRequest(text: string): boolean {
  return SKIP_RE.test(String(text ?? "").trim());
}

// -------------------------------------------------------- acknowledgment

const ACK: Record<string, string> = {
  relationship_status: "תודה ששיתפת.",
  last_relationship: "תודה, זה עוזר לי להבין את התקופה שבה את/ה נמצא/ת.",
  readiness_feeling: "מובן לגמרי, תודה על הכנות.",
  desired_relationship_type: "יפה, זה מבהיר לי הרבה.",
  desired_partner_gender: "רשמתי לפניי, תודה.",
  age_range: "מצוין, תודה.",
  geography: "תודה, זה עוזר לי להתאים גיאוגרפית.",
  important_traits: "תודה, אלה דברים חשובים.",
  dealbreakers: "ברור, טוב שאמרת.",
  height: "תודה.",
  education: "תודה ששיתפת.",
  children: "תודה, נעים לדעת.",
  occupation: "מעניין, תודה.",
  lifestyle: "נשמע נעים, תודה ששיתפת.",
  religiosity: "תודה, חשוב לי לדעת את זה.",
  habits_preferences: "תודה, רשמתי.",
  future_plans: "תודה, זה עוזר לי מאוד.",
  relationship_values: "יפה מאוד, תודה.",
  anything_else: "תודה ששיתפת אותי.",
};

const SKIP_ACK = "אין בעיה, נדלג על זה.";

/** Short, warm, never repeats the answer back and never sounds like a form. */
export function acknowledgment(questionKey: string, opts: { skipped?: boolean } = {}): string {
  if (opts.skipped) return SKIP_ACK;
  return ACK[questionKey] ?? "תודה ששיתפת.";
}

/** Acknowledgment + next question, as one natural message. */
export function composeTurnText(ack: string | null, question: string): string {
  return ack ? `${ack}\n${question}` : question;
}

// ------------------------------------------------ deterministic extraction

export type ExtractedValue = {
  value: string;
  confidence: number;
  evidence: string;
};

const REGIONS = [
  "תל אביב", "ירושלים", "חיפה", "באר שבע", "ראשון לציון", "נתניה", "פתח תקווה", "אשדוד",
  "רעננה", "הרצליה", "מודיעין", "אילת", "רמת גן", "גבעתיים", "כפר סבא", "רחובות",
  "השרון", "הצפון", "הדרום", "המרכז", "השפלה",
];

/**
 * Extracts every field that was CLEARLY stated in one message, so a single
 * answer can resolve several questions. Nothing sensitive is guessed: every
 * value carries evidence and a confidence score.
 */
export function extractRelationshipFields(
  text: string,
  askedKey?: string | null,
): Record<string, ExtractedValue> {
  const out: Record<string, ExtractedValue> = {};
  const s = String(text ?? "").trim();
  if (!s) return out;
  const ev = s.slice(0, 240);
  const put = (k: string, value: string, confidence: number) => {
    if (!out[k]) out[k] = { value, confidence, evidence: ev };
  };

  const status = s.match(/(רווקה|רווק|גרושה|גרוש|אלמנה|אלמן|פרודה|פרוד|נשואה|נשוי|בזוגיות)/);
  if (status) put("relationship_status", status[1]!, 90);

  const height = s.match(/(\d\.\d{2})\s*(?:מטר|מ׳|m)?|(\d{3})\s*(?:ס"מ|ס״מ|סמ|cm)/);
  if (height) {
    const cm = height[1] ? Math.round(Number(height[1]) * 100) : Number(height[2]);
    if (cm >= 130 && cm <= 220) put("height", `${cm} ס״מ`, 90);
  }

  const range = s.match(/(\d{2})\s*(?:עד|-|–|עד גיל)\s*(\d{2})/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (a >= 18 && b <= 99 && a < b) put("age_range", `${a}-${b}`, 90);
  }

  if (/אין לי ילדים|בלי ילדים|לא ילדים/.test(s)) put("children", "אין ילדים", 85);
  else {
    const kids = s.match(/(?:יש לי\s+)?(\d)\s*ילדים/);
    if (kids) put("children", `${kids[1]} ילדים`, 85);
  }

  const rel = s.match(/(חילונית|חילוני|מסורתית|מסורתי|דתייה|דתית|דתי|חרדית|חרדי)/);
  if (rel) put("religiosity", rel[1]!, 85);

  const habits: string[] = [];
  if (/לא מעשן|לא מעשנת|בלי עישון/.test(s)) habits.push("לא מעשן/ת");
  else if (/מעשן|מעשנת/.test(s)) habits.push("מעשן/ת");
  if (/צמחוני|צמחונית/.test(s)) habits.push("צמחוני/ת");
  if (/טבעוני|טבעונית/.test(s)) habits.push("טבעוני/ת");
  if (/כלב|חתול|בעלי חיים/.test(s)) habits.push("בעלי חיים");
  if (habits.length) put("habits_preferences", habits.join(", "), 80);

  const edu = s.match(/(תואר ראשון|תואר שני|דוקטור|דוקטורט|הנדסאי|תיכונית|תיכון|אקדמאי|אקדמאית)/);
  if (edu) put("education", edu[1]!, 85);

  const region = REGIONS.find((r) => s.includes(r));
  if (region) put("geography", region, 80);

  // the answer to the question actually asked is stored as given, unless a
  // precise structured value was already extracted for that same field
  if (askedKey && s.length >= 2 && !out[askedKey]) {
    out[askedKey] = { value: s.slice(0, 1000), confidence: 95, evidence: ev };
  }
  return out;
}

// ------------------------------------------------------- follow-up rules

/** A follow-up is asked ONLY when a material detail is missing, never twice. */
export function needsFollowUp(questionKey: string, text: string): string | null {
  const s = String(text ?? "").trim();
  if (!s || s.length < 2) return null;
  if (questionKey === "age_range" && !/\d{2}/.test(s)) {
    return "ומה טווח הגילאים המדויק שמתאים לך, בערך?";
  }
  if (questionKey === "last_relationship" && !/(שנה|שנים|חודש|חודשים|\d)/.test(s)) {
    return "ומתי בערך הקשר הזה הסתיים?";
  }
  return null;
}

// ----------------------------------------------------- voice uncertainty

export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/**
 * An uncertain transcription is never turned into a structured value; Tamar
 * asks one focused confirmation question first.
 */
export function isUncertainTranscript(input: {
  transcript: string | null;
  confidence: number | null;
  source: AnswerSource;
}): boolean {
  if (input.source !== "voice") return false;
  const t = String(input.transcript ?? "").trim();
  if (!t) return true;
  if (t.length < 3) return true;
  if (/\[(?:inaudible|unclear|לא ברור)\]/i.test(t)) return true;
  if (input.confidence != null && input.confidence < LOW_CONFIDENCE_THRESHOLD) return true;
  return false;
}

export function buildConfirmationQuestion(summary: string): string {
  return `רק כדי לוודא שהבנתי נכון — ${String(summary).trim().replace(/[.?!]+$/, "")}?`;
}

// Hebrew letters are not \w, so \b cannot be used here.
const CONFIRM_YES = /^(כן נכון|נכון|בדיוק|אכן|כן|yes)(?![\p{L}])/u;
const CONFIRM_NO = /^(לא נכון|לא|טעות|no)(?![\p{L}])/u;

export function readConfirmationReply(text: string): "yes" | "no" | null {
  const s = String(text ?? "").trim();
  if (CONFIRM_YES.test(s)) return "yes";
  if (CONFIRM_NO.test(s)) return "no";
  return null;
}

// --------------------------------------------------------------- guards

/** The questionnaire never offers a human agent proactively. */
export function mentionsHumanAgent(text: string): boolean {
  return /(נציג|נציגה|מוקד|לדבר עם אדם|לדבר עם מישהו מהצוות|human agent)/.test(String(text ?? ""));
}