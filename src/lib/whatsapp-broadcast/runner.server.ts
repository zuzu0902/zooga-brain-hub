/**
 * ZOOGA OS — WhatsApp group broadcast runner (server-only).
 *
 * Executes queued broadcasts through the Alex Personal WhatsApp Web bridge
 * (Gateway proxy). Tamar / Meta Cloud API is never used here.
 *
 * Safety properties:
 *  - single-flight: a database lease with an expiry; a concurrent run exits.
 *  - bounded work per run: target cap + wall-clock budget.
 *  - idempotent: each target is marked immediately; `sent` targets are skipped,
 *    and the bridge gets a stable idempotency key per (broadcast, group).
 *  - paced: waits `interval_seconds` between groups to avoid platform blocks.
 */
import { canOwnGroupBroadcast, clampIntervalSeconds, broadcastIdempotencyKey } from "./core";
import { fetchBridgeStatus, sendGroupMessage } from "@/lib/zooga-whatsapp-bridge/bridge-client.server";

const LEASE_SECONDS = 300;
const MAX_TARGETS_PER_RUN = 40;
const DEFAULT_BUDGET_MS = 50_000;

/** Reasons that abort the whole run and keep the remaining targets pending. */
const STOP_RUN_CODES = new Set([
  "bridge_unauthorized",
  "bridge_unreachable",
  "bridge_server_not_configured",
  "not_connected",
  "send_route_unavailable",
  "min_interval",
  "per_minute_cap",
]);

export type RunnerResult = {
  ok: boolean;
  broadcast_id: string | null;
  sent: number;
  failed: number;
  remaining: number;
  status: string | null;
  reason: string | null;
};

const idle = (reason: string): RunnerResult => ({
  ok: true,
  broadcast_id: null,
  sent: 0,
  failed: 0,
  remaining: 0,
  status: null,
  reason,
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** Pick one due broadcast and take its lease. Returns null when nothing to do. */
async function claimBroadcast(client: any, broadcastId: string | null, owner: string) {
  const nowIso = new Date().toISOString();
  let q = client
    .from("whatsapp_broadcasts")
    .select("id, connection_id, message_text, media_url, interval_seconds, status, scheduled_for, lease_expires_at")
    .in("status", ["queued", "running"])
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${nowIso}`)
    .order("scheduled_for", { ascending: true, nullsFirst: true })
    .limit(1);
  if (broadcastId) q = q.eq("id", broadcastId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0];
  if (!row) return null;

  const leaseUntil = new Date(Date.now() + LEASE_SECONDS * 1000).toISOString();
  const { data: locked, error: lockErr } = await client
    .from("whatsapp_broadcasts")
    .update({
      status: "running",
      lease_owner: owner,
      lease_expires_at: leaseUntil,
      last_run_at: nowIso,
      started_at: row.status === "running" ? undefined : nowIso,
    })
    .eq("id", row.id)
    .in("status", ["queued", "running"])
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${nowIso}`)
    .select("id")
    .maybeSingle();
  if (lockErr) throw new Error(lockErr.message);
  if (!locked) return null;
  return row;
}

async function releaseLease(client: any, id: string, patch: Record<string, unknown> = {}) {
  await client
    .from("whatsapp_broadcasts")
    .update({ lease_owner: null, lease_expires_at: null, ...patch })
    .eq("id", id);
}

async function refreshCounts(client: any, id: string) {
  const { data } = await client.from("whatsapp_broadcast_targets").select("status").eq("broadcast_id", id);
  const rows = (data ?? []) as { status: string }[];
  const sent = rows.filter((r) => r.status === "sent").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const pending = rows.length - sent - failed - skipped;
  await client
    .from("whatsapp_broadcasts")
    .update({ success_count: sent, failed_count: failed, pending_count: pending })
    .eq("id", id);
  return { sent, failed, pending, total: rows.length };
}

/**
 * Runs at most one broadcast. Call repeatedly (cron every minute) until idle.
 */
export async function runBroadcastQueue(
  opts: { broadcastId?: string | null; budgetMs?: number; maxTargets?: number } = {},
): Promise<RunnerResult> {
  const client = await db();
  const owner = `runner-${Math.random().toString(36).slice(2, 10)}`;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxTargets = opts.maxTargets ?? MAX_TARGETS_PER_RUN;
  const deadline = Date.now() + budgetMs;

  const broadcast = await claimBroadcast(client, opts.broadcastId ?? null, owner);
  if (!broadcast) return idle(opts.broadcastId ? "not_due_or_locked" : "nothing_due");

  const id = broadcast.id as string;
  try {
    // Transport separation: group broadcasts only through the Alex bridge.
    const { data: conn } = await client
      .from("whatsapp_connections")
      .select("id, transport, purpose")
      .eq("id", broadcast.connection_id)
      .maybeSingle();
    if (!canOwnGroupBroadcast(conn)) {
      await releaseLease(client, id, { status: "queued", last_error: "connection_not_group_capable" });
      return { ...idle("connection_not_group_capable"), ok: false, broadcast_id: id };
    }

    const status = await fetchBridgeStatus();
    if (!status.connected) {
      const reason = status.error_code ?? "bridge_not_connected";
      await releaseLease(client, id, { status: "queued", last_error: reason });
      return { ...idle(reason), ok: false, broadcast_id: id };
    }

    const { data: targets } = await client
      .from("whatsapp_broadcast_targets")
      .select("id, group_id, whatsapp_chat_id_snapshot, status")
      .eq("broadcast_id", id)
      .in("status", ["pending", "queued"])
      .order("send_order", { ascending: true })
      .limit(maxTargets);

    const interval = clampIntervalSeconds(broadcast.interval_seconds);
    const text = String(broadcast.message_text ?? "");
    const mediaUrl = broadcast.media_url ?? null;

    let sent = 0;
    let failed = 0;
    let lastError: string | null = null;
    let stopped = false;
    const list = (targets ?? []) as any[];

    for (let i = 0; i < list.length; i++) {
      if (Date.now() > deadline) break;
      const t = list[i];
      const res = await sendGroupMessage({
        chat_id: String(t.whatsapp_chat_id_snapshot ?? ""),
        text,
        media_url: mediaUrl,
        idempotency_key: broadcastIdempotencyKey(id, String(t.group_id)),
      });

      if (res.ok) {
        sent++;
        await client
          .from("whatsapp_broadcast_targets")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error_text: null,
            external_response: { message_id: res.message_id, duplicate: res.duplicate },
          })
          .eq("id", t.id);
      } else {
        lastError = res.code;
        // Infrastructure problems (auth, session, unreachable gateway, missing
        // send route) stop the whole run and leave every target pending, so a
        // later run retries them instead of burning them as failures.
        if (STOP_RUN_CODES.has(res.code)) {
          stopped = true;
          break;
        }
        failed++;
        await client
          .from("whatsapp_broadcast_targets")
          .update({ status: "failed", error_text: res.code })
          .eq("id", t.id);
      }

      if (i < list.length - 1) {
        if (Date.now() + interval * 1000 > deadline) break;
        await sleep(interval * 1000);
      }
    }

    const counts = await refreshCounts(client, id);
    const finished = !stopped && counts.pending === 0;
    // A stopped run goes back to the queue so the next run (or Send Now) retries.
    const finalStatus = stopped
      ? "queued"
      : finished
        ? counts.failed > 0
          ? "completed_with_errors"
          : "completed"
        : "running";
    await releaseLease(client, id, {
      status: finalStatus,
      last_error: lastError,
      ...(finished ? { finished_at: new Date().toISOString() } : {}),
    });

    return {
      ok: !stopped,
      broadcast_id: id,
      sent,
      failed,
      remaining: counts.pending,
      status: finalStatus,
      reason: lastError,
    };
  } catch (e: any) {
    await releaseLease(client, id, { last_error: String(e?.message ?? e).slice(0, 300) });
    return {
      ok: false,
      broadcast_id: id,
      sent: 0,
      failed: 0,
      remaining: 0,
      status: null,
      reason: "runner_error",
    };
  }
}
