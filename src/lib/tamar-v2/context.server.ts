/**
 * TAMAR BRAIN V2 — canonical context builder (server-only).
 *
 * Reads existing canonical sources, assembles ONE bounded context package
 * (see `context.ts`) and writes a versioned audit snapshot keyed by the
 * inbound message id.
 *
 * PRODUCTION DEFECT REPAIRED HERE:
 * the snapshot upsert targeted `on_conflict=inbound_message_id`, but the
 * uniqueness in the database was a PARTIAL index
 * (`WHERE inbound_message_id IS NOT NULL`). Postgres cannot infer a partial
 * index from a bare ON CONFLICT clause, so EVERY production write failed
 * with SQLSTATE 42P10 while the in-memory test double happily accepted it —
 * `tamar_context_snapshots` stayed empty although 91 decision traces existed.
 * The index is now a plain unique index AND this module reports failures
 * instead of swallowing them, so the turn can fail closed.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildContextPackage,
  budgetContext,
  contextSourceCounts,
  estimateTokens,
  redactContext,
  CONTEXT_LIMITS,
  CONTEXT_VERSION,
  type ContextCommitment,
  type ContextFocus,
  type ContextPackage,
  type RawInbound,
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

/** Operational error of the mandatory context transaction. Never throws. */
export async function recordContextFailure(args: {
  contactId: string | null;
  inboundMessageId: string | null;
  stage: string;
  error: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db().from("tamar_context_failures").insert({
      contact_id: args.contactId,
      inbound_message_id: args.inboundMessageId,
      stage: args.stage,
      error: args.error ? String(args.error).slice(0, 500) : null,
      details: redactContext(args.details ?? {}),
    });
  } catch {
    /* the failure log itself must never throw */
  }
}

export async function buildTurnContext(args: {
  contact: Record<string, any> | null;
  state: string;
  knowledge?: string[];
  focus?: ContextFocus | null;
  intakeAnswered?: Record<string, string>;
  intakeMissing?: string[];
  /** the inbound turn this decision is about — mandatory in production */
  inbound?: RawInbound | null;
}): Promise<BuiltContext> {
  const contactId: string | null = args.contact?.id ?? null;
  const dyn = (args.contact?.dynamic_profile_fields ?? {}) as Record<string, any>;

  const empty: any[] = [];
  const [interactions, facts, memories, history, decisions, handoffs, tasks, managerNotes] = contactId
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
        safe(
          db()
            .from("tasks")
            .select("id,title,status,offer_id,created_at")
            .eq("contact_id", contactId)
            .neq("status", "done")
            .order("created_at", { ascending: false })
            .limit(5),
          empty,
        ),
        // The manager's own record of the last resolved handoff — Tamar
        // resumes from the conversation PLUS this summary.
        safe(
          db()
            .from("manager_handoffs")
            .select("manager_summary,outcome,contacted_at,resolved_at")
            .eq("contact_id", contactId)
            .not("resolved_at", "is", null)
            .order("resolved_at", { ascending: false })
            .limit(1),
          empty,
        ),
      ])
    : [empty, empty, empty, empty, empty, empty, empty, empty];

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

  // The FULL current record of the offer the conversation is focused on.
  const focus = args.focus ?? null;
  const activeOffer = focus?.offer_id
    ? ((
        await safe(db().from("offers").select("*").eq("id", focus.offer_id).limit(1), empty)
      )[0] ?? null)
    : null;

  const commitments: ContextCommitment[] = [
    ...((handoffs as any[]) ?? []).map((h) => ({
      kind: "open_handoff",
      ref: String(h?.id ?? ""),
      text: h?.handoff_reason ?? null,
      at: null,
    })),
    ...((tasks as any[]) ?? []).map((t) => ({
      kind: "open_task",
      ref: String(t?.id ?? ""),
      text: t?.title ?? null,
      at: t?.created_at ?? null,
    })),
  ];

  const context = budgetContext(
    buildContextPackage({
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
      handoff: {
        open: (handoffs as any[]).length > 0,
        reason: (handoffs as any[])[0]?.handoff_reason ?? null,
        manager_summary: (managerNotes as any[])[0]?.manager_summary ?? null,
        manager_outcome: (managerNotes as any[])[0]?.outcome ?? null,
        manager_contacted_at: (managerNotes as any[])[0]?.contacted_at ?? null,
      },
      knowledge: args.knowledge ?? [],
      focus,
      activeOffer,
      intakeAnswered: args.intakeAnswered ?? {},
      intakeMissing: args.intakeMissing ?? [],
      commitments,
      inbound: args.inbound ?? null,
    }),
  );

  const safeContext = redactContext(context);
  const ids = (rows: any[], take = 40): string[] =>
    (rows ?? []).map((r) => String(r?.id ?? "")).filter(Boolean).slice(0, take);
  return {
    context: safeContext,
    source_counts: contextSourceCounts(safeContext),
    source_ids: {
      contact_id: contactId,
      inbound_message_id: safeContext.inbound?.message_id ?? null,
      interactions: ids(interactions as any[]),
      profile_facts: ids(facts as any[]),
      memories: ids(memories as any[]),
      profile_history: ids(history as any[]),
      decision_traces: ids(decisions as any[]),
      open_handoffs: ids(handoffs as any[], 5),
      open_tasks: ids(tasks as any[], 5),
      active_offer: safeContext.active_offer?.id ?? null,
      offers_presented: offersPresented.slice(0, 10),
    },
    token_estimate: estimateTokens(safeContext),
  };
}

/**
 * Persist the per-turn audit snapshot. Returns the snapshot id, or null when
 * it could NOT be durably stored — the caller must then fail closed.
 */
export async function saveContextSnapshot(args: {
  contactId: string | null;
  inboundMessageId: string | null;
  built: BuiltContext;
}): Promise<{ id: string | null; error: string | null }> {
  const row = {
    contact_id: args.contactId,
    inbound_message_id: args.inboundMessageId,
    context_version: CONTEXT_VERSION,
    source_counts: args.built.source_counts,
    source_ids: redactContext(args.built.source_ids),
    context: redactContext(args.built.context),
    token_estimate: args.built.token_estimate,
    active_topic: args.built.context.active?.topic ?? null,
    active_offer_id: args.built.context.active?.offer_id ?? null,
  };
  try {
    if (args.inboundMessageId) {
      // Idempotent per wamid: a retry MUST resolve to the same snapshot row.
      const { error } = await db()
        .from("tamar_context_snapshots")
        .upsert(row, { onConflict: "inbound_message_id", ignoreDuplicates: true });
      if (error) return { id: null, error: error.message ?? "upsert_failed" };
      const { data, error: readErr } = await db()
        .from("tamar_context_snapshots")
        .select("id")
        .eq("inbound_message_id", args.inboundMessageId)
        .limit(1)
        .maybeSingle();
      if (readErr || !data?.id) return { id: null, error: readErr?.message ?? "snapshot_not_readable" };
      return { id: String(data.id), error: null };
    }
    const { data, error } = await db().from("tamar_context_snapshots").insert(row).select("id").maybeSingle();
    if (error || !data?.id) return { id: null, error: error?.message ?? "insert_returned_no_row" };
    return { id: String(data.id), error: null };
  } catch (e: any) {
    return { id: null, error: String(e?.message ?? e) };
  }
}

/**
 * Link the snapshot to the decision trace / runtime execution the turn
 * produced. Idempotent; never breaks a turn.
 */
export async function attachDecisionTrace(args: {
  contactId: string | null;
  inboundMessageId: string | null;
  snapshotId?: string | null;
  decisionTraceId: string | null;
  runtimeExecutionId?: string | null;
}): Promise<boolean> {
  if (!args.decisionTraceId && !args.runtimeExecutionId) return false;
  const patch: Record<string, unknown> = {};
  if (args.decisionTraceId) patch["decision_trace_id"] = args.decisionTraceId;
  if (args.runtimeExecutionId) patch["runtime_execution_id"] = args.runtimeExecutionId;
  try {
    let q = db().from("tamar_context_snapshots").update(patch);
    if (args.snapshotId) q = q.eq("id", args.snapshotId);
    else if (args.inboundMessageId) q = q.eq("inbound_message_id", args.inboundMessageId);
    else if (args.contactId) q = q.eq("contact_id", args.contactId).is("decision_trace_id", null);
    else return false;
    const { error } = await q;
    return !error;
  } catch {
    return false;
  }
}
