import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards, presence, getApiSettings } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/feature-flags")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    const settings = await getApiSettings();
    return jsonResponse({
      flags: {
        ai_extraction: { enabled: presence(process.env.LOVABLE_API_KEY).present, source: "env:LOVABLE_API_KEY" },
        tamar_dispatch: { enabled: !!settings?.tamar_backend_url, source: "api_settings.tamar_backend_url" },
        tamar_webhook_intake: { enabled: presence(settings?.webhook_token ?? null).present, source: "api_settings.webhook_token" },
        pending_insights_review: { enabled: true, source: "always-on" },
        memory_layer: { enabled: true, source: "always-on" },
        handoff_console_ui: { enabled: false, source: "not-implemented" },
        autonomous_campaign_agent: { enabled: false, source: "planned" },
        natural_language_targeting: { enabled: false, source: "planned" },
        public_offers_read: { enabled: true, source: "rls-policy" },
        debug_api: { enabled: presence(process.env.DEBUG_READ_ONLY_TOKEN).present, source: "env:DEBUG_READ_ONLY_TOKEN" },
        introspect_api: { enabled: presence(process.env.DEBUG_READ_ONLY_TOKEN).present, source: "env:DEBUG_READ_ONLY_TOKEN" },
      },
    });
  })},
});