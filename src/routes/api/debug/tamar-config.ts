/**
 * INTERNAL READ-ONLY DEBUG ENDPOINT
 * GET /api/debug/tamar-config — Tamar bot behavior + thresholds (no secrets).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDebugAuth, jsonResponse, presence } from "@/lib/debug-api.server";
import { INTAKE_FLOWS } from "@/lib/intake-flows";

const handler = async ({ request }: { request: Request }) => {
  const gate = checkDebugAuth(request);
  if (gate) return gate;

  const { data: settings } = await supabaseAdmin
    .from("api_settings")
    .select("default_source, facebook_page_id, webhook_token, tamar_backend_url, tamar_backend_api_token")
    .eq("id", 1)
    .maybeSingle();

  const flows = Object.entries(INTAKE_FLOWS ?? {}).map(([key, def]: any) => ({
    key,
    question_count: Array.isArray(def?.questions) ? def.questions.length : 0,
    has_system_addendum: !!def?.system_addendum,
  }));

  return jsonResponse({
    tone_preset: "warm-professional-hebrew",
    enabled_agents: {
      intake_bot: true,
      intelligence_extractor: true,
      memory_writer: true,
      pending_insight_router: true,
      autonomous_campaign_agent: false,
    },
    thresholds: {
      auto_apply_confidence_min: 75,
      pending_review_confidence_max: 74,
      handoff_on_factual_doubt: true,
    },
    memory: {
      table: "contact_memories",
      kinds_supported: ["preference", "fact", "warning", "observation"],
    },
    sales: {
      tracks_fit_score: true,
      tracks_sales_temperature: true,
      autonomous_offer_dispatch: false,
    },
    handoff: {
      table: "pending_ai_insights",
      dedicated_console_screen: false,
    },
    intake_flows: flows,
    backend_link: {
      url_configured: !!settings?.tamar_backend_url,
      url_host: settings?.tamar_backend_url
        ? (() => {
            try { return new URL(settings.tamar_backend_url).host; } catch { return null; }
          })()
        : null,
      api_token: presence(settings?.tamar_backend_api_token ?? null),
      webhook_token: presence(settings?.webhook_token ?? null),
      default_source: settings?.default_source ?? null,
      facebook_page_id_configured: !!settings?.facebook_page_id,
    },
  });
};

export const Route = createFileRoute("/api/debug/tamar-config")({
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