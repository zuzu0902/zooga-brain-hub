/**
 * Hybrid runtime decision layer.
 *
 * After the customer-facing reply is generated, we ask the LLM a SECOND time
 * with a strict JSON schema to return structured runtime signals:
 *
 *   - prior_question_answered   (did the user message answer the intake question Tamar asked last turn?)
 *   - captured_fields           (list of {field, value, confidence})
 *   - handoff_requested + reasons + confidence
 *   - offer_relevance           ({ offer_id, relevant, confidence })
 *   - next_target_field         (which intake field to ask next)
 *
 * The deterministic runtime in tamar-turn.ts then EXECUTES these decisions
 * with guardrails (confidence thresholds, allow-lists, union with regex
 * extractors, schema validation). The LLM cannot bypass CRM writes or
 * handoff dispatch directly — it only proposes; the runtime decides.
 */
import type { IntakeFieldKey, IntakeSnapshot } from "@/lib/intake-workflow";
import { INTAKE_REQUIRED_FIELDS } from "@/lib/intake-workflow";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DECISION_MODEL = "google/gemini-2.5-flash";

export type DecisionCapture = {
  field: IntakeFieldKey;
  value: string;
  confidence: number;
};

export type RuntimeDecision = {
  prior_question_answered: boolean | null;
  captured_fields: DecisionCapture[];
  handoff_requested: boolean;
  handoff_reasons: string[];
  handoff_confidence: number;
  offer_relevance: {
    offer_id: string | null;
    relevant: boolean;
    confidence: number;
  };
  next_target_field: IntakeFieldKey | null;
  notes?: string | null;
  raw?: any;
  error?: string;
};

const VALID_FIELDS = new Set<string>(INTAKE_REQUIRED_FIELDS);

function clampConfidence(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function coerceField(v: any): IntakeFieldKey | null {
  if (typeof v !== "string") return null;
  return VALID_FIELDS.has(v) ? (v as IntakeFieldKey) : null;
}

function sanitizeDecision(parsed: any, ctx: { offerId: string | null }): RuntimeDecision {
  const capturesIn = Array.isArray(parsed?.captured_fields) ? parsed.captured_fields : [];
  const captured_fields: DecisionCapture[] = capturesIn
    .map((c: any) => {
      const field = coerceField(c?.field);
      const value = c?.value == null ? "" : String(c.value).trim();
      if (!field || !value) return null;
      return { field, value, confidence: clampConfidence(c?.confidence) };
    })
    .filter(Boolean) as DecisionCapture[];

  const handoff_reasons = Array.isArray(parsed?.handoff_reasons)
    ? parsed.handoff_reasons.map((s: any) => String(s)).slice(0, 6)
    : [];

  const offerRel = parsed?.offer_relevance ?? {};
  const offer_relevance = {
    offer_id: ctx.offerId,
    relevant: !!offerRel?.relevant,
    confidence: clampConfidence(offerRel?.confidence),
  };

  return {
    prior_question_answered:
      typeof parsed?.prior_question_answered === "boolean" ? parsed.prior_question_answered : null,
    captured_fields,
    handoff_requested: !!parsed?.handoff_requested,
    handoff_reasons,
    handoff_confidence: clampConfidence(parsed?.handoff_confidence),
    offer_relevance,
    next_target_field: coerceField(parsed?.next_target_field),
    notes: typeof parsed?.notes === "string" ? parsed.notes.slice(0, 400) : null,
    raw: parsed,
  };
}

function emptyDecision(ctx: { offerId: string | null }, error?: string): RuntimeDecision {
  return {
    prior_question_answered: null,
    captured_fields: [],
    handoff_requested: false,
    handoff_reasons: [],
    handoff_confidence: 0,
    offer_relevance: { offer_id: ctx.offerId, relevant: false, confidence: 0 },
    next_target_field: null,
    notes: null,
    error,
  };
}

export async function requestRuntimeDecision(args: {
  inboundMessage: string;
  assistantReply: string;
  lastAssistantTurn: string | null;
  lastAskedKey: string | null;
  intakeSnapshot: IntakeSnapshot;
  conversationMode: string;
  offer: { id: string; title: string | null } | null;
}): Promise<RuntimeDecision> {
  const offerId = args.offer?.id ?? null;
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return emptyDecision({ offerId }, "missing_api_key");

  const schemaHint = {
    prior_question_answered:
      "true | false | null — did the user's CURRENT message answer the intake field Tamar last asked? null if no prior question.",
    captured_fields:
      "array of { field, value, confidence 0-100 }. Field must be one of: " +
      INTAKE_REQUIRED_FIELDS.join(", "),
    handoff_requested:
      "true if this conversation should be escalated to a human manager NOW.",
    handoff_reasons:
      "short array of reason codes, e.g. ['explicit_human_request','user_confirmed_transfer','sensitive_topic','unresolved_objection','out_of_scope'].",
    handoff_confidence: "0-100",
    offer_relevance: "{ relevant: boolean, confidence: 0-100 } — is the resolved offer truly relevant to the user's current intent?",
    next_target_field:
      "which intake field to ask next, from: " +
      INTAKE_REQUIRED_FIELDS.join(", ") +
      ". null if intake is complete or should pause this turn.",
    notes: "short free-text rationale (<=400 chars)",
  };

  const system = [
    "You are the runtime DECISION layer for Tamar (Hebrew sales/intake agent for Zooga).",
    "You do NOT write the user-facing reply. The reply was already produced.",
    "Your job is to analyze the latest turn and output STRUCTURED JSON only.",
    "Be conservative: only set handoff_requested=true if there is clear evidence (explicit human request, confirmed transfer, repeated unresolved objection, out-of-scope topic, distress signal).",
    "For captured_fields, only include fields the user CLEARLY communicated in the current message. Use confidence 85+ for clear signals, 60-80 for inferred, <60 for guesses (will be queued for human review).",
    "Return ONLY valid JSON matching this shape:",
    JSON.stringify(schemaHint, null, 2),
  ].join("\n");

  const userBlock = [
    `Conversation mode (deterministic): ${args.conversationMode}`,
    `Intake state: ${args.intakeSnapshot.state} stage=${args.intakeSnapshot.stage} score=${args.intakeSnapshot.completion_score}`,
    `Intake missing fields: ${args.intakeSnapshot.missing.join(", ") || "(none)"}`,
    `Last intake field asked by Tamar: ${args.lastAskedKey ?? "(none)"}`,
    `Resolved offer: ${args.offer ? `${args.offer.title} [${args.offer.id}]` : "(none)"}`,
    args.lastAssistantTurn ? `Previous assistant turn:\n${args.lastAssistantTurn}` : "",
    `Current user message:\n${args.inboundMessage}`,
    `Current assistant reply (already sent):\n${args.assistantReply}`,
    "Return ONLY the JSON object. No prose, no markdown fences.",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const res = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DECISION_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userBlock },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return emptyDecision({ offerId }, `gateway_${res.status}: ${txt.slice(0, 200)}`);
    }
    const json: any = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? "";
    let parsed: any = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Try to extract first {...} block
      const m = content.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { /* noop */ }
      }
    }
    if (!parsed || typeof parsed !== "object") {
      return emptyDecision({ offerId }, "decision_parse_failed");
    }
    return sanitizeDecision(parsed, { offerId });
  } catch (e: any) {
    return emptyDecision({ offerId }, `decision_call_failed: ${String(e?.message ?? e).slice(0, 200)}`);
  }
}