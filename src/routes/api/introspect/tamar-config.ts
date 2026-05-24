import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards, presence, getApiSettings, INTAKE_FLOWS, INTAKE_FLOW_LABELS } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/tamar-config")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    const settings = await getApiSettings();
    const flows = Object.entries(INTAKE_FLOWS).map(([key, def]) => ({
      key, label: (INTAKE_FLOW_LABELS as any)[key] ?? key,
      question_count: def.questions.length, has_system_addendum: !!def.system_addendum,
    }));
    return jsonResponse({
      tone_preset: "warm-professional-hebrew",
      language: "he-IL",
      enabled_agents: {
        intake_bot: true, intelligence_extractor: true, memory_writer: true,
        pending_insight_router: true, autonomous_campaign_agent: false,
      },
      thresholds: {
        auto_apply_confidence_min: 75,
        pending_review_confidence_max: 74,
        handoff_on_factual_doubt: true,
      },
      memory_policy: {
        table: "contact_memories",
        kinds_supported: ["preference","fact","warning","observation"],
        retention: "indefinite",
        write_rule: "high-confidence extractor or explicit user statement",
      },
      handoff_policy: {
        table: "pending_ai_insights",
        trigger: "confidence < 75 OR factual_doubt",
        dedicated_console_screen: false,
      },
      sales: {
        tracks_fit_score: true, tracks_sales_temperature: true,
        autonomous_offer_dispatch: false,
      },
      intake_flows: flows,
      backend_link: {
        url_configured: !!settings?.tamar_backend_url,
        url_host: settings?.tamar_backend_url ? (() => { try { return new URL(settings.tamar_backend_url).host; } catch { return null; } })() : null,
        api_token: presence(settings?.tamar_backend_api_token ?? null),
        webhook_token: presence(settings?.webhook_token ?? null),
        default_source: settings?.default_source ?? null,
        facebook_page_id_configured: !!settings?.facebook_page_id,
      },
    });
  })},
});