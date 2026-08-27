/**
 * TAMAR BRAIN V2 — canonical context builder (server-only).
 *
 * Reads existing canonical sources, assembles ONE bounded context package
 * (see `context.ts`) and writes a compact, redacted audit snapshot keyed by
 * the inbound message id (idempotent: a retry updates nothing new).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildContextPackage,
  contextSourceCounts,
  estimateTokens,
  redactContext,
  CONTEXT_LIMITS,
  CONTEXT_VERSION,
  type ContextPackage,
} from "./context";

const db = () => supabaseAdmin as any;

async function safe<T>(p: PromiseLike<{ data: T | null }>, fallback: T): Promise<T> {
  try {
    const { data } = await p;
    return (data ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export type BuiltContext = {
  context: ContextPackage;
  source_counts: Record<string, number>;
  /** identifiers of the exact source records that fed this package */
  source_ids: Record<string, string[] | string | null>;
  token_estimate: number;
};

export async function buildTurnContext(args: {
  contact: Record<string, any> | null;
  state: string;
  knowledge?: string[];
}): Promise<BuiltContext> {
  const contactId: string | null = args.contact?.id ?? null;
  const dyn = (args.contact?.dynamic_profile_fields ?? {}) as Record<string, any>;

  const empty: any[] = [];
  const [interactions, facts, memories, history, decisions, handoffs] = contactId
    ? await Promise.all([
        safe(
          db()
            .from("interactions")
            .select("id,source,content,timestamp")
            .eq("contact_id", contactId)
            .order("timestamp", { ascending: false })
            .limit(CONTEXT_LIMITS.transcript),
          empty,
        ),
        safe(
          db()
            .from("contact_profile_facts")
            .select("id,field_key,value_text,explicit_or_inferred,confidence_score")
            .eq("contact_id", contactId)
            .eq("is_current", true)
            .is("superseded_by", null)
            .limit(CONTEXT_LIMITS.facts),
          empty,
        ),
        safe(
          db()
            .from("contact_memories")
            .select("id,memory_key,memory_type,memory_value,confidence_score,created_at,updated_at")
            .eq("contact_id", contactId)
            .order("updated_at", { ascending: false })
            .limit(CONTEXT_LIMITS.memories * 2),
          empty,
        ),
        safe(
          db()
            .from("contact_profile_history")
            .select("id,field_name,old_value,new_value,created_at")
            .eq("contact_id", contactId)
            .order("created_at", { ascending: false })
            .limit(CONTEXT_LIMITS.changes),
          empty,
        ),
        safe(
          db()
            .from("tamar_decision_traces")
            .select("id,selected_action,reason_codes,created_at")
            .eq("contact_id", contactId)
            .order("created_at", { ascending: false })
            .limit(CONTEXT_LIMITS.decisions),
          empty,
        ),
        safe(
          db()
            .from("manager_handoffs")
            .select("id,handoff_reason,resolved_at")
            .eq("contact_id", contactId)
            .is("resolved_at", null)
            .limit(1),
          empty,
        ),
      ])
    : [empty, empty, empty, empty, empty, empty];

  const ledger = (dyn?.["v2_offer_ledger"] ?? {}) as Record<string, any>;
  const offersSent: string[] = Array.isArray(ledger?.["link_sent_offer_ids"])
    ? ledger["link_sent_offer_ids"].map(String)
    : Array.isArray(dyn?.["v2_sent_offer_ids"])
      ? dyn["v2_sent_offer_ids"].map(String)
      : [];
  const offersPresented: string[] = Array.from(
    new Set([
      ...offersSent,
      ...(dyn?.["v2_last_offer_id"] ? [String(dyn["v2_last_offer_id"])] : []),
      ...(dyn?.["v2_last_grounded_offer_id"] ? [String(dyn["v2_last_grounded_offer_id"])] : []),
    ]),
  );

  const context = buildContextPackage({
    contact: args.contact ?? null,
    state: args.state,
    summary: dyn?.["v2_summary"] ?? null,
    interactions: interactions as any[],
    facts: facts as any[],
    memories: memories as any[],
    history: history as any[],
    decisions: decisions as any[],
    offersPresented,
    offersSent,
    handoff: { open: (handoffs as any[]).length > 0, reason: (handoffs as any[])[0]?.handoff_reason ?? null },
    knowledge: args.knowledge ?? [],
  });

  const safeContext = redactContext(context);
  const ids = (rows: any[], take = 40): string[] =>
    (rows ?? []).map((r) => String(r?.id ?? "")).filter(Boolean).slice(0, take);
  return {
    context: safeContext,
    source_counts: contextSourceCounts(safeContext),
    source_ids: {
      contact_id: contactId,
      interactions: ids(interactions as any[]),
      profile_facts: ids(facts as any[]),
      memories: ids(memories as any[]),
      profile_history: ids(history as any[]),
      decision_traces: ids(decisions as any[]),
      open_handoffs: ids(handoffs as any[], 5),
      offers_presented: offersPresented.slice(0, 10),
    },
    token_estimate: estimateTokens(safeContext),
  };
}

/** Persist the per-turn audit snapshot. Never breaks a turn. */
export async function saveContextSnapshot(args: {
  contactId: string | null;
  inboundMessageId: string | null;
  built: BuiltContext;
}): Promise<boolean> {
  try {
    const { error } = await db()
      .from("tamar_context_snapshots")
      .upsert(
        {
          contact_id: args.contactId,
          inbound_message_id: args.inboundMessageId,
          context_version: CONTEXT_VERSION,
          source_counts: args.built.source_counts,
          source_ids: redactContext(args.built.source_ids),
          context: redactContext(args.built.context),
          token_estimate: args.built.token_estimate,
        },
        { onConflict: "inbound_message_id", ignoreDuplicates: true },
      );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Link the snapshot to the decision trace that the turn produced. Called
 * after the trace row exists; idempotent and never breaks a turn.
 */
export async function attachDecisionTrace(args: {
  contactId: string | null;
  inboundMessageId: string | null;
  decisionTraceId: string | null;
}): Promise<boolean> {
  if (!args.decisionTraceId) return false;
  try {
    let q = db().from("tamar_context_snapshots").update({ decision_trace_id: args.decisionTraceId });
    if (args.inboundMessageId) q = q.eq("inbound_message_id", args.inboundMessageId);
    else if (args.contactId) q = q.eq("contact_id", args.contactId).is("decision_trace_id", null);
    else return false;
    const { error } = await q;
    return !error;
  } catch {
    return false;
  }
}
