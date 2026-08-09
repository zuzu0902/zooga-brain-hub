/**
 * OUTBOUND EVENT LEDGER (server-only).
 *
 * Every outbound WhatsApp message is first written to the ledger with an
 * idempotency key. A duplicate key means the message was already queued or
 * sent, so no second send happens. Nothing here sends by itself — the send
 * is performed by the caller/worker and reported back through markSent().
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone } from "./core";
import { sha256 } from "./vault.server";

export type OutboxEnqueue = {
  contactId: string | null;
  phone: string | null;
  text: string;
  kind?: string;
  correlationId?: string | null;
  vaultEventId?: string | null;
  /** Stable key; defaults to inbound event + body hash. */
  idempotencyKey?: string;
};

export type OutboxRow = { id: string; duplicate: boolean; idempotency_key: string };

export function buildIdempotencyKey(args: {
  phone: string | null;
  text: string;
  kind: string;
  vaultEventId?: string | null;
}): string {
  const scope = args.vaultEventId ?? "adhoc";
  return `${scope}:${args.kind}:${sha256(`${normalizePhone(args.phone) ?? ""}|${args.text}`).slice(0, 32)}`;
}

/** Queue an outbound message. Returns duplicate=true when already queued. */
export async function enqueueOutbound(args: OutboxEnqueue): Promise<OutboxRow | null> {
  const kind = args.kind ?? "reply";
  const key = args.idempotencyKey ?? buildIdempotencyKey({ phone: args.phone, text: args.text, kind, vaultEventId: args.vaultEventId ?? null });
  const e164 = normalizePhone(args.phone);
  const { data, error } = await supabaseAdmin
    .from("outbound_event_ledger" as any)
    .insert({
      contact_id: args.contactId,
      normalized_phone: e164,
      kind,
      request_hash: sha256(args.text).slice(0, 64),
      idempotency_key: key,
      body_preview: args.text.slice(0, 240),
      correlation_id: args.correlationId ?? null,
      vault_event_id: args.vaultEventId ?? null,
    } as any)
    .select("id")
    .maybeSingle();

  if (!error && (data as any)?.id) return { id: String((data as any).id), duplicate: false, idempotency_key: key };

  const { data: existing } = await supabaseAdmin
    .from("outbound_event_ledger" as any)
    .select("id")
    .eq("idempotency_key", key)
    .maybeSingle();
  if ((existing as any)?.id) return { id: String((existing as any).id), duplicate: true, idempotency_key: key };
  return null;
}

/** Record the transport outcome for a queued outbound row. */
export async function markOutboundResult(
  ledgerId: string | null,
  result: { ok: boolean; provider_message_id: string | null; error: string | null },
): Promise<void> {
  if (!ledgerId) return;
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("outbound_event_ledger" as any)
    .update(
      result.ok
        ? { state: "sent", sent_at: now, provider_message_id: result.provider_message_id, last_error: null }
        : { state: "failed", failed_at: now, last_error: (result.error ?? "send_failed").slice(0, 300) },
    )
    .eq("id", ledgerId);
}

/** Apply a Meta delivery callback onto the ledger. */
export async function applyLedgerStatus(providerMessageId: string, status: string): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { state: status };
  if (status === "delivered") patch.delivered_at = now;
  if (status === "read") patch.read_at = now;
  if (status === "failed") patch.failed_at = now;
  if (!["sent", "delivered", "read", "failed"].includes(status)) return;
  await supabaseAdmin.from("outbound_event_ledger" as any).update(patch as any).eq("provider_message_id", providerMessageId);
}