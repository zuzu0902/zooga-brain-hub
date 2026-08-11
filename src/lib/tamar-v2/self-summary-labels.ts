/** Friendly Hebrew labels for questionnaire keys — internal keys are never
 *  shown to a customer. */
import { DEFAULT_RELATIONSHIP_QUESTIONS } from "@/lib/relationship-intake/questions";

export const RELATIONSHIP_LABELS: Record<string, string> = Object.fromEntries(
  DEFAULT_RELATIONSHIP_QUESTIONS.map((q) => [q.question_key, q.label]),
);