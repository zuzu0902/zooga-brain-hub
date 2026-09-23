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

        return jsonResponse({
          ok: true,
          reply_text: payload.reply_text ?? "",
          trace_id: payload.trace_id ?? null,
          duplicate: payload.duplicate === true,
          runtime_mode: GENERATE_RUNTIME_MODE,
        });
      },
    },
  },
});
