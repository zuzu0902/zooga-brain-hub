import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/ui-gaps")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    return jsonResponse({
      gaps: [
        { layer: "analytics_dashboard", status: "missing", impact: "medium", description: "No aggregate analytics view (campaign performance, conversion funnels)." },
        { layer: "autonomous_campaign_proposals", status: "missing", impact: "medium", description: "No UI surface for AI-proposed campaigns." },
        { layer: "natural_language_targeting", status: "missing", impact: "medium", description: "No text-to-filter audience builder." },
        { layer: "contact_timeline", status: "partial", impact: "low", description: "UnifiedTimeline section exists in profile; cross-contact global timeline still missing." },
        { layer: "offers_management", status: "partial", impact: "low", description: "List/detail exist; bulk operations and performance metrics missing." },
        { layer: "role_management_ui", status: "missing", impact: "low", description: "user_roles managed via SQL; no admin UI." },
        { layer: "ai_assistant_persistence", status: "partial", impact: "low", description: "Internal AI assistant is live but history is in-memory per session; not persisted across reloads." },
        { layer: "ai_assistant_context_injection", status: "partial", impact: "medium", description: "AI assistant only receives aggregate counts; per-contact / per-campaign context not yet wired." },
      ],
      recently_shipped: [
        { layer: "tasks_console", route: "/tasks" },
        { layer: "handoff_console", route: "/handoff" },
        { layer: "tamar_conversation_viewer", location: "contact profile" },
        { layer: "tamar_decision_visibility", location: "contact profile" },
        { layer: "internal_ai_assistant", route: "/ai-assistant" },
      ],
    });
  })},
});