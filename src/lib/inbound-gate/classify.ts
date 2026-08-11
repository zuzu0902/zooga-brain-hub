/**
 * INBOUND CONTEXT GATE — pure classification layer (no I/O).
 *
 * EVERY inbound of Tamar — free text, button/list reply and voice transcript —
 * passes through this classifier exactly once per provider message id, before
 * baseline intake, relationship intake, the brain engine or a campaign reply
 * may act on it.
 *
 * The output is structured and deterministic; the model layer may only refine
 * a low-confidence verdict, never override the hard signals (opt-out, consent,
 * handoff) and never turn a non-answer into an answer.
 */
import { isOptInMessage, isOptOutMessage } from "@/lib/optout";
import { detectHandoffSignal, isUserQuestion } from "@/lib/tamar-brain/signals";
import { detectLoopSignal, isDontKnowAnswer, normalizeText } from "@/lib/conversation-guard/core";

export const INBOUND_KINDS = [
  "answer_current_question",
  "question",
  "confusion",
  "topic_shift",
  "refusal_or_skip",
  "smalltalk",
  "consent",
  "handoff",
  "opt_out",
  "multi_intent",
] as const;

export type InboundKind = (typeof INBOUND_KINDS)[number];

export type ResponsePriority =
  | "opt_out"
  | "handoff"
  | "consent"
  | "answer_user"
  | "clarify"
  | "advance_intake"
  | "smalltalk";

export type SourceType = "text" | "button" | "voice";

export type InboundClassification = {
  kind: InboundKind;
  /** every signal detected, in priority order (multi_intent lists >1) */
  kinds: InboundKind[];
  confidence: number;
  extracted_facts: Record<string, string>;
  /** may the questionnaire/intake state advance on this message? */
  should_advance: boolean;
  response_priority: ResponsePriority;
  /** true only when the text is a valid answer to the CURRENT question */
  answer_valid: boolean;
  validator_reason: string;
  source_type: SourceType;
  loop_signal: boolean;
  classifier_status: "ok" | "model_refined" | "model_failed";
};

// ------------------------------------------------------------- validators

const PURE_PUNCT_RE = /^[\s?？!.,\-–—…"'׳״]+$/;
const BARE_QUESTION_RE =
  /^(מה|מה\s*זה|מה\s*זאת\s*אומרת|למה|למה\s*\?|איך|מתי|איפה|כמה|האם|מי|מה\s*קורה|לא\s*הבנתי|לא\s*הבנתי\s*אותך|what|why|huh)\s*[?？]?$/;
const QUESTION_OPENER_RE =
  /^(מה|למה|איך|מתי|איפה|כמה|האם|מי|אילו|איזה|יש\s*לך|יש\s*לכם|אפשר|תוכלי|תוכל|אתם|האם\s*יש)\b/;

/** Fields that only accept a value containing digits. */
const NUMERIC_FIELDS = /(birth|age|גיל|date|year|phone|budget|count|kids|children|ילדים)/i;

/** Closed-vocabulary fields: only a recognised value is ever a valid answer. */
const ENUM_FIELDS: Array<{ match: RegExp; values: RegExp }> = [
  {
    match: /(marital|relationship_status|מצב\s*משפחתי)/i,
    values: /(רווק|רווקה|גרוש|גרושה|אלמן|אלמנה|נשוי|נשואה|פרוד|פרודה|בזוגיות|לא\s*נשוי|single|divorced|widow)/,
  },
  { match: /(^|_)gender($|_)|מגדר/i, values: /(גבר|אישה|זכר|נקבה|male|female|אחר)/ },
];

/** A greeting on its own is never an answer to a question. */
const GREETING_ONLY_RE =
  /^(היי|הי|שלום|אהלן|בוקר\s*טוב|ערב\s*טוב|צהריים\s*טובים|מה\s*נשמע|מה\s*קורה|hi|hello|hey|תודה|תודה\s*רבה|להתראות|ביי)[\s!.]*$/;

/** "אני רוצה לנסוע" — an intent statement, not an answer to an intake field. */
const INTENT_STATEMENT_RE =
  /(אני\s*רוצה|אני\s*מעוניינ|אני\s*מחפש|מעניין\s*אותי|אשמח\s*ל|בא\s*לי)/;

export type FieldValidation = { valid: boolean; reason: string };

/**
 * Semantic validator of a candidate answer for a specific field.
 * "?", "מה?", "למה", "מה זה", "יש לך עוד טיולים?" are NEVER answers.
 */
export function validateFieldAnswer(
  fieldKey: string | null | undefined,
  rawText: string | null | undefined,
): FieldValidation {
  const text = String(rawText ?? "").trim();
  const norm = normalizeText(text);
  if (!fieldKey) return { valid: false, reason: "no_current_question" };
  if (!text || PURE_PUNCT_RE.test(text)) return { valid: false, reason: "empty_or_punctuation" };
  if (BARE_QUESTION_RE.test(norm)) return { valid: false, reason: "bare_question_not_answer" };
  if (detectLoopSignal(text)) return { valid: false, reason: "loop_signal" };
  if (isDontKnowAnswer(text)) return { valid: false, reason: "dont_know_needs_help" };
  if (/[?？]/.test(text) && QUESTION_OPENER_RE.test(norm)) {
    return { valid: false, reason: "question_not_answer" };
  }
  if (isOptOutMessage(text) || detectHandoffSignal(text).handoff) {
    return { valid: false, reason: "control_intent_not_answer" };
  }
  if (NUMERIC_FIELDS.test(fieldKey) && !/\d/.test(text)) {
    return { valid: false, reason: "field_requires_number" };
  }
  if (GREETING_ONLY_RE.test(norm)) return { valid: false, reason: "greeting_not_answer" };
  for (const f of ENUM_FIELDS) {
    if (f.match.test(fieldKey) && !f.values.test(norm)) {
      return { valid: false, reason: "field_value_not_recognized" };
    }
  }
  if (INTENT_STATEMENT_RE.test(norm) && TOPIC_RE.test(norm)) {
    return { valid: false, reason: "intent_statement_not_answer" };
  }
  if (norm.replace(/\s+/g, "").length < 2) return { valid: false, reason: "too_short" };
  return { valid: true, reason: "ok" };
}

// ---------------------------------------------------------------- signals

const CONSENT_YES_RE = /^(כן|בטח|אשמח|מאשר(ת)?|בסדר|סבבה|אוקיי|אוקי|ok|yes|yep|מסכים(ה)?)\b/;
const CONSENT_NO_RE = /^(לא|לא\s*תודה|לא\s*מעוניין(ת)?|no|not\s*now)\b/;
const SKIP_RE = /(דלג|דלגי|לא\s*רוצה\s*לענות|נדלג|אחר\s*כך|לא\s*עכשיו|skip|פאס)/;
const SMALLTALK_RE =
  /^(היי|הי|שלום|בוקר\s*טוב|ערב\s*טוב|צהריים\s*טובים|מה\s*נשמע|מה\s*קורה|hi|hello|hey|תודה\s*רבה?|להתראות|ביי)\b/;
const CONFUSION_RE =
  /(לא\s*הבנתי|לא\s*ברור|מה\s*זאת\s*אומרת|מה\s*זה|לא\s*מבין|לא\s*מבינה|למה\s*את\s*שואלת|על\s*מה\s*את\s*מדברת)/;
const TOPIC_RE =
  /(טיול|טיולים|נסיעה|לנסוע|חופשה|הצעה|הצעות|מחיר|כמה\s*עולה|תאריך|יעד|אירוע|סדנה|מסיבה|אלבניה|וייטנאם|יוון|קפריסין|איטליה|trip|tour|price)/;

/** Facts that can safely be lifted out of ANY message, answer or not. */
export function extractInboundFacts(text: string): Record<string, string> {
  const facts: Record<string, string> = {};
  const t = String(text ?? "");
  const marital = t.match(/(גרוש[הא]?|אלמן(ה)?|רווק[הא]?|נשוי|נשואה|פרוד[הא]?)/);
  if (marital) facts["marital_status"] = marital[1]!;
  const city = t.match(/(?:גר|גרה|מ|גרים)\s*ב([\u0590-\u05FF]{2,20})/);
  if (city) facts["residence_city"] = city[1]!;
  const destination = t.match(/(אלבניה|וייטנאם|יוון|קפריסין|איטליה|גאורגיה|תאילנד|ספרד|פורטוגל)/);
  if (destination) facts["destination_interest"] = destination[1]!;
  if (/(חו"ל|חול\b|לחו"ל|לחול\b)/.test(t)) facts["travel_scope"] = "abroad";
  const age = t.match(/(?:^|\s)(\d{2})(?:\s|$)/);
  if (age && Number(age[1]) >= 18 && Number(age[1]) <= 99) facts["age_hint"] = age[1]!;
  return facts;
}

// ------------------------------------------------------------ classifier

export type ClassifyInput = {
  text: string;
  sourceType?: SourceType;
  optionId?: string | null;
  /** field key of the question Tamar asked last, if any */
  currentQuestionKey?: string | null;
  currentQuestionText?: string | null;
  consentPending?: boolean;
};

function priorityFor(kind: InboundKind): ResponsePriority {
  switch (kind) {
    case "opt_out":
      return "opt_out";
    case "handoff":
      return "handoff";
    case "consent":
      return "consent";
    case "question":
    case "topic_shift":
    case "multi_intent":
      return "answer_user";
    case "confusion":
      return "clarify";
    case "answer_current_question":
    case "refusal_or_skip":
      return "advance_intake";
    default:
      return "smalltalk";
  }
}

export function classifyInbound(input: ClassifyInput): InboundClassification {
  const text = String(input.text ?? "").trim();
  const norm = normalizeText(text);
  const sourceType: SourceType = input.sourceType ?? (input.optionId ? "button" : "text");
  const facts = extractInboundFacts(text);
  const loop = detectLoopSignal(text);
  const kinds: InboundKind[] = [];

  if (isOptOutMessage(text)) kinds.push("opt_out");
  if (detectHandoffSignal(text).handoff) kinds.push("handoff");
  if (
    input.consentPending &&
    (CONSENT_YES_RE.test(norm) || CONSENT_NO_RE.test(norm) || isOptInMessage(text) || sourceType === "button")
  ) {
    kinds.push("consent");
  }
  if (SKIP_RE.test(norm)) kinds.push("refusal_or_skip");
  if (CONFUSION_RE.test(norm) || PURE_PUNCT_RE.test(text) || BARE_QUESTION_RE.test(norm) || loop) {
    kinds.push("confusion");
  }
  const asksSomething = isUserQuestion(text) && !BARE_QUESTION_RE.test(norm);
  if (asksSomething) kinds.push("question");
  if (
    TOPIC_RE.test(norm) &&
    (asksSomething ||
      !input.currentQuestionKey ||
      !!facts["destination_interest"] ||
      INTENT_STATEMENT_RE.test(norm))
  ) {
    kinds.push("topic_shift");
  }

  const validation = validateFieldAnswer(input.currentQuestionKey ?? null, text);
  const controlKinds = kinds.filter((k) => k !== "topic_shift");
  if (validation.valid && !controlKinds.length) kinds.push("answer_current_question");
  if (!kinds.length && (SMALLTALK_RE.test(norm) || GREETING_ONLY_RE.test(text))) kinds.push("smalltalk");
  if (!kinds.length) kinds.push(input.currentQuestionKey ? "confusion" : "smalltalk");

  // A button reply to the current question is a first-class answer.
  if (sourceType === "button" && input.currentQuestionKey && !controlKinds.length) {
    if (!kinds.includes("answer_current_question")) kinds.unshift("answer_current_question");
  }

  const substantive = kinds.filter((k) => k !== "smalltalk");
  const multi = substantive.length > 1;
  const primary: InboundKind = multi ? "multi_intent" : (kinds[0] as InboundKind);

  const answerValid = kinds.includes("answer_current_question") && validation.valid && !multi;
  const shouldAdvance = answerValid || (kinds.includes("refusal_or_skip") && !kinds.includes("question"));

  const explicit = kinds.some((k) => ["opt_out", "handoff", "consent", "refusal_or_skip"].includes(k));
  const confidence = explicit ? 0.95 : answerValid ? 0.8 : multi ? 0.5 : asksSomething ? 0.75 : 0.45;

  return {
    kind: primary,
    kinds,
    confidence,
    extracted_facts: facts,
    should_advance: shouldAdvance,
    response_priority: priorityFor(multi ? (kinds[0] as InboundKind) : primary),
    answer_valid: answerValid,
    validator_reason: validation.reason,
    source_type: sourceType,
    loop_signal: loop,
    classifier_status: "ok",
  };
}

/** Safe verdict used when the classifier/LLM layer failed: never capture. */
export function failedClassification(sourceType: SourceType = "text"): InboundClassification {
  return {
    kind: "confusion",
    kinds: ["confusion"],
    confidence: 0,
    extracted_facts: {},
    should_advance: false,
    response_priority: "clarify",
    answer_valid: false,
    validator_reason: "classifier_failed",
    source_type: sourceType,
    loop_signal: false,
    classifier_status: "model_failed",
  };
}