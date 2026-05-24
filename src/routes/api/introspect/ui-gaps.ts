import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/ui-gaps")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    return jsonResponse({
      gaps: [
        { layer: "handoff_console", status: "missing", impact: "high", description: "No dedicated UI to triage pending_ai_insights and manager_attention_required contacts." },
        { layer: "analytics_dashboard", status: "missing", impact: "medium", description: "No aggregate analytics view (campaign performance, conversion funnels)." },
        { layer: "autonomous_campaign_proposals", status: "missing", impact: "medium", description: "No UI surface for AI-proposed campaigns." },
        { layer: "natural_language_targeting", status: "missing", impact: "medium", description: "No text-to-filter audience builder." },
        { layer: "contact_timeline", status: "partial", impact: "medium", description: "Profile + history exist; consolidated timeline view not yet built." },
        { layer: "offers_management", status: "partial", impact: "low", description: "List/detail exist; bulk operations and performance metrics missing." },
        { layer: "tamar_conversation_viewer", status: "missing", impact: "high", description: "No screen to view a live Tamar conversation thread per contact." },
        { layer: "tasks_ui", status: "partial", impact: "medium", description: "tasks table exists; no dedicated tasks screen." },
        { layer: "role_management_ui", status: "missing", impact: "low", description: "user_roles managed via SQL; no admin UI." },
      ],
    });
  })},
});