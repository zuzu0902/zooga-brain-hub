import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/backend-map")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    return jsonResponse({
      server_runtime: "Cloudflare Workers (TanStack Start)",
      public_routes: [
        { path: "/api/public/webhook/tamar", method: "POST", purpose: "Tamar bot inbound webhook", auth: "webhook_token" },
        { path: "/api/public/webhook/tamar-status", method: "POST", purpose: "Tamar delivery/status callbacks", auth: "webhook_token" },
        { path: "/api/public/intelligence/extract", method: "POST", purpose: "Trigger AI extraction for a contact", auth: "service-token" },
      ],
      debug_routes: [
        "/api/debug/system-summary","/api/debug/frontend-map","/api/debug/tamar-config",
        "/api/debug/integrations-status","/api/debug/schema-summary","/api/debug/agents-summary","/api/debug/recent-events",
      ],
      introspect_routes: [
        "/api/introspect/system-overview","/api/introspect/frontend-map","/api/introspect/backend-map",
        "/api/introspect/schema-summary","/api/introspect/tamar-config","/api/introspect/tamar-routing",
        "/api/introspect/integrations-status","/api/introspect/agents-summary","/api/introspect/crm-summary",
        "/api/introspect/campaigns-summary","/api/introspect/recent-events","/api/introspect/health-report",
        "/api/introspect/feature-flags","/api/introspect/ui-gaps","/api/introspect/deployment-summary",
      ],
      server_functions: [
        { module: "campaigns.functions", purpose: "Campaign CRUD + Tamar dispatch" },
        { module: "intake-campaign.functions", purpose: "Intake campaign builder + send" },
        { module: "intelligence-extractor.server", purpose: "AI conversation intelligence extraction" },
      ],
      outbound_integrations: [
        { name: "tamar_backend", direction: "outbound", purpose: "Send leads/campaigns to Tamar" },
        { name: "lovable_ai_gateway", direction: "outbound", purpose: "LLM inference for extraction" },
        { name: "supabase", direction: "outbound", purpose: "Database + auth" },
      ],
      webhook_handlers: [
        { source: "tamar_bot", path: "/api/public/webhook/tamar", logged_to: "webhook_logs" },
        { source: "tamar_status", path: "/api/public/webhook/tamar-status", logged_to: "webhook_logs" },
      ],
    });
  })},
});