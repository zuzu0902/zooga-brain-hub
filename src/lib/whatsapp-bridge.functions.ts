/**
 * ZOOGA OS — admin-gated server functions for the external WhatsApp Web bridge
 * (Alex Personal identity only). The browser never calls the bridge directly.
 *
 * Live sending is NOT wired here: broadcasts remain control-plane only until
 * ZOOGA_WHATSAPP_BRIDGE_LIVE=true and an explicit send milestone.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ALEX_CONNECTION_KEY } from "@/lib/whatsapp-broadcast/core";
import {
  computeGroupSyncPlan,
  type BridgeStatus,
  type ExistingGroupRow,
} from "@/lib/zooga-whatsapp-bridge/bridge-contract";

async function assertAdmin(context: any): Promise<string> {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("forbidden");
  return context.userId as string;
}

async function bridge() {
  return import("@/lib/zooga-whatsapp-bridge/bridge-client.server");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const getBridgeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BridgeStatus> => {
    await assertAdmin(context);
    return (await bridge()).fetchBridgeStatus();
  });

export const connectBridge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BridgeStatus> => {
    await assertAdmin(context);
    return (await bridge()).startBridgeConnection();
  });

export const getBridgeQr = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    return (await bridge()).fetchBridgeQr();
  });

export const disconnectBridgeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BridgeStatus> => {
    await assertAdmin(context);
    return (await bridge()).disconnectBridge();
  });

export const logoutBridgeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { confirm: string }) => d)
  .handler(async ({ context, data }): Promise<BridgeStatus> => {
    await assertAdmin(context);
    if (data.confirm !== "alex-personal") throw new Error("logout_confirmation_required");
    return (await bridge()).logoutBridge();
  });

export const listBridgeGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    return (await bridge()).fetchBridgeGroups();
  });

/**
 * Syncs `whatsapp_groups` for the Alex Personal bridge connection ONLY.
 * Never deletes or archives groups; missing groups are only counted in the log.
 * Never persists participants or phone numbers.
 */
export const syncBridgeGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { fetchBridgeGroups } = await bridge();
    const remote = await fetchBridgeGroups();
    if (!remote.ok) return { ok: false as const, code: remote.code };

    const db = await admin();
    const { data: conn, error: connErr } = await db
      .from("whatsapp_connections")
      .select("id, transport, purpose")
      .eq("connection_key", ALEX_CONNECTION_KEY)
      .maybeSingle();
    if (connErr) throw new Error(connErr.message);
    if (!conn) return { ok: false as const, code: "bridge_connection_missing" };
    if (conn.transport !== "whatsapp_web_bridge" || conn.purpose !== "group_broadcast") {
      return { ok: false as const, code: "connection_is_not_the_bridge" };
    }

    const { data: rows, error: rowsErr } = await db
      .from("whatsapp_groups")
      .select("id, whatsapp_chat_id, current_name, previous_name")
      .eq("connection_id", conn.id);
    if (rowsErr) throw new Error(rowsErr.message);

    const plan = computeGroupSyncPlan((rows ?? []) as ExistingGroupRow[], remote.groups);
    const now = new Date().toISOString();

    if (plan.inserts.length) {
      const { error } = await db.from("whatsapp_groups").insert(
        plan.inserts.map((g) => ({
          connection_id: conn.id,
          whatsapp_chat_id: g.whatsapp_chat_id,
          current_name: g.current_name,
          last_seen_at: now,
          last_name_sync_at: now,
        })),
      );
      if (error) throw new Error(error.message);
    }

    for (const rename of plan.renames) {
      const { error } = await db
        .from("whatsapp_groups")
        .update({
          current_name: rename.current_name,
          previous_name: rename.previous_name,
          last_seen_at: now,
          last_name_sync_at: now,
        })
        .eq("id", rename.id)
        .eq("connection_id", conn.id);
      if (error) throw new Error(error.message);
    }

    const unchanged = plan.touched_ids.filter((id) => !plan.renames.some((r) => r.id === id));
    if (unchanged.length) {
      const { error } = await db
        .from("whatsapp_groups")
        .update({ last_seen_at: now })
        .in("id", unchanged)
        .eq("connection_id", conn.id);
      if (error) throw new Error(error.message);
    }

    await db.from("whatsapp_group_sync_logs").insert({
      connection_id: conn.id,
      sync_type: "bridge_pull",
      total_count: plan.total_count,
      new_count: plan.inserts.length,
      renamed_count: plan.renames.length,
      missing_count: plan.missing_count,
      summary: `bridge sync: ${plan.total_count} groups, ${plan.inserts.length} new, ${plan.renames.length} renamed, ${plan.missing_count} missing (kept active)`,
    });

    await db.from("whatsapp_connections").update({ last_sync_at: now }).eq("id", conn.id);

    return {
      ok: true as const,
      total: plan.total_count,
      new_count: plan.inserts.length,
      renamed_count: plan.renames.length,
      missing_count: plan.missing_count,
    };
  });
