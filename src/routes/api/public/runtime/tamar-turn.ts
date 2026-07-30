/**
 * RUNTIME TURN — internal/manual entrypoint into the Tamar engine.
 *
 * The live production path is the Meta WhatsApp webhook
 * (/api/public/webhook/tamar), which calls the SAME engine. This route
 * exists for diagnostics, replay and manual QA.
 *
 * Auth: x-api-token header must match api_settings.webhook_token.
 * Tokens are never accepted from the query string.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runTamarTurn } from "@/lib/tamar-engine.server";

async function authorize(request: Request): Promise<Response | null> {
  const provided = request.headers.get("x-api-token");
  const { data: settings } = await supabaseAdmin
    .from("api_settings")
    .select("webhook_token")
    .eq("id", 1)
    .maybeSingle();
  const expected = settings?.webhook_token ?? null;
  if (!expected || expected !== provided) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

export const Route = createFileRoute("/api/public/runtime/tamar-turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authorize(request);
        if (unauthorized) return unauthorized;
        const body = await request.json().catch(() => ({}) as any);
        const result = await runTamarTurn(body);
        return new Response(JSON.stringify(result.payload), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
