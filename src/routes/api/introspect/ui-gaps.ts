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
        { layer: "global_cross_contact_timeline", status: "missing", impact: "low", description: "Per-contact UnifiedTimeline shipped; org-wide cross-contact timeline still missing." },
        { layer: "offers_management", status: "partial", impact: "low", description: "List/detail exist; bulk operations and performance metrics missing." },
        { layer: "role_management_ui", status: "missing", impact: "low", description: "user_roles managed via SQL; no admin UI." },
      ],
      recently_shipped: [
        { layer: "tasks_console", route: "/tasks" },
        { layer: "handoff_console", route: "/handoff" },
        { layer: "tamar_conversation_viewer", location: "contact profile" },
        { layer: "tamar_decision_visibility", location: "contact profile" },
        { layer: "internal_ai_assistant", route: "/ai-assistant" },
        { layer: "contact_memory_taxonomy_v2", location: "contact profile · Relationship Memory section (6 categories: fact, preference, warning, observation, relationship_signal, offer_signal)" },
        { layer: "tamar_decision_strip_v2", location: "contact profile · adds confidence band, pending insight count link, open task count link" },
        { layer: "grounded_ai_assistant", route: "/ai-assistant", note: "typed requests (summarize_contact, summarize_hot_leads_week, suggest_segment, draft_campaign, suggest_triage) with SYSTEM_CONTEXT bundled from Zooga; response includes context_used" },
        { layer: "handoff_task_linkage", location: "/handoff · linked task creation, under_human / returned_to_ai / resolved states; pending_ai_insights.resolution_state + linked_task_id" },
        { layer: "tamar_outbound_config_env", note: "TAMAR_API_URL / TAMAR_API_TOKEN read from env (preferred), api_settings table kept as fallback" },
        { layer: "memory_v2_backfill", route: "/api/public/admin/backfill-memories", note: "heuristic backfill for warning / observation / relationship_signal / offer_signal" },
        { layer: "tamar_behavior_settings", route: "/settings/tamar", note: "tone, confidence thresholds, memory write policy, handoff thresholds, routing behavior, sales aggressiveness" },
        { layer: "ai_assistant_persistence", route: "/ai-assistant", note: "ai_assistant_runs table; server-side history, reuse + save-as-task with source_ref_id link" },
      ],
      source_of_truth_note: "All conversation history, memories, extracted attributes, pending insights, tasks, and handoff state read from Zooga DB tables only. Tamar backend is used only as channel runtime / webhook bridge / delivery layer; no display path reads conversation or memory from Tamar.",
    });
  })},
});