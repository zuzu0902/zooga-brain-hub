/**
 * INBOUND ROUTE POLICY — who may own an inbound turn, decided ONLY from the
 * Inbound Context Gate verdict. Pure, no I/O, shared by the webhook and tests.
 *
 * Rule of the house: a message that is a question / confusion / topic shift /
 * multi-intent is never consumed by an intake questionnaire. It skips
 * relationship_intake and baseline intake and reaches Tamar v2, which answers
 * the customer in context. Only a validated answer may save or advance.
 */
import type { InboundClassification, InboundKind } from "./classify";

/** Kinds that must be answered by the engine, never captured by an intake. */
export const ENGINE_OWNED_KINDS: InboundKind[] = [
  "question",
  "confusion",
  "topic_shift",
  "multi_intent",
];

export function isEngineOwned(cls: Pick<InboundClassification, "kind" | "kinds">): boolean {
  const kinds = cls.kinds?.length ? cls.kinds : [cls.kind];
  return kinds.some((k) => ENGINE_OWNED_KINDS.includes(k));
}

/**
 * May baseline intake own this turn at all (ask its question / apply its plan)?
 * Legacy heuristics stay as a belt-and-braces layer on top of the gate.
 */
export function baselineMayOwnTurn(args: {
  cls: Pick<InboundClassification, "kind" | "kinds">;
  looksLikeQuestion: boolean;
  loopSignal: boolean;
}): boolean {
  if (isEngineOwned(args.cls)) return false;
  return !args.looksLikeQuestion && !args.loopSignal;
}

/**
 * May baseline intake SAVE the message as an answer and advance state?
 * Strictly the gate's validated-answer verdict.
 */
export function baselineMaySave(
  cls: Pick<InboundClassification, "kind" | "kinds" | "answer_valid" | "should_advance">,
): boolean {
  if (isEngineOwned(cls)) return false;
  return !!cls.answer_valid && !!cls.should_advance;
}

/** Same rule for the relationship questionnaire. */
export function relationshipMayOwnTurn(
  cls: Pick<InboundClassification, "kind" | "kinds" | "answer_valid" | "should_advance">,
): boolean {
  return !isEngineOwned(cls);
}