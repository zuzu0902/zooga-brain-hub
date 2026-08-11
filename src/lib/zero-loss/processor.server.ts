/**
 * IDEMPOTENT VAULT-EVENT PROCESSOR (server-only).
 *
 * Given a durable vault row, guarantee the *recoverable* side effects:
 *  - the phone is registered in the identity registry
 *  - a contact exists and is linked back to the vault row
 *  - status callbacks are applied to the outbound ledger
 *
 * Re-running it is always safe. The conversational reply itself stays in the
 * live webhook path; on retry the reply is only queued in the outbound
 * ledger (allowSend=false) so no duplicate WhatsApp message is ever sent.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveIdentity } from "./identity.server";
import { applyLedgerStatus } from "./outbox.server";

export type ProcessOutcome = {
  kind: "message" | "status" | "unknown";
  contact_id: string | null;
  identity_id: string | null;
  /** Set for message events: did this run leave the customer answered? */
  replied?: boolean;
  no_reply_reason?: string | null;
  inbound_message_id?: string | null;
};

/**
 * Re-run the conversational reply for a message event whose turn never
 * completed (crash / send failure after the webhook already acked).
 * Idempotent: a dedupe row that is already `completed` is never re-sent.
 */
async function recoverReply(args: {
  contactId: string;
  phone: string;
  text: string;
  wamid: string | null;
  name?: string | null;
}): Promise<{ replied: boolean; no_reply_reason: string | null }> {
  const { isCompletedDedupeRow, recordReply, markNoReply } = await import("@/lib/runtime-inbound-dedupe");
  if (args.wamid) {
    const { data: dedupe } = await supabaseAdmin
      .from("runtime_inbound_dedupe" as any)
      .select("state, reply_text, completed_at, no_reply_reason")
      .eq("inbound_message_id", args.wamid)
      .maybeSingle();
    if (dedupe && isCompletedDedupeRow(dedupe as any)) {
      return { replied: true, no_reply_reason: null };
    }
    if (!dedupe) {
      // The webhook crashed before claiming: own the turn now.
      await supabaseAdmin
        .from("runtime_inbound_dedupe" as any)
        .insert({
          inbound_message_id: args.wamid,
          contact_id: args.contactId,
          phone: args.phone,
          source: "zero_loss_worker",
          state: "claimed",
          attempt_count: 1,
        } as any);
    }
  }
  const { runV2Turn } = await import("@/lib/tamar-v2/engine.server");
  const v2 = await runV2Turn({
    phone: args.phone,
    message: args.text,
    name: args.name ?? undefined,
    inbound_message_id: args.wamid ?? undefined,
    source: "zero_loss_worker",
  } as any);
  const sentAll = v2.sends.length > 0 && v2.sends.every((s: any) => s.ok);
  if (sentAll) {
    if (args.wamid) await recordReply(args.wamid, v2.decision.messages.map((m: any) => m.body).join("\n")).catch(() => {});
    return { replied: true, no_reply_reason: null };
  }
  const { isValidNoReplyReason } = await import("./turn-outcome");
  if (isValidNoReplyReason(v2.no_reply_reason)) {
    if (args.wamid) await markNoReply(args.wamid, String(v2.no_reply_reason)).catch(() => {});
    return { replied: false, no_reply_reason: String(v2.no_reply_reason) };
  }
  const { maybeSendRecoveryFallback } = await import("@/lib/conversation-guard/fallback.server");
  const fb = await maybeSendRecoveryFallback({
    contactId: args.contactId,
    phone: args.phone,
    inboundMessageId: args.wamid,
    inboundText: args.text,
    error: v2.no_reply_reason ?? "worker_no_outbound",
  }).catch(() => null);
  if (fb?.sent) return { replied: true, no_reply_reason: null };
  return { replied: false, no_reply_reason: null };
}

export async function processVaultEvent(args: {
  vaultId: string;
  jobId: string | null;
  attempt: number;
  allowSend?: boolean;
}): Promise<ProcessOutcome> {
  const { data } = await supabaseAdmin
    .from("inbound_event_vault" as any)
    .select("id, event_type, raw_payload, normalized_phone")
    .eq("id", args.vaultId)
    .maybeSingle();
  const row: any = data;
  if (!row) throw new Error("vault_row_missing");

  const eventType = String(row.event_type ?? "unknown");

  if (eventType.startsWith("status.")) {
    const providerId = row.raw_payload?.status?.id ? String(row.raw_payload.status.id) : null;
    const status = String(row.raw_payload?.status?.status ?? "");
    if (providerId && status) await applyLedgerStatus(providerId, status);
    return { kind: "status", contact_id: null, identity_id: null };
  }

  if (!eventType.startsWith("message.")) {
    throw new Error("unknown_event_shape");
  }

  const displayName =
    row.raw_payload?.contacts?.[0]?.profile?.name ? String(row.raw_payload.contacts[0].profile.name) : null;
  const resolution = await resolveIdentity({
    phone: row.normalized_phone,
    displayName,
    source: "meta_whatsapp",
  });
  if (!resolution.normalized_phone) throw new Error("invalid_phone");
  // A message event is only recoverable once it owns a real contact row.
  // Without it the job stays retryable instead of being closed as succeeded.
  if (!resolution.contact_id) throw new Error("contact_resolution_failed: contact_missing");

  await supabaseAdmin
    .from("inbound_event_vault" as any)
    .update({ contact_id: resolution.contact_id } as any)
    .eq("id", args.vaultId);

  const wamid = row.raw_payload?.message?.id
    ? String(row.raw_payload.message.id)
    : row.raw_payload?.messages?.[0]?.id
      ? String(row.raw_payload.messages[0].id)
      : null;
  const text =
    row.raw_payload?.message?.text?.body ??
    row.raw_payload?.messages?.[0]?.text?.body ??
    row.raw_payload?.message?.button?.text ??
    null;

  let replied: boolean | undefined;
  let noReplyReason: string | null = null;
  if (args.allowSend && text) {
    const rec = await recoverReply({
      contactId: resolution.contact_id,
      phone: resolution.normalized_phone!,
      text: String(text),
      wamid,
      name: displayName,
    });
    replied = rec.replied;
    noReplyReason = rec.no_reply_reason;
  }

  return {
    kind: "message",
    contact_id: resolution.contact_id,
    identity_id: resolution.identity_id,
    replied,
    no_reply_reason: noReplyReason,
    inbound_message_id: wamid,
  };
}