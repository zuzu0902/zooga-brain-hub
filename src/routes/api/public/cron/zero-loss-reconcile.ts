/**
 * ZERO-LOSS RECONCILIATION ENDPOINT.
 *
 *   POST {published}/api/public/cron/zero-loss-reconcile
 *     header: x-api-token: <api_settings.webhook_token>
 *
 * Detects gaps, performs only unambiguous auto-repairs, records every run
 * and finding. No WhatsApp is sent, nothing is deleted.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runReconciliation } from "@/lib/zero-loss/reconcile.server";

export const Route = createFileRoute("/api/public/cron/zero-loss-reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-api-token");
        const { data } = await supabaseAdmin.from("api_settings").select("webhook_token").eq("id", 1).maybeSingle();
        if (!provided || !data?.webhook_token || data.webhook_token !== provided) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const res = await runReconciliation("cron");
          return Response.json({ ok: true, ...res });
        } catch (err: any) {
          return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});