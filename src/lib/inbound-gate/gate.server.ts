/**
 * INBOUND CONTEXT GATE — server wiring.
 *
 * Exactly ONE gate call per provider message id, before intake /
 * relationship_intake / brain / campaign reply may act on the inbound.
 * It loads the relevant context (last 12 messages, summary, state, consent,
 * handoff, current question, known facts, offers), classifies the message,
 * persists the decision (`inbound_gate_decisions`) and records every route
 * that consumed it — which is the instrumentation proving that each reply
 * route went through gate + Conversation Progress Guard.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { maskPhone } from "@/lib/zero-loss/core";
import {
  classifyInbound,
  failedClassification,
  type InboundClassification,
  type SourceType,
} from "./classify";
import { needsRefinement, refineClassification } from "./refine.server";

const db = () => supabaseAdmin as any;

export type InboundContext = {
  contact_id: string | null;
  phone_masked: string | null;
  /** last 12 messages, oldest first */
  transcript: Array<{ role: "in" | "out"; text: string; at: string }>;
  summary: string | null;
  conversation_state: string | null;
  consent_status: string | null;
  consent_pending: boolean;
  human_owned: boolean;
  opted_out: boolean;
  open_handoff: boolean;
  current_question_key: string | null;
  current_question_text: string | null;
  known_facts: Record<string, unknown>;
  offers_available: number;
};

const CONTACT_COLUMNS =
  "id,conversation_state,consent_status,opted_out_at,human_owned,residence_city,looking_for_relationship,likes_travel,travel_scope,last_trip_destination,intake_last_question_key,intake_missing_fields,relationship_intake_status";

export async function loadInboundContext(
  contactId: string | null,
  phone: string | null,
): Promise<InboundContext> {
  const ctx: InboundContext = {
    contact_id: contactId,
    phone_masked: maskPhone(phone ?? null),
    transcript: [],
    summary: null,
    conversation_state: null,
    consent_status: null,
    consent_pending: !contactId,
    human_owned: false,
    opted_out: false,
    open_handoff: false,
    current_question_key: null,
    current_question_text: null,
    known_facts: {},
    offers_available: 0,
  };
  if (!contactId) return ctx;

  const [{ data: contact }, { data: msgs }, { data: handoffs }, { data: relState }, { data: offers }] =
    await Promise.all([
      db().from("contacts").select(CONTACT_COLUMNS).eq("id", contactId).maybeSingle(),
      db()
        .from("messages")
        .select("message_text,reply_text,status,created_at")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(12),
      db()
        .from("manager_handoffs")
        .select("id,status")
        .eq("contact_id", contactId)
        .in("status", ["open", "notified", "claimed"])
        .limit(1),
      db()
        .from("relationship_intake_state")
        .select("status,current_question_key")
        .eq("contact_id", contactId)
        .maybeSingle(),
      db().from("offers").select("id").eq("status", "active").limit(50),
    ]);

  const c = (contact as any) ?? {};
  ctx.conversation_state = c.conversation_state ?? null;
  ctx.consent_status = c.consent_status ?? null;
  ctx.opted_out = !!c.opted_out_at || c.consent_status === "denied";
  ctx.human_owned = !!c.human_owned || c.conversation_state === "human_owned";
  ctx.consent_pending = c.consent_status !== "granted";
  ctx.known_facts = {
    residence_city: c.residence_city ?? null,
    looking_for_relationship: c.looking_for_relationship ?? null,
    likes_travel: c.likes_travel ?? null,
    travel_scope: c.travel_scope ?? null,
    last_trip_destination: c.last_trip_destination ?? null,
  };
  ctx.open_handoff = !!((handoffs as any[]) ?? []).length;
  ctx.offers_available = ((offers as any[]) ?? []).length;
  ctx.current_question_key =
    (relState as any)?.status === "in_progress"
      ? ((relState as any)?.current_question_key ?? null)
      : (c.intake_last_question_key ?? null);

  const rows = ((msgs as any[]) ?? []).slice().reverse();
  ctx.transcript = rows.map((m) => ({
    role: m.reply_text ? ("in" as const) : ("out" as const),
    text: String(m.reply_text ?? m.message_text ?? "").slice(0, 400),
    at: m.created_at,
  }));
  const lastOut = [...rows].reverse().find((m) => !m.reply_text);
  ctx.current_question_text = lastOut ? String(lastOut.message_text ?? "").slice(0, 300) : null;
  ctx.summary = ctx.transcript
    .slice(-6)
    .map((t) => `${t.role === "in" ? "לקוח" : "תמר"}: ${t.text.slice(0, 90)}`)
    .join(" | ")
    .slice(0, 900);

  return ctx;
}

export type GateResult = {
  classification: InboundClassification;
  context: InboundContext;
  /** true when this gate call re-read an existing decision (retry/duplicate) */
  replayed: boolean;
};

/** Per-request memo so a single envelope never gates the same wamid twice. */
const memo = new Map<string, GateResult>();

function fromRow(row: any, context: InboundContext): GateResult {
  return {
    replayed: true,
    context,
    classification: {
      kind: row.classification,
      kinds: Array.isArray(row.secondary_classifications) ? row.secondary_classifications : [row.classification],
      confidence: Number(row.confidence ?? 0),
      extracted_facts: (row.extracted_facts ?? {}) as Record<string, string>,
      should_advance: !!row.should_advance,
      response_priority: row.response_priority ?? "clarify",
      answer_valid: !!row.answer_valid,
      validator_reason: row.validator_reason ?? "replayed",
      source_type: (row.source_type ?? "text") as SourceType,
      loop_signal: false,
      classifier_status: row.classifier_status ?? "ok",
    },
  };
}

export async function runInboundGate(args: {
  contactId: string | null;
  phone: string;
  inboundMessageId?: string | null;
  text: string;
  sourceType?: SourceType;
  optionId?: string | null;
  /** transcript confidence for voice; a weak transcript never captures */
  transcriptConfidence?: number | null;
  /** set false in tests/replay to keep the classifier deterministic */
  allowRefinement?: boolean;
}): Promise<GateResult> {
  const key = args.inboundMessageId ?? "";
  if (key && memo.has(key)) return { ...memo.get(key)!, replayed: true };

  const context = await loadInboundContext(args.contactId, args.phone).catch(() => null);
  if (!context) {
    // DB not trustworthy: never capture anything on this turn.
    return {
      classification: failedClassification(args.sourceType ?? "text"),
      replayed: false,
      context: {
        contact_id: args.contactId,
        phone_masked: maskPhone(args.phone),
        transcript: [],
        summary: null,
        conversation_state: null,
        consent_status: null,
        consent_pending: true,
        human_owned: false,
        opted_out: false,
        open_handoff: false,
        current_question_key: null,
        current_question_text: null,
        known_facts: {},
        offers_available: 0,
      },
    };
  }

  if (key) {
    const { data: existing } = await db()
      .from("inbound_gate_decisions")
      .select("*")
      .eq("inbound_message_id", key)
      .maybeSingle()
      .then((r: any) => r, () => ({ data: null }));
    if (existing) {
      const replay = fromRow(existing, context);
      memo.set(key, replay);
      return replay;
    }
  }

  let classification: InboundClassification;
  try {
    classification = classifyInbound({
      text: args.text,
      sourceType: args.sourceType,
      optionId: args.optionId ?? null,
      currentQuestionKey: context.current_question_key,
      currentQuestionText: context.current_question_text,
      consentPending: context.consent_pending,
    });
    // A low-confidence voice transcript is never treated as a captured answer.
    if (
      args.sourceType === "voice" &&
      typeof args.transcriptConfidence === "number" &&
      args.transcriptConfidence < 0.6
    ) {
      classification = {
        ...classification,
        answer_valid: false,
        should_advance: false,
        validator_reason: "low_confidence_transcript",
      };
    }
    // AMBIGUOUS ONLY: one structured LLM refinement on the context that is
    // already loaded. Deterministic verdicts never reach the model.
    if (args.allowRefinement !== false && needsRefinement(classification)) {
      classification = await refineClassification(classification, {
        text: args.text,
        currentQuestionKey: context.current_question_key,
        currentQuestionText: context.current_question_text,
        transcript: context.transcript.map(
          (t) => `${t.role === "in" ? "לקוח" : "תמר"}: ${t.text}`,
        ),
        summary: context.summary,
        state: context.conversation_state,
      });
    }
  } catch {
    classification = failedClassification(args.sourceType ?? "text");
  }

  const result: GateResult = { classification, context, replayed: false };
  if (key) memo.set(key, result);

  await db()
    .from("inbound_gate_decisions")
    .upsert(
      {
        inbound_message_id: key || null,
        contact_id: args.contactId,
        phone_masked: maskPhone(args.phone),
        source_type: classification.source_type,
        classification: classification.kind,
        secondary_classifications: classification.kinds,
        confidence: classification.confidence,
        should_advance: classification.should_advance,
        response_priority: classification.response_priority,
        answer_valid: classification.answer_valid,
        validator_reason: classification.validator_reason,
        extracted_facts: classification.extracted_facts,
        context_messages: context.transcript.length,
        current_question_key: context.current_question_key,
        classifier_status: classification.classifier_status,
        routes: [],
        transcript: String(args.text ?? "").slice(0, 1000),
      },
      { onConflict: "inbound_message_id" } as any,
    )
    .catch(() => null);

  return result;
}

/** Instrumentation: record that `route` consumed this gated inbound. */
export async function markGateRoute(inboundMessageId: string | null | undefined, route: string) {
  if (!inboundMessageId) return;
  try {
    const { data } = await db()
      .from("inbound_gate_decisions")
      .select("routes")
      .eq("inbound_message_id", inboundMessageId)
      .maybeSingle();
    const routes: string[] = Array.isArray((data as any)?.routes) ? (data as any).routes.map(String) : [];
    if (routes.includes(route)) return;
    await db()
      .from("inbound_gate_decisions")
      .update({ routes: [...routes, route] })
      .eq("inbound_message_id", inboundMessageId);
  } catch {
    /* instrumentation must never break the reply path */
  }
}

/**
 * Persist the inbound itself: messages + interactions, with source type,
 * transcript and the gate classification. Never overwrites CRM facts.
 */
export async function recordInboundMessage(args: {
  contactId: string | null;
  text: string;
  sourceType: SourceType;
  classification: InboundClassification;
  inboundMessageId?: string | null;
  route?: string | null;
}) {
  if (!args.contactId) return;
  try {
    // One row per provider message id: the unique partial index on
    // provider_message_id makes a webhook retry a no-op.
    const pid = args.inboundMessageId ?? null;
    await db()
      .from("messages")
      .upsert(
        {
          contact_id: args.contactId,
          channel: "WhatsApp",
          message_text: args.text.slice(0, 4000),
          reply_text: args.text.slice(0, 4000),
          status: "replied",
          provider_message_id: pid,
        },
        { onConflict: "provider_message_id", ignoreDuplicates: true } as any,
      );
    await db()
      .from("interactions")
      .upsert(
        {
          contact_id: args.contactId,
          type: "whatsapp_message",
          source: `inbound_${args.sourceType}`,
          provider_message_id: pid,
          content: JSON.stringify({
            text: args.text.slice(0, 500),
            source_type: args.sourceType,
            classification: args.classification.kind,
            confidence: args.classification.confidence,
            answer_valid: args.classification.answer_valid,
            facts: args.classification.extracted_facts,
            route: args.route ?? null,
            inbound_message_id: pid,
          }).slice(0, 2000),
        },
        { onConflict: "provider_message_id", ignoreDuplicates: true } as any,
      );
  } catch {
    /* the ledger must never break the reply path */
  }
}

/**
 * Sync canonical facts to the contact row WITHOUT overwriting trusted data:
 * only empty columns are filled.
 */
export async function syncGateFacts(contactId: string | null, facts: Record<string, string>) {
  if (!contactId || !Object.keys(facts).length) return { applied: [] as string[] };
  const map: Record<string, string> = {
    residence_city: "residence_city",
    destination_interest: "last_trip_destination",
    travel_scope: "travel_scope",
  };
  const { data } = await db()
    .from("contacts")
    .select("residence_city,last_trip_destination,travel_scope")
    .eq("id", contactId)
    .maybeSingle();
  const current = (data as any) ?? {};
  const patch: Record<string, string> = {};
  const applied: string[] = [];
  for (const [factKey, column] of Object.entries(map)) {
    const value = facts[factKey];
    if (!value) continue;
    if (current[column]) continue; // trusted information is never overwritten
    patch[column] = value;
    applied.push(column);
  }
  if (!applied.length) return { applied };
  await db().from("contacts").update(patch).eq("id", contactId).catch(() => null);
  return { applied };
}

/** Test/worker helper: clear the per-process memo. */
export function __resetGateMemo() {
  memo.clear();
}