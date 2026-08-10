/**
 * RECOVERY FALLBACK — server wiring.
 *
 * Called from the reply pipeline when the decision layer failed but the vault
 * and the database are healthy. Sends at most ONE customer-safe message per
 * inbound provider message id (enforced by the guard's replay path), keeps the
 * processing job retryable for internal repair, and stays completely silent on
 * every documented no-reply path.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isSessionWindowOpen, recordDelivery, sendWhatsAppText, toE164 } from "@/lib/whatsapp-meta.server";
import { recordReply } from "@/lib/runtime-inbound-dedupe";
import { maskPhone } from "@/lib/zero-loss/core";
import { guardOutbound, recentTurns } from "./guard.server";
import { buildFallbackText, classifyFailureKind, decideRecoveryFallback, type FailureKind } from "./fallback";

export const FALLBACK_ROUTE = "recovery_fallback";

const db = () => supabaseAdmin as any;

async function contactPolicy(contactId: string | null) {
  if (!contactId) return { optedOut: false, humanOwned: false };
  const { data } = await db()
    .from("contacts")
    .select("opted_out_at,consent_status,human_owned,conversation_state")
    .eq("id", contactId)
    .maybeSingle();
  const c = (data as any) ?? {};
  return {
    optedOut: !!c.opted_out_at || c.consent_status === "denied" || c.conversation_state === "opted_out",
    humanOwned: !!c.human_owned || c.conversation_state === "human_owned",
  };
}

export type FallbackOutcome = {
  sent: boolean;
  /** Documented reason, always present (send reason or no-reply reason). */
  reason: string;
  failure_kind: FailureKind | null;
  provider_message_id?: string | null;
};

export async function maybeSendRecoveryFallback(args: {
  contactId: string | null;
  phone: string;
  inboundMessageId?: string | null;
  inboundText?: string | null;
  error: unknown;
  noReplyReason?: string | null;
  suppressed?: boolean;
}): Promise<FallbackOutcome> {
  const failureKind = classifyFailureKind(args.error);
  const to = toE164(args.phone);
  const policy = await contactPolicy(args.contactId).catch(() => null);
  // A null policy read means the DB is not trustworthy right now -> silence.
  const infraAvailable = policy !== null;
  const windowOpen = !!args.inboundMessageId || (await isSessionWindowOpen(args.contactId).catch(() => false));

  const decision = decideRecoveryFallback({
    failureKind,
    noReplyReason: args.noReplyReason ?? null,
    contactId: args.contactId,
    infraAvailable,
    optedOut: policy?.optedOut,
    humanOwned: policy?.humanOwned,
    suppressed: args.suppressed,
    validRecipient: !!to,
    windowOpen,
    hasTemplate: false,
  });

  if (!decision.send) {
    await db()
      .from("webhook_logs")
      .insert({
        source: "conversation_guard",
        status: "recovery_fallback_skipped",
        payload: {
          phone_masked: maskPhone(args.phone),
          inbound_message_id: args.inboundMessageId ?? null,
          failure_kind: failureKind,
          no_reply_reason: decision.reason,
        },
      })
      .catch(() => null);
    return { sent: false, reason: decision.reason, failure_kind: failureKind };
  }

  const history = await recentTurns(args.contactId, 3, args.phone).catch(() => []);
  const candidate = buildFallbackText(history[0]?.question_signature ?? null);

  // The guard is the single owner of the outbound: a retry of the same
  // inbound message replays the recorded verdict and never sends twice.
  const guard = await guardOutbound({
    contactId: args.contactId,
    phone: to,
    route: FALLBACK_ROUTE,
    inboundMessageId: args.inboundMessageId ?? null,
    inboundText: args.inboundText ?? null,
    candidateText: candidate,
    mode: "log_only",
    progress: { clarified_ambiguity: true },
  });
  if (guard.replayed) {
    return { sent: false, reason: "fallback_already_sent", failure_kind: failureKind };
  }

  const send = await sendWhatsAppText(to!, guard.text);
  await recordDelivery({
    contactId: args.contactId,
    text: guard.text,
    result: send,
    inboundMessageId: args.inboundMessageId ?? null,
    kind: "recovery_fallback",
  }).catch(() => null);
  if (send.ok) await recordReply(args.inboundMessageId ?? "", guard.text).catch(() => {});

  return {
    sent: send.ok,
    reason: send.ok ? decision.reason : "meta_send_failed",
    failure_kind: failureKind,
    provider_message_id: send.provider_message_id ?? null,
  };
}