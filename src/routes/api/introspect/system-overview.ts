import { createFileRoute } from "@tanstack/react-router";
import {
  checkDebugAuth, jsonResponse, methodGuards, presence,
  countRows, getApiSettings, envPresenceMap, isVerbose,
} from "@/lib/introspect-api.server";

const TABLES = [
  "contacts","interactions","campaigns","intake_campaigns","intake_inbox",
  "extracted_attributes","contact_memories","pending_ai_insights","webhook_logs",
  "offers","messages","tasks","imported_leads",
];

export const Route = createFileRoute("/api/introspect/system-overview")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    const verbose = isVerbose(request);
    const settings = await getApiSettings();
    const counters: Record<string, number | null> = {};
    await Promise.all(TABLES.map(async (t) => { counters[t] = await countRows(t); }));
    const env = envPresenceMap();
    return jsonResponse({
      app: { name: "Zooga CRM", codename: "Zooga OS", environment: process.env.NODE_ENV ?? "unknown", generated_at: new Date().toISOString() },
      stack: {
        frontend: "React 19 + TanStack Start (Vite 7, Tailwind v4)",
        backend: "TanStack server functions + server routes on Cloudflare Workers",
        database: "Lovable Cloud (Supabase Postgres) with RLS",
        ai: "Lovable AI Gateway (Gemini family)",
      },
      modules: {
        contacts_crm: true, campaigns: true, intake_campaigns: true, offers: true,
        inbox: true, intelligence_extractor: true, memory_layer: true,
        pending_insights_review: true, tamar_webhook: true, handoff_console: false,
      },
      integrations: {
        supabase: { configured: !!process.env.SUPABASE_URL },
        lovable_ai_gateway: { configured: presence(process.env.LOVABLE_API_KEY).present },
        tamar_backend: {
          configured: !!settings?.tamar_backend_url,
          token_configured: presence(settings?.tamar_backend_api_token ?? null).present,
        },
        tamar_webhook: {
          token_configured: presence(settings?.webhook_token ?? null).present,
          default_source: settings?.default_source ?? null,
          facebook_page_id_configured: !!settings?.facebook_page_id,
        },
      },
      ai: { provider: "lovable-ai-gateway", default_model: "google/gemini-2.5-flash", extractor_enabled: true },
      counters,
      env: { present: env.present, missing: env.missing },
      build: verbose ? { node_env: process.env.NODE_ENV ?? "unknown", runtime: "cloudflare-workers" } : undefined,
    });
  })},
});