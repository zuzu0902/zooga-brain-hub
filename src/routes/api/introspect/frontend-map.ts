import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards } from "@/lib/introspect-api.server";

const ROUTES = [
  { path: "/login", screen: "login", auth: false, nav: false },
  { path: "/", screen: "dashboard", auth: true, nav: true },
  { path: "/contacts", screen: "contacts_list", auth: true, nav: true, features: ["search","filter","list"] },
  { path: "/contacts/$id", screen: "contact_profile_intelligence", auth: true, nav: false, features: ["profile","ai_panel","memories_v2_taxonomy","unified_timeline","tamar_decision_strip_v2","live_conversation","confidence_band","linked_tasks_count","pending_insights_count"] },
  { path: "/campaigns", screen: "campaigns_list", auth: true, nav: true },
  { path: "/campaigns/new", screen: "campaign_create", auth: true, nav: false },
  { path: "/campaigns/$id", screen: "campaign_detail", auth: true, nav: false },
  { path: "/intake-campaign", screen: "intake_campaign", auth: true, nav: true },
  { path: "/inbox", screen: "inbox", auth: true, nav: true },
  { path: "/offers", screen: "offers_list", auth: true, nav: true },
  { path: "/offers/$id", screen: "offer_detail", auth: true, nav: false },
  { path: "/send-offer", screen: "send_offer", auth: true, nav: true },
  { path: "/import-leads", screen: "import_leads", auth: true, nav: true },
  { path: "/tasks", screen: "tasks_console", auth: true, nav: true, features: ["list","filter","create","complete","reopen","delete","source_kind","resolution_state"] },
  { path: "/handoff", screen: "handoff_console", auth: true, nav: true, features: ["flagged_contacts","global_pending_insights","approve","reject","linked_task_create","mark_under_human","return_to_ai","clear_flag","resolution_legend"] },
  { path: "/ai-assistant", screen: "internal_ai_assistant", auth: true, nav: true, features: ["proposal_first","summarize_contact","summarize_hot_leads_week","suggest_segment","draft_campaign","suggest_triage","free_form","grounded_in_zooga","context_used_panel","save_as_task"] },
  { path: "/settings/tamar", screen: "tamar_behavior_settings", auth: true, nav: true, features: ["tone_preset","confidence_thresholds","memory_write_policy","memory_kinds","handoff_threshold","handoff_keywords","routing_mode","autonomous_offers_toggle","autonomous_campaigns_toggle","sales_aggressiveness","sales_max_followups","backfill_memories_action"] },
  { path: "/settings/api", screen: "tamar_api_settings", auth: true, nav: true },
];

export const Route = createFileRoute("/api/introspect/frontend-map")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    const screens = Array.from(new Set(ROUTES.map((r) => r.screen)));
    return jsonResponse({
      route_count: ROUTES.length,
      routes: ROUTES,
      screens,
      nav: ROUTES.filter((r) => r.nav).map((r) => ({ path: r.path, screen: r.screen })),
      implemented_modules: {
        contacts: true, campaigns: true, intake_campaigns: true, inbox: true,
        offers: true, send_offer: true, import_leads: true, tamar_settings: true,
        ai_intelligence_panel: true,
        tasks_console: true,
        handoff_console: true,
        internal_ai_assistant: true,
        tamar_decision_visibility: true,
        contact_live_conversation: true,
        contact_memory_taxonomy_v2: true,
        contact_unified_timeline: true,
        grounded_ai_assistant: true,
        handoff_resolution_actions: true,
        handoff_task_linkage: true,
        tamar_behavior_settings: true,
        ai_assistant_persistence: true,
        memory_v2_backfill: true,
        tamar_outbound_env_config: true,
      },
      planned_modules: {
        autonomous_campaign_agent: false,
        natural_language_targeting: false,
        analytics_dashboard: false,
      },
    });
  })},
});