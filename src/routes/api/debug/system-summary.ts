/**
 * INTERNAL READ-ONLY DEBUG ENDPOINT
 * GET /api/debug/system-summary — high-level system snapshot.
 * See src/lib/debug-api.server.ts for the security invariants.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDebugAuth, jsonResponse, presence } from "@/lib/debug-api.server";

const KEY_TABLES = [
  "contacts",
  "interactions",
  "campaigns",
  "intake_campaigns",
  "intake_inbox",
  "extracted_attributes",
  "contact_memories",
  "pending_ai_insights",
  "webhook_logs",
] as const;

async function countRows(table: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from(table as any)
    .select("*", { count: "exact", head: true });
  return error ? null : (count ?? null);
}

const handler = async ({ request }: { request: Request }) => {
  const gate = checkDebugAuth(request);
  if (gate) return gate;

  const counters: Record<string, number | null> = {};
  await Promise.all(
    KEY_TABLES.map(async (t) => {
      counters[t] = await countRows(t);
    }),
  );

  const { data: settings } = await supabaseAdmin
    .from("api_settings")
    .select("default_source, facebook_page_id, webhook_token, tamar_backend_url, tamar_backend_api_token")
    .eq("id", 1)
    .maybeSingle();

  return jsonResponse({
    app: {
      name: "Zooga CRM",
      codename: "Zooga OS",
      environment: process.env.NODE_ENV ?? "unknown",
      generated_at: new Date().toISOString(),
    },
    stack: {
      frontend: "React 19 + TanStack Start (Vite 7, Tailwind v4)",
      backend: "TanStack server functions + server routes on Cloudflare Workers",
      database: "Lovable Cloud (Supabase Postgres) with RLS",
      ai: "Lovable AI Gateway (Gemini family)",
    },
    modules: {
      contacts_crm: true,
      campaigns: true,
      intake_campaigns: true,
      offers: true,
      inbox: true,
      intelligence_extractor: true,
      memory_layer: true,
      pending_insights_review: true,
      tamar_webhook: true,
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
    ai: {
      provider: "lovable-ai-gateway",
      default_model: "google/gemini-2.5-flash",
      extractor_enabled: true,
    },
    counters,
  });
};

export const Route = createFileRoute("/api/debug/system-summary")({
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