/**
 * INTERNAL READ-ONLY DEBUG ENDPOINT
 * GET /api/debug/recent-events — redacted summary of recent system events.
 * NEVER returns raw message text or personal data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDebugAuth, jsonResponse } from "@/lib/debug-api.server";

const handler = async ({ request }: { request: Request }) => {
  const gate = checkDebugAuth(request);
  if (gate) return gate;

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "25", 10) || 25, 1),
    100,
  );

  const [{ data: webhooks }, { data: interactions }, { data: extractions }, { data: pending }] =
    await Promise.all([
      supabaseAdmin
        .from("webhook_logs")
        .select("id, source, status, error, created_at")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("interactions")
        .select("id, type, direction, timestamp")
        .order("timestamp", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("extracted_attributes")
        .select("id, field, confidence, source, created_at")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("pending_ai_insights")
        .select("id, field, confidence, status, created_at")
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

  const events = [
    ...(webhooks ?? []).map((w) => ({
      event_type: "webhook",
      source: w.source,
      status: w.status,
      error_present: !!w.error,
      timestamp: w.created_at,
    })),
    ...(interactions ?? []).map((i) => ({
      event_type: "interaction",
      source: i.direction ?? "unknown",
      status: i.type,
      error_present: false,
      timestamp: i.timestamp,
    })),
    ...(extractions ?? []).map((e) => ({
      event_type: "ai_extraction",
      source: e.source,
      status: `confidence:${e.confidence ?? "?"}`,
      field: e.field,
      error_present: false,
      timestamp: e.created_at,
    })),
    ...(pending ?? []).map((p) => ({
      event_type: "pending_insight",
      source: "intelligence_extractor",
      status: p.status,
      field: p.field,
      error_present: false,
      timestamp: p.created_at,
    })),
  ]
    .filter((e) => !!e.timestamp)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit);

  return jsonResponse({
    limit,
    returned: events.length,
    note: "Message content, contact identities, and raw payloads are intentionally omitted. Only type/status/timestamp are exposed.",
    events,
  });
};

export const Route = createFileRoute("/api/debug/recent-events")({
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