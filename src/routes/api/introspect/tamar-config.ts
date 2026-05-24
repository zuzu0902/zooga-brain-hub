import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards, presence, getApiSettings, getTamarOutboundConfig, getBehaviorSettings, INTAKE_FLOWS, INTAKE_FLOW_LABELS } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/tamar-config")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    const [settings, behavior] = await Promise.all([getApiSettings(), getBehaviorSettings()]);
    const outbound = getTamarOutboundConfig(settings);
    const flows = Object.entries(INTAKE_FLOWS).map(([key, def]) => ({
      key, label: (INTAKE_FLOW_LABELS as any)[key] ?? key,
      question_count: def.questions.length, has_system_addendum: !!def.system_addendum,
    }));
    return jsonResponse({
      source_of_truth: {
        memory_authority: "zooga",
        conversation_authority: "zooga",
        tasks_authority: "zooga",
        handoff_authority: "zooga",
        tamar_backend_role: "channel_runtime_only",
      },
      tone_preset: behavior?.tone_preset ?? "warm-professional-hebrew",
      language: "he-IL",
      enabled_agents: {
        intake_bot: true, intelligence_extractor: true, memory_writer: true,
        pending_insight_router: true, autonomous_campaign_agent: false,
        grounded_ai_assistant: true, handoff_resolution_router: true,
      },
      thresholds: {
        auto_apply_confidence_min: behavior?.confidence_auto_apply_min ?? 75,
        pending_review_confidence_max: behavior?.confidence_pending_max ?? 74,
        handoff_on_factual_doubt: behavior?.handoff_on_factual_doubt ?? true,
        confidence_bands: {
          high_min: behavior?.confidence_high_min ?? 75,
          medium_min: behavior?.confidence_medium_min ?? 50,
          low_max: (behavior?.confidence_medium_min ?? 50) - 1,
        },
      },
      memory_policy: {
        table: "contact_memories",
        kinds_supported: behavior?.memory_kinds_enabled ?? ["fact","preference","warning","observation","relationship_signal","offer_signal"],
        taxonomy_version: 2,
        retention: "indefinite",
        write_rule: behavior?.memory_write_policy ?? "high_confidence_or_explicit",
        authority: "zooga",
        backfill_endpoint: "/api/public/admin/backfill-memories",
      },
      handoff_policy: {
        table: "pending_ai_insights",
        trigger: `confidence < ${behavior?.handoff_confidence_threshold ?? 60} OR factual_doubt`,
        keywords: behavior?.handoff_keywords ?? [],
        dedicated_console_screen: true,
        resolution_states: ["pending","under_human","returned_to_ai","resolved"],
        task_linkage_column: "linked_task_id",
      },
      routing_policy: {
        mode: behavior?.routing_mode ?? "proposal_first",
        allow_autonomous_offers: behavior?.routing_allow_autonomous_offers ?? false,
        allow_autonomous_campaigns: behavior?.routing_allow_autonomous_campaigns ?? false,
      },
      sales: {
        tracks_fit_score: true, tracks_sales_temperature: true,
        autonomous_offer_dispatch: behavior?.routing_allow_autonomous_offers ?? false,
        aggressiveness: behavior?.sales_aggressiveness ?? "balanced",
        max_followups_per_week: behavior?.sales_max_followups_per_week ?? 3,
      },
      intake_flows: flows,
      backend_link: {
        url_configured: !!outbound.url,
        url_host: outbound.host,
        url_source: outbound.source,
        api_token: { present: outbound.token_present, source: outbound.env_token_present ? "env" : (settings?.tamar_backend_api_token ? "db" : "unconfigured") },
        env_url_present: outbound.env_url_present,
        env_token_present: outbound.env_token_present,
        webhook_token: presence(settings?.webhook_token ?? null),
        default_source: settings?.default_source ?? null,
        facebook_page_id_configured: !!settings?.facebook_page_id,
      },
      behavior_settings: behavior ? {
        configured: true,
        updated_at: behavior.updated_at,
      } : { configured: false },
    });
  })},
});