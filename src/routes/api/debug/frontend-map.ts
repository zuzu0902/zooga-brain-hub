/**
 * INTERNAL READ-ONLY DEBUG ENDPOINT
 * GET /api/debug/frontend-map — registered routes + feature presence flags.
 */
import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse } from "@/lib/debug-api.server";

const ROUTES: { path: string; screen: string; auth: boolean }[] = [
  { path: "/login", screen: "login", auth: false },
  { path: "/", screen: "dashboard", auth: true },
  { path: "/contacts", screen: "contacts_list", auth: true },
  { path: "/contacts/$id", screen: "contact_profile_intelligence", auth: true },
  { path: "/campaigns", screen: "campaigns_list", auth: true },
  { path: "/campaigns/new", screen: "campaign_create", auth: true },
  { path: "/campaigns/$id", screen: "campaign_detail", auth: true },
  { path: "/intake-campaign", screen: "intake_campaign", auth: true },
  { path: "/inbox", screen: "inbox", auth: true },
  { path: "/offers", screen: "offers_list", auth: true },
  { path: "/offers/$id", screen: "offer_detail", auth: true },
  { path: "/send-offer", screen: "send_offer", auth: true },
  { path: "/import-leads", screen: "import_leads", auth: true },
  { path: "/settings/api", screen: "tamar_api_settings", auth: true },
];

const handler = async ({ request }: { request: Request }) => {
  const gate = checkDebugAuth(request);
  if (gate) return gate;

  const screens = new Set(ROUTES.map((r) => r.screen));

  return jsonResponse({
    routes: ROUTES,
    screens: Array.from(screens),
    features: {
      tamar_settings_screen: screens.has("tamar_api_settings"),
      contact_profile_intelligence: screens.has("contact_profile_intelligence"),
      handoff_console: false,
      inbox: screens.has("inbox"),
      intake_campaign_builder: screens.has("intake_campaign"),
      offer_engine: screens.has("offers_list"),
    },
    notes: {
      handoff_console:
        "Not implemented as a dedicated screen yet — pending_ai_insights table exists but no /handoff route.",
    },
  });
};

export const Route = createFileRoute("/api/debug/frontend-map")({
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