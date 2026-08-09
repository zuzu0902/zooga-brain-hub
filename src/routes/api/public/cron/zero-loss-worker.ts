/**
 * ZERO-LOSS RETRY WORKER ENDPOINT.
 *
 *   POST {published}/api/public/cron/zero-loss-worker
 *     header: x-api-token: <api_settings.webhook_token>
 *
 * Claims due jobs with an atomic lease and re-runs idempotent processing.
 * Never sends WhatsApp from the retry path.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runWorker } from "@/lib/zero-loss/worker.server";

async function authorized(request: Request): Promise<boolean> {
  const provided = request.headers.get("x-api-token");
  if (!provided) return false;
  const { data } = await supabaseAdmin.from("api_settings").select("webhook_token").eq("id", 1).maybeSingle();
  return !!data?.webhook_token && data.webhook_token === provided;
}

export const Route = createFileRoute("/api/public/cron/zero-loss-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorized(request))) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const res = await runWorker({ worker: `edge-${Math.random().toString(36).slice(2, 8)}`, limit: 25 });
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