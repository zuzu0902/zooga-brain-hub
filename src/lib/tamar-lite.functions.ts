import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Response("Forbidden", { status: 403 });
}

/** Read-only Tamar Lite shadow status. No send path exists in stage 1. */
export const getTamarLiteStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const count = async (state?: string, messagesOnly = false) => {
      let q = db.from("tamar_lite_events").select("id", { count: "exact", head: true });
      if (state) q = q.eq("processing_state", state);
      if (messagesOnly) q = q.eq("event_kind", "message");
      const { count: c } = await q;
      return c ?? 0;
    };
    const staleCutoff = new Date(Date.now() - 300_000).toISOString();
    const [settings, total, backlog, recorded, processed, failed, processing, decisions, outbox, counters, stale, recovered] =
      await Promise.all([
      db.from("tamar_lite_settings").select("mode,kill_switch,updated_at").eq("id", true).maybeSingle(),
      count(),
      // backlog = ONLY inbound messages still awaiting processing
      count("pending", true),
      count("recorded"),
      count("processed"),
      count("failed"),
      count("processing"),
      db
        .from("tamar_lite_decisions")
        .select("id,contact_id,action,reason_codes,offer_ids,created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      db.from("tamar_lite_outbox").select("id", { count: "exact", head: true }),
      db.from("tamar_lite_events").select("duplicate_count,conflict_count"),
      db
        .from("tamar_lite_events")
        .select("id", { count: "exact", head: true })
        .eq("processing_state", "processing")
        .lt("processing_started_at", staleCutoff),
      db
        .from("tamar_lite_events")
        .select("id", { count: "exact", head: true })
        .eq("error", "recovered_stale_processing"),
    ]);
    const rows = (counters.data ?? []) as { duplicate_count: number | null; conflict_count: number | null }[];
    const duplicates = rows.reduce((s, r) => s + (r.duplicate_count ?? 0), 0);
    const conflicts = rows.reduce((s, r) => s + (r.conflict_count ?? 0), 0);
    return {
      mode: settings.data?.mode ?? "shadow",
      kill_switch: settings.data?.kill_switch !== false,
      totals: {
        total,
        backlog,
        recorded,
        processed,
        failures: failed,
        in_flight: processing,
        duplicates,
        conflicts,
        stale: stale.count ?? 0,
        recovered: recovered.count ?? 0,
      },
      outbox_rows: outbox.count ?? 0,
      decisions: (decisions.data ?? []) as any[],
    };
  });