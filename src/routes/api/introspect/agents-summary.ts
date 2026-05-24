import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards } from "@/lib/introspect-api.server";

const AGENTS = [
  { key: "intelligence_extractor", enabled: true, maturity: "live", source: "src/lib/intelligence-extractor.server.ts", description: "Extracts structured contact attributes from conversation history with confidence scoring." },
  { key: "memory_writer", enabled: true, maturity: "live", source: "contact_memories table + extractor pipeline", description: "Persists long-form unstructured memories alongside structured profile." },
  { key: "pending_insight_router", enabled: true, maturity: "live", source: "pending_ai_insights table", description: "Routes low-confidence (<75) AI suggestions to manager-review queue." },
  { key: "intake_bot", enabled: true, maturity: "live", source: "src/lib/intake-flows.ts + /api/public/webhook/tamar", description: "Tamar scripted intake flows with per-flow system addenda." },
  { key: "campaign_dispatcher", enabled: true, maturity: "live", source: "src/lib/intake-campaign.functions.ts + campaigns.functions.ts", description: "Sends selected leads to Tamar backend for outreach." },
  { key: "handoff_router", enabled: true, maturity: "live", source: "pending_ai_insights + manager_attention_required + /handoff", description: "Backend routing + dedicated /handoff console for approve/reject/create-task." },
  { key: "tasks_engine", enabled: true, maturity: "live", source: "tasks table + /tasks console + contact-profile create-task", description: "Operational task queue with status/priority and contact linkage." },
  { key: "internal_ai_assistant", enabled: true, maturity: "live", source: "/api/public/ai-assistant/run + /ai-assistant", description: "Proposal-first internal assistant: summary, segmentation, campaign draft, triage. No autonomous writes." },
  { key: "tamar_decision_visibility", enabled: true, maturity: "live", source: "src/components/tamar-decision-strip.tsx", description: "Surfaces active flow, routing reason, manager-attention flag, suggested next action per contact." },
  { key: "tamar_decision_visibility_v2", enabled: true, maturity: "live", source: "src/components/tamar-decision-strip.tsx", description: "v2 adds confidence band (high/medium/low), pending insight count link, open task count link, manager-attention badge." },
  { key: "memory_taxonomy_normalizer", enabled: true, maturity: "live", source: "src/routes/_app.contacts.$id.tsx · normalizeMemType", description: "6-category canonical taxonomy: fact, preference, warning, observation, relationship_signal, offer_signal. Legacy values mapped." },
  { key: "grounded_ai_assistant", enabled: true, maturity: "live", source: "src/routes/api/public/ai-assistant/run.ts", description: "Typed requests (summarize_contact, summarize_hot_leads_week, suggest_segment, draft_campaign, suggest_triage) injected with SYSTEM_CONTEXT from Zooga; returns context_used." },
  { key: "handoff_resolution_router", enabled: true, maturity: "live", source: "/handoff + pending_ai_insights.resolution_state + .linked_task_id", description: "Approve / reject / create-linked-task / mark under_human / return_to_ai; tasks tagged with source_kind=pending_insight." },
  { key: "autonomous_campaign_agent", enabled: false, maturity: "planned", source: "(planned)", description: "Future: AI-proposed campaigns from fit_score/sales_temperature without manual selection." },
  { key: "natural_language_targeting", enabled: false, maturity: "planned", source: "(planned)", description: "Future: free-text audience queries translated into contact filters." },
];

export const Route = createFileRoute("/api/introspect/agents-summary")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    return jsonResponse({
      agent_count: AGENTS.length,
      enabled_count: AGENTS.filter((a)=>a.enabled).length,
      by_maturity: {
        live: AGENTS.filter(a=>a.maturity==="live").length,
        partial: AGENTS.filter(a=>a.maturity==="partial").length,
        planned: AGENTS.filter(a=>a.maturity==="planned").length,
      },
      agents: AGENTS,
    });
  })},
});