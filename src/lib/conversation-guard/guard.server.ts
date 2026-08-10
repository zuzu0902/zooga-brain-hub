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

export type GuardedTurn = GuardResult & { logged: boolean; replayed?: boolean };

/**
 * `enforce`  — the guard may rewrite/suppress the candidate (conversational
 *              routes that ask questions).
 * `log_only` — compliance-critical acknowledgements (consent, opt-out/in,
 *              voice failure). The turn is recorded so the loop history stays
 *              complete, but the text is NEVER rewritten.
 */
export type GuardMode = "enforce" | "log_only";

/**
 * One inbound provider message id may produce at most ONE guarded outbound
 * per route. A webhook retry that reaches the same route again replays the
 * previously recorded verdict instead of evaluating (and mutating) twice.
 */
async function existingTurn(inboundMessageId: string | null | undefined, route: string) {
  if (!inboundMessageId) return null;
  const { data } = await db()
    .from("conversation_turns")
    .select("guard_verdict,guard_reason,repeat_count,loop_signal,question_signature")
    .eq("inbound_message_id", inboundMessageId)
    .eq("route", route)
    .maybeSingle();
  return (data as any) ?? null;
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
}): Promise<GuardedTurn> {
  const mode: GuardMode = args.mode ?? "enforce";

  // ---- double-guard / double-send protection -------------------------
  const prior = await existingTurn(args.inboundMessageId, args.route).catch(() => null);
  if (prior) {
    const verdict = (prior.guard_verdict ?? "send") as GuardResult["verdict"];
    return {
      verdict,
      reason: `replayed:${prior.guard_reason ?? "unknown"}`,
      repeat_count: Number(prior.repeat_count ?? 0),
      question_signature: prior.question_signature ?? questionSignature(args.candidateText),
      loop_signal: !!prior.loop_signal,
      // The stored verdict is re-applied; the candidate is never re-mutated.
      text: args.candidateText,
      logged: true,
      replayed: true,
    };
  }

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

  if (mode === "log_only") {
    result.text = args.candidateText;
  }

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
        { onConflict: "inbound_message_id,route", ignoreDuplicates: true } as any,
      );
    logged = true;
  } catch {
    logged = false;
  }

  if (result.verdict !== "send" && mode === "enforce") {
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
