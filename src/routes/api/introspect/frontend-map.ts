import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards } from "@/lib/introspect-api.server";

const ROUTES = [
  { path: "/login", screen: "login", auth: false, nav: false },
  { path: "/", screen: "dashboard", auth: true, nav: true },
  { path: "/contacts", screen: "contacts_list", auth: true, nav: true, features: ["search","filter","list"] },
  { path: "/contacts/$id", screen: "contact_profile_intelligence", auth: true, nav: false, features: ["profile","ai_panel","memories","history"] },
  { path: "/campaigns", screen: "campaigns_list", auth: true, nav: true },
  { path: "/campaigns/new", screen: "campaign_create", auth: true, nav: false },
  { path: "/campaigns/$id", screen: "campaign_detail", auth: true, nav: false },
  { path: "/intake-campaign", screen: "intake_campaign", auth: true, nav: true },
  { path: "/inbox", screen: "inbox", auth: true, nav: true },
  { path: "/offers", screen: "offers_list", auth: true, nav: true },
  { path: "/offers/$id", screen: "offer_detail", auth: true, nav: false },
  { path: "/send-offer", screen: "send_offer", auth: true, nav: true },
  { path: "/import-leads", screen: "import_leads", auth: true, nav: true },
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
      },
      planned_modules: {
        handoff_console: false,
        autonomous_campaign_agent: false,
        natural_language_targeting: false,
        analytics_dashboard: false,
      },
    });
  })},
});