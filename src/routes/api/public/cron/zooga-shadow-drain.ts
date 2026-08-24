/**
 * ZOOGA OS SHADOW TRANSPORT — DRAIN ENDPOINT (cron, fail-closed).
 *
 *   POST {published}/api/public/cron/zooga-shadow-drain
 *     header: x-api-token: <api_settings.webhook_token>
 *
 * Observation-only: forwards metadata envelopes to the Gateway. Never sends a
 * customer message, never calls a model, never touches contact state.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { drainShadowOutbox } from "@/lib/zooga-gateway/shadow-outbox.server";

async function authorized(request: Request): Promise<boolean> {
  const provided = request.headers.get("x-api-token");
  if (!provided) return false;
  const { data } = await supabaseAdmin.from("api_settings").select("webhook_token").eq("id", 1).maybeSingle();
  return !!data?.webhook_token && data.webhook_token === provided;
}

export const Route = createFileRoute("/api/public/cron/zooga-shadow-drain")({
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
          const res = await drainShadowOutbox(20);
          return Response.json({ ok: true, ...res });
        } catch (err: any) {
          return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err).slice(0, 200) }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
