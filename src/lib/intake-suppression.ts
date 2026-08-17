/**
 * INTAKE SUPPRESSION (PURE).
 *
 * A direct/sales question is answered FIRST. Intake only continues when it is
 * relevant to the current topic, and a question that was declined, already
 * answered, or is not relevant to the topic is suppressed on EVERY route.
 */
export type Topic = "trip" | "cancellation" | "accessibility" | "sales" | "general";

const TOPIC_RE: Array<[Topic, RegExp]> = [
  ["cancellation", /(ביטול|לבטל|החזר\s*כספי|refund|cancel)/i],
  ["accessibility", /(נגישות|כסא\s*גלגלים|קושי\s*בהליכה|כאבי\s*רגליים|בעיות\s*גב|מוגבלות)/i],
  ["trip", /(טיול|טיסה|יעד|חופשה|מלון|נסיעה|trip|flight)/i],
  ["sales", /(מחיר|כמה\s*עולה|תשלום|הנחה|להזמין|מקומות|price|book)/i],
];

export function detectTopic(text: string | null | undefined): Topic {
  const t = String(text ?? "");
  for (const [topic, re] of TOPIC_RE) if (re.test(t)) return topic;
  return "general";
}

/** Relationship/personal intake never rides along with these topics. */
export const RELATIONSHIP_QUESTION_KEYS = [
  "relationship_status",
  "looking_for_relationship",
  "partner",
  "dating",
];

const OFF_LIMIT_TOPICS: Topic[] = ["trip", "cancellation", "accessibility"];

export type SuppressionInput = {
  questionKey: string | null;
  topic: Topic;
  declinedKeys?: string[];
  answeredKeys?: string[];
  /** the inbound is a direct question / sales question */
  directQuestion?: boolean;
};

export type SuppressionResult = { ask: boolean; reason: string };

export function shouldAskIntakeQuestion(input: SuppressionInput): SuppressionResult {
  if (!input.questionKey) return { ask: false, reason: "no_question" };
  if (input.declinedKeys?.includes(input.questionKey)) return { ask: false, reason: "question_declined" };
  if (input.answeredKeys?.includes(input.questionKey)) return { ask: false, reason: "question_answered" };
  if (input.directQuestion) return { ask: false, reason: "answer_direct_question_first" };
  if (
    RELATIONSHIP_QUESTION_KEYS.includes(input.questionKey) &&
    OFF_LIMIT_TOPICS.includes(input.topic)
  ) {
    return { ask: false, reason: `not_relevant_to_topic:${input.topic}` };
  }
  return { ask: true, reason: "relevant" };
}