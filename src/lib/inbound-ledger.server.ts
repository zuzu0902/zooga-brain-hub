/**
 * INBOUND LEDGER — the single, reliable way an inbound WhatsApp message is
 * persisted to the operational tables.
 *
 * Why this exists: `upsert(..., { onConflict: "provider_message_id" })` cannot
 * be used here. The unique indexes on `messages` / `interactions` are PARTIAL
 * (`WHERE provider_message_id IS NOT NULL`), so Postgres refuses the inferred
 * ON CONFLICT target and the whole write throws. The old call sites swallowed
 * that error, so NO inbound row was ever written — which in turn made the 24h
 * service window look permanently closed.
 *
 * Idempotency is therefore done explicitly: look the provider message id up,
 * insert when absent, and treat a unique violation as success.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WINDOW_MS = 24 * 60 * 60 * 1000;

async function logFailure(status: string, payload: Record<string, unknown>, err: unknown) {
  try {
    await supabaseAdmin.from("webhook_logs").insert({
      source: "inbound_ledger",
      status,
      error: String((err as any)?.message ?? err).slice(0, 300),
      payload,
    } as any);
  } catch {
    /* logging must never break a turn */
  }
}

function isUniqueViolation(err: any): boolean {
  return String(err?.code ?? "") === "23505";
}

async function alreadyRecorded(table: "messages" | "interactions", pid: string | null): Promise<boolean> {
  if (!pid) return false;
  const { data } = await supabaseAdmin
    .from(table)
    .select("id")
    .eq("provider_message_id", pid)
    .limit(1);
  return !!(data as any[])?.length;
}

export type InboundLedgerArgs = {
  contactId: string | null;
  text: string;
  /** WhatsApp provider message id (wamid) — the idempotency key */
  inboundMessageId?: string | null;
  /** interactions.source, e.g. "inbound_text" | "inbound_button" | "tamar_inbound" */
  source?: string;
  /** original message time; defaults to now */
  occurredAt?: string | null;
};

/**
 * Persist one inbound message exactly once (messages + interactions) and open
 * the 24h service window on the contact row.
 */
export async function recordInboundLedger(args: InboundLedgerArgs): Promise<{ inserted: boolean }> {
  if (!args.contactId) return { inserted: false };
  const pid = args.inboundMessageId ?? null;
  const text = String(args.text ?? "").slice(0, 4000);
  const source = args.source ?? "tamar_inbound";
  const at = args.occurredAt ?? new Date().toISOString();
  let inserted = false;

  try {
    if (!(await alreadyRecorded("messages", pid))) {
      const { error } = await supabaseAdmin.from("messages").insert({
        contact_id: args.contactId,
        channel: "WhatsApp",
        message_text: text,
        reply_text: text,
        status: "replied",
        provider_message_id: pid,
      } as any);
      if (error && !isUniqueViolation(error)) throw error;
    }
  } catch (err) {
    await logFailure("inbound_message_write_failed", { contact_id: args.contactId, inbound_message_id: pid }, err);
  }

  try {
    if (!(await alreadyRecorded("interactions", pid))) {
      const { error } = await supabaseAdmin.from("interactions").insert({
        contact_id: args.contactId,
        type: "whatsapp_message",
        source,
        content: text.slice(0, 2000),
        provider_message_id: pid,
        timestamp: at,
      } as any);
      if (error && !isUniqueViolation(error)) throw error;
      inserted = !error;
    }
  } catch (err) {
    await logFailure("inbound_interaction_write_failed", { contact_id: args.contactId, inbound_message_id: pid }, err);
  }

  await touchServiceWindow(args.contactId, at);
  return { inserted };
}

/** Open / extend the Meta 24h customer-service window on the contact row. */
export async function touchServiceWindow(contactId: string | null, at?: string | null): Promise<void> {
  if (!contactId) return;
  const t = at ? new Date(at) : new Date();
  const iso = Number.isFinite(t.getTime()) ? t.toISOString() : new Date().toISOString();
  try {
    await supabaseAdmin
      .from("contacts")
      .update({
        last_inbound_at: iso,
        last_interaction_at: iso,
        service_window_open_until: new Date(new Date(iso).getTime() + WINDOW_MS).toISOString(),
      } as any)
      .eq("id", contactId);
  } catch (err) {
    await logFailure("service_window_touch_failed", { contact_id: contactId }, err);
  }
}
