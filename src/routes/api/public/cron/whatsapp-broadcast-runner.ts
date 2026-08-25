/**
 * WHATSAPP GROUP BROADCAST RUNNER ENDPOINT (Alex Personal bridge only).
 *
 *   POST {published}/api/public/cron/whatsapp-broadcast-runner
 *     header: x-api-token: <api_settings.webhook_token>
 *
 * Runs at most one due broadcast per invocation, with a database lease,
 * bounded work and per-target idempotency. Tamar/Meta is never used here.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runBroadcastQueue } from "@/lib/whatsapp-broadcast/runner.server";

async function authorized(request: Request): Promise<boolean> {
  const provided = request.headers.get("x-api-token");
  if (!provided) return false;
  const { data } = await supabaseAdmin.from("api_settings").select("webhook_token").eq("id", 1).maybeSingle();
  return !!data?.webhook_token && data.webhook_token === provided;
}

export const Route = createFileRoute("/api/public/cron/whatsapp-broadcast-runner")({
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
          const body = (await request.json().catch(() => ({}))) as {
            broadcast_id?: string;
            max_targets?: number;
          };
          const cap = Number(body?.max_targets);
          const res = await runBroadcastQueue({
            ...(body?.broadcast_id ? { broadcastId: String(body.broadcast_id) } : {}),
            ...(Number.isFinite(cap) && cap > 0 ? { maxTargets: Math.min(40, Math.floor(cap)) } : {}),
          });
          return Response.json(res);
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
