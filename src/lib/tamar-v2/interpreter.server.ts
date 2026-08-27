/**
 * TAMAR BRAIN V2 — intent interpretation stage.
 *
 * The model returns STRUCTURED JSON only. It never writes state, never
 * chooses an offer, never phrases the reply. On any failure (timeout,
 * bad JSON, low confidence) the deterministic interpreter takes over so
 * a turn can never be lost.
 */
import { detectSafetySignal, wantsHuman } from "./classify";
import { interpretDeterministic } from "./interpret-rules";
import { callStage } from "./model-registry.server";
import type { Interpretation } from "./types";

const SYSTEM = `You are the interpretation layer of a Hebrew WhatsApp assistant for "Zooga", an Israeli community for trips, events and social meetups.
You DO NOT reply to the customer. You only classify the latest inbound message.
Return ONLY JSON with this exact shape:
{"intent":string,"consent_answer":"yes"|"no"|"unknown","wants_human":boolean,"confusion":boolean,"sentiment":"positive"|"neutral"|"negative"|"distress","entities":{},"confidence":0-100,"rationale":string}
intent is one of: greeting, question, price_question, browse_offers, offer_interest, provide_info, consent_reply, clarification_request, explain_request, human_request, complaint, opt_out, opt_in, smalltalk, unknown.
entities may include only: first_name, relationship_status, goal, preferred_activity, region, travel_party, budget_sensitivity, special_requests, destination.
Rules: "לא הבנתי"/"מה?" is confusion, NOT a refusal. Never guess an entity that was not stated. confidence must honestly reflect ambiguity.`;

function coerce(raw: string | null): Interpretation | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const j = JSON.parse(match[0]);
    const entities: Record<string, string> = {};
    for (const [k, v] of Object.entries(j.entities ?? {})) {
      if (v != null && String(v).trim()) entities[k] = String(v).trim().slice(0, 300);
    }
    return {
      intent: String(j.intent ?? "unknown"),
      consent_answer: ["yes", "no"].includes(j.consent_answer) ? j.consent_answer : "unknown",
      wants_human: !!j.wants_human,
      confusion: !!j.confusion,
      sentiment: ["positive", "neutral", "negative", "distress"].includes(j.sentiment) ? j.sentiment : "neutral",
      entities,
      confidence: Math.max(0, Math.min(100, Number(j.confidence ?? 60))),
      rationale: String(j.rationale ?? "").slice(0, 400),
      source: "model",
    };
  } catch {
    return null;
  }
}

export async function interpret(
  message: string,
  ctx: {
    state: string;
    pendingQuestion?: string | null;
    known?: Record<string, string>;
    /** last turns, oldest first: "לקוח: ..." / "תמר: ..." */
    history?: string[];
    summary?: string | null;
    /** routing signal: simple turns run on the cheapest capable model */
    complexity?: "simple" | "complex";
  },
): Promise<Interpretation> {
  const deterministic = interpretDeterministic(message);
  // Safety signals are decided pre-model and are never softened by it.
  const forced = detectSafetySignal(message);

  const user = `state: ${ctx.state}
pending question: ${ctx.pendingQuestion ?? "none"}
already known: ${JSON.stringify(ctx.known ?? {})}
conversation summary: ${ctx.summary ?? "none"}
recent turns:
${(ctx.history ?? []).slice(-12).join("\n") || "(none)"}
inbound message: ${message}`;

  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
  const res = await callStage("intent_interpreter", messages, {
    json: true,
    context: "interpret",
    complexity: ctx.complexity ?? "simple",
  });

  let parsed = res.ok ? coerce(res.content) : null;
  // Structured-output failure earns exactly ONE escalated validation retry.
  if (!parsed) {
    const retry = await callStage("intent_interpreter", messages, {
      json: true,
      context: "interpret_validation_retry",
      complexity: "complex",
      validationRetry: true,
    });
    parsed = retry.ok ? coerce(retry.content) : null;
  }
  const out = parsed ?? { ...deterministic, source: "fallback" as const };
  return {
    ...out,
    wants_human: out.wants_human || wantsHuman(message),
    sentiment: forced.reason_codes.includes("distress") ? "distress" : out.sentiment,
  };
}
