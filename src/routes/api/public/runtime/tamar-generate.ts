/**
 * AGENT-CENTRIC MIGRATION — intelligence-only turn endpoint.
 *
 * Hostinger Gateway is the sole WhatsApp/Meta execution authority. This
 * route runs the SAME Tamar engine as /api/public/runtime/tamar-turn and
 * persists inbound/outbound conversation, CRM and audit state, but it
 * NEVER sends anything to Meta/WhatsApp. The Gateway performs delivery and
 * reports it back through /api/public/runtime/tamar-delivery-audit.
 *
 * Auth: Authorization: Bearer <gateway token>, validated only through the
 * database RPC zooga_core_gateway_authorized (active hostinger-core
 * credential). meta_message_id is mandatory and drives idempotency, so a
 * Gateway retry can never produce a second model call.
 *
 * The legacy tamar-turn route is intentionally left untouched for rollback.
 */
import { createFileRoute } from "@tanstack/react-router";
import { runTamarTurn } from "@/lib/tamar-engine.server";
import { gateInboundForCanary } from "@/lib/tamar-canary/canary.server";
import { authorizeGatewayRequest, jsonResponse } from "@/lib/zooga-gateway/gateway-route-auth.server";

export const GENERATE_RUNTIME_MODE = "gateway_execution";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Handoff signal derivation (pure).
 * Fresh turn: engine payload.handoff_requested === true (this turn asked for
 * a human); handoff_id from payload.handoff.id.
 * Duplicate: the engine replay always reports false, so the flag is true only
 * when a stored manager_handoffs row was created by this exact trace.
 */
export function deriveHandoffSignal(
  payload: any,
  storedHandoffId: string | null,
): { handoff_requested: boolean; handoff_id: string | null } {
  const safeId = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : null);
  if (payload?.duplicate === true) {
    const id = safeId(storedHandoffId);
    return { handoff_requested: !!id, handoff_id: id };
  }
  const requested = payload?.handoff_requested === true;
  return { handoff_requested: requested, handoff_id: requested ? safeId(payload?.handoff?.id) : null };
}

async function findHandoffForTrace(traceId: unknown): Promise<string | null> {
  if (typeof traceId !== "string" || !UUID_RE.test(traceId)) return null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("manager_handoffs" as any)
      .select("id")
      .eq("runtime_trace_id", traceId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return ((data as any)?.id as string) ?? null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/runtime/tamar-generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorized = await authorizeGatewayRequest(request);
        if (!authorized) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

        const body = await request.json().catch(() => ({}) as any);

        const metaMessageId = body?.meta_message_id ? String(body.meta_message_id).trim() : "";
        if (!metaMessageId) return jsonResponse({ ok: false, error: "meta_message_id_required" }, 400);

        const message = String(body?.message ?? "").trim();
        if (!message) return jsonResponse({ ok: false, error: "message_required" }, 400);

        const phone = body?.phone ?? body?.whatsapp_number ?? body?.from ?? null;
        if (!phone) return jsonResponse({ ok: false, error: "phone_required" }, 400);

        // Safety allowlist stays enforced, before contact creation or model call.
        const gate = await gateInboundForCanary({
          phone,
          inboundMessageId: metaMessageId,
          messageType: "text",
        });
        if (!gate.allowed) {
          return jsonResponse({ ok: false, error: "blocked", reason: gate.reason }, 403);
        }

        const result = await runTamarTurn({
          phone,
          message,
          meta_message_id: metaMessageId,
          source: body?.source ?? "whatsapp",
          name: body?.name ?? null,
          // Lovable must never reach Meta on this path.
          suppress_outbound: true,
        });

        const payload: any = result.payload ?? {};
        if (result.status !== 200 || payload.ok !== true) {
          return jsonResponse({ ok: false, error: payload.error ?? "turn_failed" }, result.status || 500);
        }

        const duplicate = payload.duplicate === true;
        const storedHandoffId = duplicate ? await findHandoffForTrace(payload.trace_id) : null;
        const signal = deriveHandoffSignal(payload, storedHandoffId);

        return jsonResponse({
          ok: true,
          reply_text: payload.reply_text ?? "",
          trace_id: payload.trace_id ?? null,
          duplicate,
          runtime_mode: GENERATE_RUNTIME_MODE,
          handoff_requested: signal.handoff_requested,
          ...(signal.handoff_id ? { handoff_id: signal.handoff_id } : {}),
        });
      },
    },
  },
});
