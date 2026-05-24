import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDebugAuth, jsonResponse, methodGuards, presence, getApiSettings } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/integrations-status")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    let supabaseStatus: "ok" | "error" = "error"; let supabaseError: string | null = null;
    try {
      const { error } = await supabaseAdmin.from("api_settings").select("id", { count: "exact", head: true });
      if (error) supabaseError = error.message; else supabaseStatus = "ok";
    } catch (e: any) { supabaseError = String(e?.message ?? e); }

    const settings = await getApiSettings();
    const { data: lastTamar } = await supabaseAdmin.from("webhook_logs")
      .select("created_at,status,source").in("source",["tamar_bot","tamar","tamar_whatsapp"])
      .order("created_at",{ascending:false}).limit(1).maybeSingle();
    const { data: lastFailed } = await supabaseAdmin.from("webhook_logs")
      .select("created_at,status,source").eq("status","error")
      .order("created_at",{ascending:false}).limit(1).maybeSingle();
    const { data: lastInteraction } = await supabaseAdmin.from("interactions")
      .select("timestamp,type").order("timestamp",{ascending:false}).limit(1).maybeSingle();

    return jsonResponse({
      checked_at: new Date().toISOString(),
      supabase: { status: supabaseStatus, url_configured: !!process.env.SUPABASE_URL, error: supabaseError },
      ai_gateway: { status: presence(process.env.LOVABLE_API_KEY).present ? "configured" : "missing_key", provider: "lovable-ai-gateway" },
      tamar_backend: {
        configured: !!settings?.tamar_backend_url,
        token_configured: presence(settings?.tamar_backend_api_token ?? null).present,
      },
      tamar_webhook: {
        endpoint: "/api/public/webhook/tamar",
        token_configured: presence(settings?.webhook_token ?? null).present,
        last_event_at: lastTamar?.created_at ?? null,
        last_event_status: lastTamar?.status ?? null,
      },
      whatsapp: {
        mode: "tamar-managed",
        note: "WhatsApp delivery occurs on Tamar's side; Lovable only receives webhooks.",
        last_interaction_at: lastInteraction?.timestamp ?? null,
      },
      last_failed_event: lastFailed ?? null,
    });
  })},
});