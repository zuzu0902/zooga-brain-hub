/**
 * INTERNAL READ-ONLY DEBUG ENDPOINT
 * GET /api/debug/agents-summary — agents/modules actually present in code/config.
 */
import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse } from "@/lib/debug-api.server";

const AGENTS = [
  {
    key: "intelligence_extractor",
    enabled: true,
    source: "src/lib/intelligence-extractor.server.ts",
    description:
      "Reads conversation history per contact and extracts structured attributes (gender, city, tone, preferences, etc.) with confidence scoring.",
  },
  {
    key: "memory_writer",
    enabled: true,
    source: "contact_memories table + extractor pipeline",
    description: "Persists long-form unstructured memories (preferences, facts, warnings) alongside the structured profile.",
  },
  {
    key: "pending_insight_router",
    enabled: true,
    source: "pending_ai_insights table",
    description: "Routes low-confidence (<75) AI suggestions to a manager-review queue instead of overwriting profile fields.",
  },
  {
    key: "intake_bot",
    enabled: true,
    source: "src/lib/intake-flows.ts + /api/public/webhook/tamar",
    description: "Tamar bot intake flows: scripted question sequences with emotional-angle hints, executed by Tamar backend.",
  },
  {
    key: "campaign_dispatcher",
    enabled: true,
    source: "src/lib/intake-campaign.functions.ts + src/lib/campaigns.functions.ts",
    description: "Sends selected leads to Tamar backend for campaign-driven outreach.",
  },
  {
    key: "autonomous_campaign_agent",
    enabled: false,
    source: "(planned)",
    description: "Future: AI-proposed campaigns based on fit_score and sales_temperature without manual selection.",
  },
  {
    key: "natural_language_targeting",
    enabled: false,
    source: "(planned)",
    description: "Future: free-text audience queries translated into contact filters.",
  },
  {
    key: "handoff_console",
    enabled: false,
    source: "(planned)",
    description: "Future: dedicated manager UI to triage pending_ai_insights and bot escalations.",
  },
];

const handler = async ({ request }: { request: Request }) => {
  const gate = checkDebugAuth(request);
  if (gate) return gate;

  return jsonResponse({
    agent_count: AGENTS.length,
    enabled_count: AGENTS.filter((a) => a.enabled).length,
    agents: AGENTS,
  });
};

export const Route = createFileRoute("/api/debug/agents-summary")({
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