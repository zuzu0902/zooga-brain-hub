import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards } from "@/lib/introspect-api.server";

const ROUTES = [
  { path: "/login", screen: "login", auth: false, nav: false },
  { path: "/", screen: "dashboard", auth: true, nav: true },
  { path: "/contacts", screen: "contacts_list", auth: true, nav: true, features: ["search","filter","list"] },
  { path: "/contacts/$id", screen: "contact_profile_intelligence", auth: true, nav: false, features: ["profile","ai_panel","memories","history","tamar_decision_strip","live_conversation"] },
  { path: "/campaigns", screen: "campaigns_list", auth: true, nav: true },
  { path: "/campaigns/new", screen: "campaign_create", auth: true, nav: false },
  { path: "/campaigns/$id", screen: "campaign_detail", auth: true, nav: false },
  { path: "/intake-campaign", screen: "intake_campaign", auth: true, nav: true },
  { path: "/inbox", screen: "inbox", auth: true, nav: true },
  { path: "/offers", screen: "offers_list", auth: true, nav: true },
  { path: "/offers/$id", screen: "offer_detail", auth: true, nav: false },
  { path: "/send-offer", screen: "send_offer", auth: true, nav: true },
  { path: "/import-leads", screen: "import_leads", auth: true, nav: true },
  { path: "/tasks", screen: "tasks_console", auth: true, nav: true, features: ["list","filter","create","complete","reopen","delete"] },
  { path: "/handoff", screen: "handoff_console", auth: true, nav: true, features: ["flagged_contacts","global_pending_insights","approve","reject","create_task","clear_flag"] },
  { path: "/ai-assistant", screen: "internal_ai_assistant", auth: true, nav: true, features: ["proposal_first","summary","segmentation","campaign_draft","triage","save_as_task"] },
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
      },
      planned_modules: {
        autonomous_campaign_agent: false,
        natural_language_targeting: false,
        analytics_dashboard: false,
      },
    });
  })},
});