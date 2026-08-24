/**
 * ZOOGA OS — WhatsApp connections & group broadcast control-plane server fns.
 * Admin-gated. NO WhatsApp send and NO bridge network call happens here.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canOwnGroupBroadcast,
  hasSecretLikeKey,
  nextBroadcastStatus,
  sanitizeConnectionConfig,
  validateBroadcastDraft,
  type WaConnection,
} from "@/lib/whatsapp-broadcast/core";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("forbidden");
  return context.userId as string;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const listWhatsappConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaConnection[]> => {
    await assertAdmin(context);
    const db = await admin();
    const { data, error } = await db
      .from("whatsapp_connections")
      .select("*")
      .order("purpose", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((c: any) => ({
      ...c,
      config: sanitizeConnectionConfig(c.config),
      capabilities: c.capabilities ?? [],
    })) as WaConnection[];
  });

export const updateBridgeConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { connection_id: string; display_name?: string; phone_label?: string | null; config?: Record<string, unknown>; enabled?: boolean }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const db = await admin();
    const { data: conn, error: readErr } = await db
      .from("whatsapp_connections")
      .select("id, transport, purpose")
      .eq("id", data.connection_id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!conn) throw new Error("connection_not_found");
    if (!canOwnGroupBroadcast(conn as any)) throw new Error("meta_connection_is_read_only");
    if (hasSecretLikeKey(data.config)) throw new Error("secrets_not_allowed_in_config");

    const patch: Record<string, unknown> = {};
    if (data.display_name !== undefined) patch["display_name"] = data.display_name;
    if (data.phone_label !== undefined) patch["phone_label"] = data.phone_label;
    if (data.enabled !== undefined) patch["enabled"] = data.enabled;
    if (data.config !== undefined) patch["config"] = sanitizeConnectionConfig(data.config);

    const { error } = await db.from("whatsapp_connections").update(patch).eq("id", data.connection_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listWhatsappGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const db = await admin();
    const { data, error } = await db
      .from("whatsapp_groups")
      .select("*, whatsapp_connections(connection_key, display_name, transport, purpose)")
      .eq("archived", false)
      .order("current_name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listBroadcasts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const db = await admin();
    const { data, error } = await db
      .from("whatsapp_broadcasts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getBroadcastDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const db = await admin();
    const [{ data: broadcast }, { data: targets }] = await Promise.all([
      db.from("whatsapp_broadcasts").select("*").eq("id", data.id).maybeSingle(),
      db
        .from("whatsapp_broadcast_targets")
        .select("*")
        .eq("broadcast_id", data.id)
        .order("send_order", { ascending: true }),
    ]);
    return { broadcast: broadcast ?? null, targets: targets ?? [] };
  });

export const createBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      connection_id: string;
      title: string;
      message_text: string;
      media_url?: string | null;
      group_ids: string[];
      scheduled_for?: string | null;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const userId = await assertAdmin(context);
    const check = validateBroadcastDraft(data);
    if (!check.ok) throw new Error(check.error);

    const db = await admin();
    const { data: conn, error: connErr } = await db
      .from("whatsapp_connections")
      .select("id, transport, purpose")
      .eq("id", data.connection_id)
      .maybeSingle();
    if (connErr) throw new Error(connErr.message);
    if (!canOwnGroupBroadcast(conn as any)) {
      throw new Error("רק Alex Personal WhatsApp (WhatsApp Web Bridge) יכול לבצע הפצה לקבוצות");
    }

    const { data: groups, error: groupsErr } = await db
      .from("whatsapp_groups")
      .select("id, current_name, whatsapp_chat_id, connection_id, send_enabled, archived")
      .in("id", data.group_ids);
    if (groupsErr) throw new Error(groupsErr.message);
    const eligible = (groups ?? []).filter(
      (g: any) => g.connection_id === data.connection_id && g.send_enabled && !g.archived,
    );
    if (!eligible.length) throw new Error("לא נמצאו קבוצות זמינות להפצה");

    const status = nextBroadcastStatus(data.scheduled_for);
    const { data: created, error: insErr } = await db
      .from("whatsapp_broadcasts")
      .insert({
        connection_id: data.connection_id,
        title: data.title.trim(),
        message_text: data.message_text,
        media_url: data.media_url || null,
        status,
        send_mode: data.scheduled_for ? "scheduled" : "manual",
        scheduled_for: data.scheduled_for || null,
        total_groups: eligible.length,
        pending_count: eligible.length,
        created_by: userId,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    const rows = eligible.map((g: any, i: number) => ({
      broadcast_id: created.id,
      group_id: g.id,
      group_name_snapshot: g.current_name,
      whatsapp_chat_id_snapshot: g.whatsapp_chat_id,
      send_order: i,
      status: "pending" as const,
    }));
    const { error: tErr } = await db.from("whatsapp_broadcast_targets").insert(rows);
    if (tErr) throw new Error(tErr.message);

    // NOTE: nothing is sent. Execution waits for the external WhatsApp Web bridge.
    return { id: created.id as string, status, targets: rows.length };
  });

export const cancelBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const db = await admin();
    const { error } = await db
      .from("whatsapp_broadcasts")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .in("status", ["draft", "queued"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listGroupSyncLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const db = await admin();
    const { data, error } = await db
      .from("whatsapp_group_sync_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
