/**
 * HANDOFF SWEEP — operational truthfulness for queued handoffs.
 *
 * There is no live manager channel: every handoff is QUEUED inside Zooga.
 * This job re-asserts that state for anything left unattended — makes sure
 * the contact is flagged and an open ops task exists.
 *
 *   POST {published}/api/public/cron/retry-handoffs
 *     header: x-api-token: <api_settings.webhook_token>
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const STALE_MINUTES = 5;
const MAX_ATTEMPTS = 5;

export const Route = createFileRoute("/api/public/cron/retry-handoffs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-api-token");
        const { data: settings } = await supabaseAdmin
          .from("api_settings")
          .select("webhook_token")
          .eq("id", 1)
          .maybeSingle();
        if (!settings?.webhook_token || settings.webhook_token !== provided) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
        const { data: stale } = await supabaseAdmin
          .from("manager_handoffs" as any)
          .select("id, contact_id, customer_name, handoff_reason, delivery_attempts")
          .in("status", ["open", "queued"])
          .eq("manager_notified", false)
          .lt("created_at", cutoff)
          .lt("delivery_attempts", MAX_ATTEMPTS)
          .limit(50);

        const rows = ((stale as any[]) ?? []);
        const results: any[] = [];

        for (const row of rows) {
          const attempts = (row.delivery_attempts ?? 0) + 1;
          const { data: existingTask } = await supabaseAdmin
            .from("tasks")
            .select("id")
            .eq("source_kind", "manager_handoff")
            .eq("source_ref_id", row.id)
            .maybeSingle();

          if (!existingTask) {
            await supabaseAdmin.from("tasks").insert({
              contact_id: row.contact_id,
              title: `Handoff queued — ${row.customer_name ?? "לקוח"}`,
              description: `reason: ${row.handoff_reason ?? "unspecified"} • unattended > ${STALE_MINUTES}m`,
              status: "open",
              priority: "high",
              resolution_state: "pending",
              source_kind: "manager_handoff",
              source_ref_id: row.id,
            } as any);
          }
          if (row.contact_id) {
            await supabaseAdmin
              .from("contacts")
              .update({ manager_attention_required: true } as any)
              .eq("id", row.contact_id);
          }
          await supabaseAdmin
            .from("manager_handoffs" as any)
            .update({
              delivery_attempts: attempts,
              status: "queued",
              delivery_promise: "queued",
              alert_error: "queued_no_manager_channel",
            } as any)
            .eq("id", row.id);
          results.push({ id: row.id, attempts, task_created: !existingTask });
        }

        return Response.json({ ok: true, candidates: rows.length, results });
      },
    },
  },
});
