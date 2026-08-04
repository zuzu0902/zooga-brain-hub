/**
 * TAMAR BRAIN v1 — dynamic action planner.
 *
 * Inside the boundaries the state machine allows, an AI agent chooses the
 * next best ACTION (not a hard script). Output is validated structured JSON;
 * anything invalid falls back to a deterministic safe plan.
 */
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

export const ACTIONS = [
  "acknowledge",
  "answer_user",
  "ask_next_field",
  "explain_community",
  "recommend_offer",
  "send_site_link",
  "request_handoff",
  "close",
  "wait",
] as const;
export type BrainAction = (typeof ACTIONS)[number];

const PlanSchema = z.object({
  considered_actions: z
    .array(z.object({ action: z.string(), score: z.number(), why: z.string().optional() }))
    .default([]),
  selected_action: z.string(),
  secondary_action: z.string().nullable().optional(),
  ask_field: z.string().nullable().optional(),
  confidence: z.number().default(50),
  reason_codes: z.array(z.string()).default([]),
  user_intent: z.string().default("unknown"),
  directive: z.string().default(""),
});

export type ActionPlan = {
  considered_actions: Array<{ action: string; score: number; why?: string }>;
  selected_action: BrainAction;
  secondary_action: BrainAction | null;
  ask_field: string | null;
  confidence: number;
  reason_codes: string[];
  user_intent: string;
  directive: string;
  source: "model" | "fallback";
};

export type PlanContext = {
  state: string;
  message: string;
  knownFields: Record<string, { value: unknown; confidence: number; source: string; last_verified_at: string | null }>;
  unknownFields: string[];
  allowedActions: BrainAction[];
  turnCount: number;
  answeredCount: number;
  userAskedQuestion: boolean;
  offerTitles: string[];
  knowledgeSnippets: string[];
  campaignSource: string | null;
  emotionalTone: string | null;
};

function fallbackPlan(ctx: PlanContext): ActionPlan {
  const allow = (a: BrainAction) => ctx.allowedActions.includes(a);
  if (ctx.userAskedQuestion && allow("answer_user")) {
    return plan("answer_user", null, ["user_led_question"], 60, ctx, "ענה קודם לשאלה של הלקוח, ורק אז שקול שאלה אחת.");
  }
  if (ctx.answeredCount >= 2 && allow("recommend_offer") && ctx.offerTitles.length) {
    return plan("recommend_offer", null, ["enough_context_deliver_value"], 55, ctx, "תן ערך לפני שאלה נוספת.");
  }
  if (ctx.unknownFields.length && allow("ask_next_field")) {
    return plan("ask_next_field", null, ["fields_missing"], 50, ctx, "שאל שאלה אחת בלבד.");
  }
  return plan("acknowledge", null, ["default"], 40, ctx, "הגב בחום ובקצרה.");
}

function plan(
  action: BrainAction,
  ask: string | null,
  codes: string[],
  confidence: number,
  ctx: PlanContext,
  directive: string,
): ActionPlan {
  return {
    considered_actions: ctx.allowedActions.map((a) => ({ action: a, score: a === action ? confidence : 0 })),
    selected_action: action,
    secondary_action: null,
    ask_field: ask,
    confidence,
    reason_codes: codes,
    user_intent: ctx.userAskedQuestion ? "question" : "unknown",
    directive,
    source: "fallback",
  };
}

const SYSTEM = `You are the ACTION PLANNER for Tamar, the digital assistant of Zooga (Hebrew community for trips, events and connections).
You do NOT write the customer message. You only choose the next best ACTION and a short Hebrew directive for the writer.
Rules:
- At most ONE question per message. If the user asked something, answering comes first.
- Never propose asking for information already known.
- After 2-3 answers, prefer delivering value (insight, explanation, recommendation, link) over another question.
- Never invent facts, prices, events or promises.
- Prefer request_handoff whenever the user seems to want a human, is upset, or precision is missing on a high-stakes topic.
- Score every allowed action on: user intent, missing-information value, friction, trust, offer relevance, conversation length, emotional tone, prior answers, campaign source.
Return ONLY JSON.`;

export async function planNextAction(ctx: PlanContext): Promise<ActionPlan> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key || !ctx.allowedActions.length) return fallbackPlan(ctx);

  const user = JSON.stringify({
    state: ctx.state,
    inbound_message: ctx.message,
    allowed_actions: ctx.allowedActions,
    known_fields: ctx.knownFields,
    unknown_fields: ctx.unknownFields,
    turn_count: ctx.turnCount,
    answers_given_by_user: ctx.answeredCount,
    user_asked_question: ctx.userAskedQuestion,
    sellable_offer_titles: ctx.offerTitles,
    community_knowledge: ctx.knowledgeSnippets,
    campaign_source: ctx.campaignSource,
    emotional_tone: ctx.emotionalTone,
    output_shape: {
      considered_actions: [{ action: "string", score: 0, why: "string" }],
      selected_action: "one of allowed_actions",
      secondary_action: "one of allowed_actions or null",
      ask_field: "field key or null",
      confidence: 0,
      reason_codes: ["string"],
      user_intent: "string",
      directive: "short Hebrew instruction for the reply writer",
    },
  });

  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return fallbackPlan(ctx);
    const json: any = await res.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    const parsed = PlanSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return fallbackPlan(ctx);

    const selected = parsed.data.selected_action as BrainAction;
    // Hard boundary: the model can never step outside the allowed action set.
    if (!ctx.allowedActions.includes(selected)) return fallbackPlan(ctx);
    const secondary = (parsed.data.secondary_action ?? null) as BrainAction | null;

    return {
      considered_actions: parsed.data.considered_actions.slice(0, 10),
      selected_action: selected,
      secondary_action: secondary && ctx.allowedActions.includes(secondary) ? secondary : null,
      ask_field: parsed.data.ask_field ?? null,
      confidence: Math.max(0, Math.min(100, Math.round(parsed.data.confidence))),
      reason_codes: parsed.data.reason_codes.slice(0, 8),
      user_intent: parsed.data.user_intent,
      directive: parsed.data.directive,
      source: "model",
    };
  } catch {
    return fallbackPlan(ctx);
  }
}

/** Which actions are legal in a given state (deterministic boundary). */
export function allowedActionsForState(state: string): BrainAction[] {
  switch (state) {
    case "consent_pending":
      return ["acknowledge", "request_handoff", "wait"];
    case "opted_out":
      return ["answer_user", "request_handoff", "close"];
    case "human_owned":
    case "human_handoff_queued":
    case "paused":
      return ["wait"];
    case "consented":
    case "intake_active":
      return ["acknowledge", "answer_user", "ask_next_field", "explain_community", "recommend_offer", "send_site_link", "request_handoff", "close"];
    case "value_delivery":
    case "offer_recommended":
      return ["acknowledge", "answer_user", "explain_community", "recommend_offer", "send_site_link", "ask_next_field", "request_handoff", "close"];
    case "closed":
      return ["acknowledge", "answer_user", "recommend_offer", "send_site_link", "request_handoff"];
    default:
      return ["acknowledge", "answer_user", "request_handoff"];
  }
}