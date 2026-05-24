import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDebugAuth, jsonResponse, methodGuards } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/recent-events")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "25",10) || 25,1),100);
    const typeFilter = url.searchParams.get("type");
    const statusFilter = url.searchParams.get("status");

    const [{ data: webhooks }, { data: interactions }, { data: extractions }, { data: pending }] = await Promise.all([
      supabaseAdmin.from("webhook_logs").select("id,source,status,error,created_at").order("created_at",{ascending:false}).limit(limit),
      supabaseAdmin.from("interactions").select("id,type,source,timestamp").order("timestamp",{ascending:false}).limit(limit),
      supabaseAdmin.from("extracted_attributes").select("id,attribute_name,confidence_score,source,applied,created_at").order("created_at",{ascending:false}).limit(limit),
      supabaseAdmin.from("pending_ai_insights").select("id,field_name,category,confidence_score,status,created_at").order("created_at",{ascending:false}).limit(limit),
    ]);

    let events = [
      ...(webhooks ?? []).map((w:any) => ({ event_type:"webhook", source:w.source, status:w.status, error_present:!!w.error, timestamp:w.created_at })),
      ...(interactions ?? []).map((i:any) => ({ event_type:"interaction", source:i.source ?? "unknown", status:i.type, error_present:false, timestamp:i.timestamp })),
      ...(extractions ?? []).map((e:any) => ({ event_type:"ai_extraction", source:e.source, status:`${e.applied?"applied":"pending"}:conf${e.confidence_score??"?"}`, field:e.attribute_name, error_present:false, timestamp:e.created_at })),
      ...(pending ?? []).map((p:any) => ({ event_type:"pending_insight", source:"intelligence_extractor", status:p.status, field:p.field_name ?? p.category, error_present:false, timestamp:p.created_at })),
    ].filter((e:any) => !!e.timestamp);

    if (typeFilter) events = events.filter((e:any) => e.event_type === typeFilter);
    if (statusFilter) events = events.filter((e:any) => String(e.status).includes(statusFilter));

    events = events.sort((a:any,b:any) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, limit);
    return jsonResponse({
      limit, filters: { type: typeFilter, status: statusFilter }, returned: events.length,
      note: "Message content, contact identities, and raw payloads are intentionally omitted.",
      events,
    });
  })},
});