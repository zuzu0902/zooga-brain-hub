/**
 * INBOUND CONTEXT GATE — LLM refinement of AMBIGUOUS classifications only.
 *
 * The deterministic classifier is the fast path and is never called through
 * the model: hard signals (opt-out, handoff, consent, explicit skip, a clean
 * validated answer) short-circuit before this file is reached.
 *
 * The model may only:
 *   - choose among the same InboundKind values,
 *   - lower a capture (turn an "answer" into question/confusion),
 * and NEVER turn a non-answer into an answer: `answer_valid` still has to
 * pass the deterministic field validator.
 *
 * Timeout / invalid JSON / any error => failedClassification, i.e. no capture.
 */
import { callStage } from "@/lib/tamar-v2/model-registry.server";
import {
  INBOUND_KINDS,
  failedClassification,
  validateFieldAnswer,
  type InboundClassification,
  type InboundKind,
  type ResponsePriority,
} from "./classify";

/** Below this the deterministic verdict is treated as ambiguous. */
export const AMBIGUITY_THRESHOLD = 0.6;

const HARD_KINDS: InboundKind[] = ["opt_out", "handoff", "consent", "refusal_or_skip"];
/** Deterministically certain kinds — the model must not second-guess them. */
const NEVER_REFINE: InboundKind[] = [...HARD_KINDS, "confusion"];

/** No model call unless the verdict is genuinely ambiguous. */
export function needsRefinement(c: InboundClassification): boolean {
  if (c.classifier_status !== "ok") return false;
  if (c.kinds.some((k) => NEVER_REFINE.includes(k))) return false;
  if (c.answer_valid && c.confidence >= AMBIGUITY_THRESHOLD) return false;
  return c.confidence < AMBIGUITY_THRESHOLD;
}

const SYSTEM = `You classify ONE inbound WhatsApp message of an Israeli community assistant ("זוגה"), in Hebrew.
Return ONLY JSON: {"kind":string,"confidence":0-1,"is_answer_to_current_question":boolean,"rationale":string}
kind is exactly one of: ${INBOUND_KINDS.join(", ")}.
Rules:
- "?", "מה?", "למה", "מה זה" are confusion, never answers.
- A message that asks something is "question"; a message that moves to another subject is "topic_shift".
- Never mark a message as an answer unless it really answers the CURRENT question.
- Judge only the last message, using the history as context.`;

function priorityFor(kind: InboundKind): ResponsePriority {
  if (kind === "opt_out") return "opt_out";
  if (kind === "handoff") return "handoff";
  if (kind === "consent") return "consent";
  if (kind === "confusion") return "clarify";
  if (kind === "question" || kind === "topic_shift" || kind === "multi_intent") return "answer_user";
  if (kind === "answer_current_question" || kind === "refusal_or_skip") return "advance_intake";
  return "smalltalk";
}

export type RefineContext = {
  text: string;
  currentQuestionKey?: string | null;
  currentQuestionText?: string | null;
  /** last 12 lines, oldest first */
  transcript?: string[];
  summary?: string | null;
  state?: string | null;
};

/**
 * Refine an ambiguous verdict. Returns the ORIGINAL classification when no
 * refinement is needed, and `failedClassification` on timeout/invalid output.
 */
export async function refineClassification(
  base: InboundClassification,
  ctx: RefineContext,
): Promise<InboundClassification> {
  if (!needsRefinement(base)) return base;

  const history = (ctx.transcript ?? []).slice(-12).join("\n");
  const res = await callStage(
    "intent_interpreter",
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          ctx.summary ? `סיכום: ${ctx.summary}` : "",
          ctx.state ? `state: ${ctx.state}` : "",
          ctx.currentQuestionText ? `השאלה הנוכחית של תמר: ${ctx.currentQuestionText}` : "אין שאלה פתוחה",
          history ? `היסטוריה:\n${history}` : "",
          `ההודעה האחרונה של הלקוח: ${ctx.text}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    { json: true, context: "inbound_gate_refine" },
  ).catch(() => null);

  if (!res?.ok || !res.content) return failedClassification(base.source_type);

  let parsed: any;
  try {
    const match = String(res.content).match(/\{[\s\S]*\}/);
    if (!match) return failedClassification(base.source_type);
    parsed = JSON.parse(match[0]);
  } catch {
    return failedClassification(base.source_type);
  }

  const kind = String(parsed?.kind ?? "");
  if (!(INBOUND_KINDS as readonly string[]).includes(kind)) {
    return failedClassification(base.source_type);
  }
  // The model may never invent a control intent it was not allowed to see.
  if (HARD_KINDS.includes(kind as InboundKind)) return failedClassification(base.source_type);

  const k = kind as InboundKind;
  const modelSaysAnswer = !!parsed?.is_answer_to_current_question && k === "answer_current_question";
  // A capture still has to pass the deterministic validator.
  const validation = validateFieldAnswer(ctx.currentQuestionKey ?? null, ctx.text);
  const answerValid = modelSaysAnswer && validation.valid;

  const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.6)));

  return {
    ...base,
    kind: k,
    kinds: [k],
    confidence,
    answer_valid: answerValid,
    should_advance: answerValid,
    response_priority: priorityFor(k),
    validator_reason: answerValid ? "model_refined_ok" : `model_refined:${validation.reason}`,
    classifier_status: "model_refined",
  };
}