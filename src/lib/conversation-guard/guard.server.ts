/**
 * CONVERSATION PROGRESS GUARD — server wiring.
 *
 * Every Tamar reply path calls `guardOutbound` BEFORE persist/send. The guard
 * loads the last turns of the thread, applies the pure loop rules and returns
 * the text that may actually be sent. Every decision is logged to
 * `conversation_turns` (no PII beyond a masked phone).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { maskPhone } from "@/lib/zero-loss/core";
import { quiet } from "@/lib/db-safe";
import {
  evaluateOutbound,
  questionSignature,
  responseSignature,
  buildRecovery,
  buildRephrase,
  type GuardResult,
  type ProgressFlags,
  type TurnRecord,
} from "./core";

const db = () => supabaseAdmin as any;

const TURN_COLUMNS =
  "route,asked_field,question_signature,response_signature,normalized_intent,progress_made,repeat_count,created_at";

/**
 * The last Tamar turns of a CONTACT/SESSION across **all** reply routes.
 * No route filter is applied: an alternating loop
 * (baseline_intake -> tamar_engine -> relationship_intake) must be visible
 * as one history. Falls back to the masked phone when the contact row does
 * not exist yet.
 */
export async function recentTurns(
  contactId: string | null,
  limit = 3,
  phone?: string | null,
): Promise<TurnRecord[]> {
  let query = db().from("conversation_turns").select(TURN_COLUMNS);
  if (contactId) query = query.eq("contact_id", contactId);
  else if (maskPhone(phone ?? null)) query = query.eq("phone_masked", maskPhone(phone ?? null));
  else return [];
  const { data } = await query.order("created_at", { ascending: false }).limit(limit);
  return ((data as any[]) ?? []) as TurnRecord[];
}

export type GuardedTurn = GuardResult & {
  logged: boolean;
  replayed?: boolean;
  /** Route that originally produced the (single) rewriting verdict. */
  owner_route?: string | null;
};

/**
 * `enforce`  — the guard may rewrite/suppress the candidate (conversational
 *              routes that ask questions).
 * `log_only` — compliance-critical acknowledgements (consent, opt-out/in,
 *              voice failure). The turn is recorded so the loop history stays
 *              complete, but the text is NEVER rewritten.
 */
export type GuardMode = "enforce" | "log_only";

/**
 * Idempotency stays keyed by (inbound_message_id, route). On top of that a
 * single guard call OWNS the rewriting for an inbound message: if any route
 * already produced a verdict for this inbound id, later call sites replay
 * that final verdict instead of mutating the text a second time.
 */
async function existingTurn(inboundMessageId: string | null | undefined, route: string) {
  if (!inboundMessageId) return null;
  const { data } = await db()
    .from("conversation_turns")
    .select("route,guard_verdict,guard_reason,repeat_count,loop_signal,question_signature")
    .eq("inbound_message_id", inboundMessageId)
    .order("created_at", { ascending: true })
    .limit(5);
  const rows = ((data as any[]) ?? []).filter((r) => !!r?.guard_verdict);
  if (!rows.length) return null;
  return rows.find((r) => r.route === route) ?? rows[0];
}

/**
 * Single entry point used by deterministic intake, the v2 engine, the LLM
 * fallback, menu/button replies and campaign replies.
 */
export async function guardOutbound(args: {
  contactId: string | null;
  phone?: string | null;
  route: string;
  inboundMessageId?: string | null;
  inboundText?: string | null;
  candidateText: string;
  askedField?: string | null;
  purpose?: string | null;
  summary?: string | null;
  intent?: string | null;
  stateBefore?: string | null;
  stateAfter?: string | null;
  factsBefore?: Record<string, unknown>;
  factsAfter?: Record<string, unknown>;
  progress?: ProgressFlags | null;
  mode?: GuardMode;
  /** Inbound Context Gate verdict for this inbound (instrumentation). */
  classification?: string | null;
  classificationConfidence?: number | null;
  sourceType?: string | null;
  extractedFacts?: Record<string, unknown> | null;
  gateApplied?: boolean;
}): Promise<GuardedTurn> {
  const mode: GuardMode = args.mode ?? "enforce";

  // ---- double-guard / double-send protection -------------------------
  const prior = await existingTurn(args.inboundMessageId, args.route).catch(() => null);
  if (prior) {
    const verdict = (prior.guard_verdict ?? "send") as GuardResult["verdict"];
    // The verdict is re-applied deterministically; the candidate text is
    // never passed through a second rewriting pass.
    const text =
      verdict === "rephrase"
        ? buildRephrase(args.candidateText, args.purpose ?? null)
        : verdict === "recovery"
          ? buildRecovery(args.summary ?? null)
          : args.candidateText;
    return {
      verdict,
      reason: `replayed:${prior.guard_reason ?? "unknown"}`,
      repeat_count: Number(prior.repeat_count ?? 0),
      question_signature: prior.question_signature ?? questionSignature(args.candidateText),
      loop_signal: !!prior.loop_signal,
      text: mode === "log_only" ? args.candidateText : text,
      logged: true,
      replayed: true,
      owner_route: prior.route ?? null,
    };
  }

  // Session-level history: every route of this contact, newest first.
  const recent = await recentTurns(args.contactId, 3, args.phone).catch(() => []);
  const result = evaluateOutbound({
    candidateText: args.candidateText,
    askedField: args.askedField ?? null,
    inboundText: args.inboundText ?? null,
    recentTurns: recent,
    progress: args.progress ?? null,
    summary: args.summary ?? null,
    purpose: args.purpose ?? null,
  });

  if (mode === "log_only") {
    result.text = args.candidateText;
  }

  let logged = false;
  let logError: string | null = null;
  try {
    const { error } = (await db()
      .from("conversation_turns")
      .upsert(
        {
          contact_id: args.contactId,
          inbound_message_id: args.inboundMessageId ?? null,
          route: args.route,
          normalized_intent: args.intent ?? null,
          asked_field: args.askedField ?? null,
          question_signature: questionSignature(result.text),
          response_signature: responseSignature(args.inboundText ?? ""),
          action: result.verdict,
          state_before: args.stateBefore ?? null,
          state_after: args.stateAfter ?? null,
          facts_before: args.factsBefore ?? {},
          facts_after: args.factsAfter ?? {},
          progress_made: result.verdict === "send" ? true : result.verdict === "recovery",
          repeat_count: result.repeat_count,
          loop_signal: result.loop_signal,
          guard_verdict: result.verdict,
          guard_reason: result.reason,
          recovery_action: result.verdict === "send" ? null : result.verdict,
          phone_masked: maskPhone(args.phone ?? null),
          inbound_classification: args.classification ?? null,
          classification_confidence: args.classificationConfidence ?? null,
          source_type: args.sourceType ?? null,
          gate_applied: args.gateApplied ?? false,
          extracted_facts: args.extractedFacts ?? {},
        },
        { onConflict: "inbound_message_id,route", ignoreDuplicates: true } as any,
      )) ?? {};
    if (error) throw error;
    logged = true;
  } catch (err: any) {
    logged = false;
    logError = String(err?.message ?? err).slice(0, 300);
  }

  // A silent loop-history write failure is what turns a bad turn into an
  // endless loop: the guard loses its memory. Make it visible.
  if (!logged) {
    await quiet(
      db()
        .from("webhook_logs")
        .insert({
          source: "conversation_guard",
          status: "turn_log_failed",
          error: logError,
          payload: {
            contact_id: args.contactId,
            route: args.route,
            inbound_message_id: args.inboundMessageId ?? null,
            phone_masked: maskPhone(args.phone ?? null),
          },
        }),
    );
  }

  if (result.verdict !== "send" && mode === "enforce") {
    await quiet(
      db()
        .from("webhook_logs")
        .insert({
          source: "conversation_guard",
          status: `loop_prevented_${result.verdict}`,
          payload: {
            contact_id: args.contactId,
            phone_masked: maskPhone(args.phone ?? null),
            route: args.route,
            reason: result.reason,
            repeated_signature: result.question_signature,
            repeat_count: result.repeat_count,
            loop_signal: result.loop_signal,
            state: args.stateBefore ?? null,
          },
        }),
    );
  }

  return { ...result, logged };
}

/** Loop-safety counters for the Runtime / Zero-Loss screen (no PII). */
export async function loopSafetyStats(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data } = await db()
    .from("conversation_turns")
    .select("contact_id,guard_verdict,loop_signal,created_at")
    .gte("created_at", since)
    .limit(2000);
  const rows = ((data as any[]) ?? []);
  const prevented = rows.filter((r) => r.guard_verdict && r.guard_verdict !== "send").length;
  const recovering = new Set(rows.filter((r) => r.guard_verdict === "recovery").map((r) => r.contact_id)).size;
  return {
    window_hours: hours,
    turns: rows.length,
    loop_prevented: prevented,
    conversations_in_recovery: recovering,
    loop_signals: rows.filter((r) => r.loop_signal).length,
  };
}
