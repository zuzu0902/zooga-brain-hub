/**
 * RUNTIME TURN — the Hostinger Gateway -> Tamar active bridge, and the
 * internal/manual entrypoint into the Tamar engine.
 *
 * The Meta WhatsApp webhook (/api/public/webhook/tamar) calls the SAME engine.
 *
 * Auth (either one, this route only):
 *  - x-api-token header matching api_settings.webhook_token (existing path).
 *  - Authorization: Bearer <gateway token>, validated ONLY through the
 *    public.zooga_core_gateway_authorized RPC (SHA-256 digest comparison in
 *    the database, active `hostinger-core` credential). No token is ever
 *    logged or echoed. No other route is affected.
 *
 * Safety: the canary allowlist gate runs BEFORE contact creation, model call
 * or outbound send. Gateway-origin events MUST carry meta_message_id so a
 * retry can never produce a second model call or a second send.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runTamarTurn } from "@/lib/tamar-engine.server";
import { gateInboundForCanary } from "@/lib/tamar-canary/canary.server";

export type TurnAuth = { ok: true; origin: "api_token" | "gateway" } | { ok: false };

/** Extracts a bearer gateway token, or null when missing/malformed. */
export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length >= 20 ? token : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "cache-control": "no-store" },
  });
}

async function authorize(request: Request): Promise<TurnAuth> {
  const provided = request.headers.get("x-api-token");
  if (provided) {
    const { data: settings } = await supabaseAdmin
      .from("api_settings")
      .select("webhook_token")
      .eq("id", 1)
      .maybeSingle();
    const expected = settings?.webhook_token ?? null;
    if (expected && expected === provided) return { ok: true, origin: "api_token" };
  }

  const token = extractBearerToken(request.headers.get("authorization"));
  if (token) {
    try {
      const { data, error } = await (supabaseAdmin as any).rpc("zooga_core_gateway_authorized", {
        _gateway_token: token,
      });
      if (!error && data === true) return { ok: true, origin: "gateway" };
    } catch {
      /* fall through to unauthorized */
    }
  }
  return { ok: false };
}

export const Route = createFileRoute("/api/public/runtime/tamar-turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if (!auth.ok) return json({ ok: false, error: "unauthorized" }, 401);

        const body = await request.json().catch(() => ({}) as any);

        // Gateway-origin events must be stably idempotent.
        const metaMessageId = body?.meta_message_id ? String(body.meta_message_id).trim() : "";
        if (auth.origin === "gateway" && !metaMessageId) {
          return json({ ok: false, error: "meta_message_id_required" }, 400);
        }

        // Canary allowlist gate — before contact creation, model call or send.
        const phone = body?.phone ?? body?.whatsapp_number ?? body?.from ?? null;
        const gate = await gateInboundForCanary({
          phone,
          inboundMessageId: metaMessageId || null,
          messageType: "text",
        });
        if (!gate.allowed) {
          return json({ ok: false, error: "blocked", reason: gate.reason, reply_sent: false }, 403);
        }

        const result = await runTamarTurn(body);
        return new Response(JSON.stringify(result.payload), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
