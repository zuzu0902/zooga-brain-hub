/**
 * Strict inbound-message idempotency for the Meta WhatsApp webhook.
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
      dedupe_source: "first_seen" | "retry_incomplete";
      /** true when a previous, never-completed attempt is being retried. */
      retry: boolean;
      attempt: number;
    }
  | {
      duplicate: true;
      inbound_message_id: string;
      cached_reply_text: string | null;
      contact_id: string | null;
      first_seen_at: string;
      hit_count: number;
      dedupe_source: "runtime_inbound_dedupe";
      /** completed = a reply was delivered or an explicit no-reply was recorded. */
      state: string;
      retry: false;
      attempt: number;
    };

/** A claimed-but-never-completed row may be retried once after this window. */
export const INCOMPLETE_RETRY_AFTER_MS = 60_000;
/** Total pipeline attempts allowed per inbound message id. */
export const MAX_INBOUND_ATTEMPTS = 2;

export function isCompletedDedupeRow(row: {
  state?: string | null;
  reply_text?: string | null;
  no_reply_reason?: string | null;
  completed_at?: string | null;
}): boolean {
  if (String(row.state ?? "") === "completed") return true;
  if (row.completed_at) return true;
  if (String(row.reply_text ?? "").trim()) return true;
  return !!String(row.no_reply_reason ?? "").trim();
}

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
 * Meta might send.
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
  now?: number;
}): Promise<InboundClaim> {
  const { inboundMessageId, contactId = null, phone = null, source = null } = args;
  const now = args.now ?? Date.now();

  const { error } = await supabaseAdmin
    .from("runtime_inbound_dedupe" as any)
    .insert({
      inbound_message_id: inboundMessageId,
      contact_id: contactId,
      phone,
      source,
      state: "claimed",
      attempt_count: 1,
    } as any);

  if (!error) {
    return {
      duplicate: false,
      inbound_message_id: inboundMessageId,
      dedupe_source: "first_seen",
      retry: false,
      attempt: 1,
    };
  }

  // Unique-violation OR any other insert error -> inspect the existing row.
  const { data: existing } = await supabaseAdmin
    .from("runtime_inbound_dedupe" as any)
    .select(
      "inbound_message_id, contact_id, reply_text, created_at, last_seen_at, hit_count, state, completed_at, attempt_count, no_reply_reason",
    )
    .eq("inbound_message_id", inboundMessageId)
    .maybeSingle();

  if (existing) {
    const row: any = existing;
    const nextHit = (Number(row.hit_count) || 1) + 1;
    const attempts = Number(row.attempt_count) || 1;
    const completed = isCompletedDedupeRow(row);
    const lastSeen = new Date(row.last_seen_at ?? row.created_at ?? 0).getTime();
    const stale = now - lastSeen >= INCOMPLETE_RETRY_AFTER_MS;
    // Only a COMPLETED turn suppresses. An incomplete, stale claim is allowed
    // to run the pipeline exactly once more so a crash never means silence.
    const mayRetry = !completed && stale && attempts < MAX_INBOUND_ATTEMPTS;

    await supabaseAdmin
      .from("runtime_inbound_dedupe" as any)
      .update({
        last_seen_at: new Date(now).toISOString(),
        hit_count: nextHit,
        ...(mayRetry ? { attempt_count: attempts + 1, state: "claimed" } : {}),
      } as any)
      .eq("inbound_message_id", inboundMessageId);

    if (mayRetry) {
      return {
        duplicate: false,
        inbound_message_id: inboundMessageId,
        dedupe_source: "retry_incomplete",
        retry: true,
        attempt: attempts + 1,
      };
    }

    return {
      duplicate: true,
      inbound_message_id: inboundMessageId,
      cached_reply_text: row.reply_text ?? null,
      contact_id: row.contact_id ?? null,
      first_seen_at: row.created_at,
      hit_count: nextHit,
      dedupe_source: "runtime_inbound_dedupe",
      state: completed ? "completed" : String(row.state ?? "claimed"),
      retry: false,
      attempt: attempts,
    };
  }

  // Insert failed AND no existing row - never silently drop a real message.
  return {
    duplicate: false,
    inbound_message_id: inboundMessageId,
    dedupe_source: "first_seen",
    retry: false,
    attempt: 1,
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
  const text = (replyText ?? "").trim();
  await supabaseAdmin
    .from("runtime_inbound_dedupe" as any)
    .update({
      reply_text: replyText ?? null,
      // An empty body is NOT a completed turn: keep it retryable.
      ...(text ? { state: "completed", completed_at: new Date().toISOString() } : {}),
    } as any)
    .eq("inbound_message_id", inboundMessageId);
}

/**
 * Close a turn that legitimately produced no outbound message (opt-out,
 * unsupported type, human-owned...). Only an allowlisted reason completes.
 */
export async function markNoReply(inboundMessageId: string, reason: string): Promise<void> {
  if (!inboundMessageId || !reason) return;
  await supabaseAdmin
    .from("runtime_inbound_dedupe" as any)
    .update({
      state: "completed",
      completed_at: new Date().toISOString(),
      no_reply_reason: reason,
    } as any)
    .eq("inbound_message_id", inboundMessageId);
}
