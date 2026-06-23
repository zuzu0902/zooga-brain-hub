/**
 * Strict inbound-message idempotency for Railway runtime + Meta webhook.
 *
 * Single source of truth: `public.runtime_inbound_dedupe` keyed by the
 * inbound WhatsApp message id (wamid...). The Meta Cloud API retries a
 * webhook delivery whenever it does not see a fast 200, and inside our own
 * pipeline an after-send failure can re-enter the same inbound. Both paths
 * must hit this ledger BEFORE generating or sending a reply.
 *
 * Usage:
 *   const claim = await claimInbound({ inboundMessageId, ... });
 *   if (claim.duplicate) return cachedReply / 200 ok, do not send again.
 *   ... generate + send ...
 *   await recordReply(inboundMessageId, replyText);
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type InboundClaim =
  | {
      duplicate: false;
      inbound_message_id: string;
      dedupe_source: "first_seen";
    }
  | {
      duplicate: true;
      inbound_message_id: string;
      cached_reply_text: string | null;
      contact_id: string | null;
      first_seen_at: string;
      hit_count: number;
      dedupe_source: "runtime_inbound_dedupe";
    };

function pickInboundMessageId(...candidates: any[]): string | null {
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s) return s;
  }
  return null;
}

/**
 * Extract a wamid / message id from any common payload shape Meta or
 * Railway might send.
 */
export function extractInboundMessageId(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;
  return pickInboundMessageId(
    payload.inbound_message_id,
    payload.message_id,
    payload.wamid,
    payload.id,
    payload.message?.id,
    payload.messages?.[0]?.id,
    payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id,
  );
}

/**
 * Atomically claim an inbound message id. Race-safe via the primary key
 * unique constraint: a duplicate insert raises 23505, which we treat as
 * "already processed" and return the cached reply.
 */
export async function claimInbound(args: {
  inboundMessageId: string;
  contactId?: string | null;
  phone?: string | null;
  source?: string | null;
}): Promise<InboundClaim> {
  const { inboundMessageId, contactId = null, phone = null, source = null } = args;

  const { error } = await supabaseAdmin
    .from("runtime_inbound_dedupe" as any)
    .insert({
      inbound_message_id: inboundMessageId,
      contact_id: contactId,
      phone,
      source,
    } as any);

  if (!error) {
    return {
      duplicate: false,
      inbound_message_id: inboundMessageId,
      dedupe_source: "first_seen",
    };
  }

  // Unique-violation OR any other insert error → look up the existing row.
  // We bias toward "treat as duplicate" so we never double-send on failure.
  const { data: existing } = await supabaseAdmin
    .from("runtime_inbound_dedupe" as any)
    .select("inbound_message_id, contact_id, reply_text, created_at, hit_count")
    .eq("inbound_message_id", inboundMessageId)
    .maybeSingle();

  if (existing) {
    const nextHit = (Number((existing as any).hit_count) || 1) + 1;
    await supabaseAdmin
      .from("runtime_inbound_dedupe" as any)
      .update({
        last_seen_at: new Date().toISOString(),
        hit_count: nextHit,
      } as any)
      .eq("inbound_message_id", inboundMessageId);
    return {
      duplicate: true,
      inbound_message_id: inboundMessageId,
      cached_reply_text: (existing as any).reply_text ?? null,
      contact_id: (existing as any).contact_id ?? null,
      first_seen_at: (existing as any).created_at,
      hit_count: nextHit,
      dedupe_source: "runtime_inbound_dedupe",
    };
  }

  // Insert failed AND no existing row — surface as first_seen so we don't
  // silently drop a real message. Pipeline keeps going.
  return {
    duplicate: false,
    inbound_message_id: inboundMessageId,
    dedupe_source: "first_seen",
  };
}

/**
 * Persist the final reply text on the dedupe row so a later retry of the
 * same inbound message id can short-circuit with the SAME reply (not a
 * regenerated, possibly different one).
 */
export async function recordReply(
  inboundMessageId: string,
  replyText: string | null,
): Promise<void> {
  if (!inboundMessageId) return;
  await supabaseAdmin
    .from("runtime_inbound_dedupe" as any)
    .update({ reply_text: replyText ?? null } as any)
    .eq("inbound_message_id", inboundMessageId);
}