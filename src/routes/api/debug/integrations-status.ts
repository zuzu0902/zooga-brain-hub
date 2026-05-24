/**
 * INTERNAL READ-ONLY DEBUG ENDPOINT
 * GET /api/debug/integrations-status — connectivity probes (read-only).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDebugAuth, jsonResponse, presence } from "@/lib/debug-api.server";

const handler = async ({ request }: { request: Request }) => {
  const gate = checkDebugAuth(request);
  if (gate) return gate;

  // Supabase ping (lightweight, head-only count)
  let supabaseStatus: "ok" | "error" = "error";
  let supabaseError: string | null = null;
  try {
    const { error } = await supabaseAdmin
      .from("api_settings")
      .select("id", { count: "exact", head: true });
    if (error) supabaseError = error.message;
    else supabaseStatus = "ok";
  } catch (e: any) {
    supabaseError = String(e?.message ?? e);
  }

  // Last successful webhook event (Tamar)
  const { data: lastTamar } = await supabaseAdmin
    .from("webhook_logs")
    .select("created_at, status, source")
    .in("source", ["tamar_bot", "tamar", "tamar_whatsapp"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: lastAnyWebhook } = await supabaseAdmin
    .from("webhook_logs")
    .select("created_at, status, source")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: lastInteraction } = await supabaseAdmin
    .from("interactions")
    .select("timestamp, type")
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: settings } = await supabaseAdmin
    .from("api_settings")
    .select("tamar_backend_url, tamar_backend_api_token, webhook_token")
    .eq("id", 1)
    .maybeSingle();

  return jsonResponse({
    checked_at: new Date().toISOString(),
    supabase: {
      status: supabaseStatus,
      url_configured: !!process.env.SUPABASE_URL,
      error: supabaseError,
    },
    ai_gateway: {
      status: presence(process.env.LOVABLE_API_KEY).present ? "configured" : "missing_key",
      provider: "lovable-ai-gateway",
    },
    tamar_webhook: {
      endpoint: "/api/public/webhook/tamar",
      token_configured: presence(settings?.webhook_token ?? null).present,
      last_event_at: lastTamar?.created_at ?? null,
      last_event_status: lastTamar?.status ?? null,
    },
    whatsapp: {
      mode: "tamar-managed",
      backend_url_configured: !!settings?.tamar_backend_url,
      backend_token_configured: presence(settings?.tamar_backend_api_token ?? null).present,
      last_interaction_at: lastInteraction?.timestamp ?? null,
      note: "WhatsApp delivery happens on Tamar's side; Lovable only receives webhooks.",
    },
    last_webhook_any: lastAnyWebhook ?? null,
  });
};

export const Route = createFileRoute("/api/debug/integrations-status")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PUT: handler,
      DELETE: handler,
      PATCH: handler,
    },
  },
});