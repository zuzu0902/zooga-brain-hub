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
import {
  evaluateOutbound,
  questionSignature,
  responseSignature,
  type GuardResult,
  type ProgressFlags,
  type TurnRecord,
} from "./core";

const db = () => supabaseAdmin as any;

export async function recentTurns(contactId: string, limit = 5): Promise<TurnRecord[]> {
  const { data } = await db()
    .from("conversation_turns")
    .select("asked_field,question_signature,response_signature,normalized_intent,progress_made,repeat_count,created_at")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data as any[]) ?? []) as TurnRecord[];
}

export type GuardedTurn = GuardResult & { logged: boolean };

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
}): Promise<GuardedTurn> {
  const recent = args.contactId ? await recentTurns(args.contactId).catch(() => []) : [];
  const result = evaluateOutbound({
    candidateText: args.candidateText,
    askedField: args.askedField ?? null,
    inboundText: args.inboundText ?? null,
    recentTurns: recent,
    progress: args.progress ?? null,
    summary: args.summary ?? null,
    purpose: args.purpose ?? null,
  });

  let logged = false;
  try {
    await db()
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
        },
        { onConflict: "inbound_message_id,route", ignoreDuplicates: false } as any,
      );
    logged = true;
  } catch {
    logged = false;
  }

  if (result.verdict !== "send") {
    await db()
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
      })
      .catch(() => null);
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
