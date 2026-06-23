/**
 * RUNTIME CONVERSATION DEBUG — read-only audit endpoint.
 *
 * Given a phone (or contact_id), returns:
 *   - contact summary
 *   - recent_interactions (chronological)
 *   - recent runtime traces (tamar_runtime_executions)
 *
 * Auth: Authorization: Bearer <RUNTIME_BRIDGE_TOKEN>
 * Read-only. No writes.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeRuntimeBridge, normalizePhone } from "@/lib/runtime-bridge-auth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-token",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function classifyDirection(row: any): "inbound" | "outbound" | "system" {
  const t = String(row?.type ?? "").toLowerCase();
  const s = String(row?.source ?? "").toLowerCase();
  if (t.includes("lead") || t === "incoming" || s.includes("lead") || s.includes("inbound") || s.includes("whatsapp_in")) {
    return "inbound";
  }
  if (
    t.includes("tamar") ||
    t.includes("sent") ||
    t.includes("reply") ||
    t.includes("outbound") ||
    s.includes("tamar") ||
    s.includes("outbound") ||
    s.includes("whatsapp_out")
  ) {
    return "outbound";
  }
  return "system";
}

async function handle(request: Request): Promise<Response> {
  const unauthorized = await authorizeRuntimeBridge(request);
  if (unauthorized) return unauthorized;

  let body: any = {};
  if (request.method === "POST") {
    body = await request.json().catch(() => ({}));
  } else {
    const u = new URL(request.url);
    u.searchParams.forEach((v, k) => (body[k] = v));
  }

  const phone = normalizePhone(body.phone ?? body.whatsapp_number ?? body.from);
  const contactId: string | null = body.contact_id ?? null;
  const interactionLimit = Math.min(Number(body.interaction_limit) || 50, 200);
  const traceLimit = Math.min(Number(body.trace_limit) || 20, 100);

  if (!phone && !contactId) {
    return json({ ok: false, error: "missing_phone_or_contact_id" }, 400);
  }

  // Look up contact (read-only, no create)
  let contact: any = null;
  if (contactId) {
    const { data } = await supabaseAdmin.from("contacts").select("*").eq("id", contactId).maybeSingle();
    contact = data ?? null;
  }
  if (!contact && phone) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .or(`phone.eq.${phone},whatsapp_number.eq.${phone}`)
      .maybeSingle();
    contact = data ?? null;
  }

  if (!contact) {
    return json({ ok: false, error: "contact_not_found", phone, contact_id: contactId }, 404);
  }

  const [interactionsRes, tracesRes] = await Promise.all([
    supabaseAdmin
      .from("interactions")
      .select("id,type,source,content,timestamp,campaign_id,related_offer_id")
      .eq("contact_id", contact.id)
      .order("timestamp", { ascending: false })
      .limit(interactionLimit),
    supabaseAdmin
      .from("tamar_runtime_executions")
      .select(
        "id,created_at,channel,source,inbound_message,outbound_reply,runtime_mode,conversation_mode,conversation_mode_reasons,offer_id,campaign_id,runtime_pack_fetch_ok,fallback_reason,deployment_sha,composition_version,latency_ms,error,raw_payload"
      )
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false })
      .limit(traceLimit),
  ]);

  const interactions = (interactionsRes.data ?? [])
    .slice()
    .reverse()
    .map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      direction: classifyDirection(row),
      type: row.type,
      source: row.source,
      text: row.content,
      campaign_id: row.campaign_id,
      related_offer_id: row.related_offer_id,
    }));

  const traces = (tracesRes.data ?? []).map((t: any) => {
    const raw = t.raw_payload ?? {};
    const replyText =
      t.outbound_reply ??
      raw?.reply_text ??
      raw?.final_reply_text ??
      raw?.response?.reply_text ??
      null;
    const usedFallback =
      typeof raw?.used_fallback === "boolean"
        ? raw.used_fallback
        : typeof raw?.response?.used_fallback === "boolean"
          ? raw.response.used_fallback
          : t.fallback_reason
            ? true
            : null;
    return {
      id: t.id,
      created_at: t.created_at,
      channel: t.channel,
      source: t.source,
      runtime_mode: t.runtime_mode,
      conversation_mode: t.conversation_mode,
      conversation_mode_reasons: t.conversation_mode_reasons,
      resolved_offer_id: t.offer_id ?? raw?.resolved_offer_id ?? null,
      campaign_id: t.campaign_id,
      inbound_message: t.inbound_message,
      reply_text: replyText,
      used_fallback: usedFallback,
      fallback_reason: t.fallback_reason,
      runtime_pack_fetch_ok: t.runtime_pack_fetch_ok,
      latency_ms: t.latency_ms,
      deployment_sha: t.deployment_sha,
      composition_version: t.composition_version,
      error: t.error,
    };
  });

  const dyn = (contact.dynamic_profile_fields ?? {}) as Record<string, any>;

  return json({
    ok: true,
    contact: {
      id: contact.id,
      phone: contact.phone,
      whatsapp_number: contact.whatsapp_number,
      first_name: contact.first_name,
      last_name: contact.last_name,
      full_name: contact.full_name,
      status: contact.status,
      intake_state: contact.intake_state,
      intake_stage: contact.intake_stage,
      intake_completion_score: contact.intake_completion_score,
      last_interaction_at: contact.last_interaction_at,
      interaction_count: contact.interaction_count,
      ai_summary: contact.ai_summary,
      sales_temperature: contact.sales_temperature,
      purchase_intent: contact.purchase_intent,
      manager_attention_required: !!contact.manager_attention_required,
      current_offer_id: dyn.current_offer_id ?? contact.entry_offer_id ?? contact.last_clicked_offer ?? null,
    },
    recent_interactions: interactions,
    recent_traces: traces,
    counts: {
      interactions_returned: interactions.length,
      traces_returned: traces.length,
    },
  });
}

export const Route = createFileRoute("/api/public/runtime/conversation-debug")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});