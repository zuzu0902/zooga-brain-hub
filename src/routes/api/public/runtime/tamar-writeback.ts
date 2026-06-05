/**
 * RUNTIME WRITEBACK — Railway/Tamar → Zooga
 *
 * Railway calls this once per turn (after attempting to reply) so Zooga
 * persists the *actual* runtime execution truth — not just what context
 * was offered. Managers inspect these rows in the Runtime Trace UI.
 *
 * Auth: x-api-token / body.token must match api_settings.webhook_token.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const VALID_MODES = new Set(["zooga_pack", "fallback", "failed_before_reply"]);

async function authorize(request: Request, body: any): Promise<Response | null> {
  const url = new URL(request.url);
  const provided =
    request.headers.get("x-api-token") || url.searchParams.get("token") || body?.token;
  const { data: settings } = await supabaseAdmin
    .from("api_settings")
    .select("webhook_token")
    .eq("id", 1)
    .maybeSingle();
  if (settings?.webhook_token && settings.webhook_token !== provided) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

function asBool(v: any): boolean | null {
  if (v === true || v === false) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

export const Route = createFileRoute("/api/public/runtime/tamar-writeback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({} as any));
        const unauthorized = await authorize(request, body);
        if (unauthorized) return unauthorized;

        const runtime_mode = String(body.runtime_mode ?? "unknown");
        if (runtime_mode !== "unknown" && !VALID_MODES.has(runtime_mode)) {
          return new Response(
            JSON.stringify({
              error: "invalid_runtime_mode",
              allowed: Array.from(VALID_MODES),
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const row = {
          contact_id: body.contact_id ?? null,
          campaign_id: body.campaign_id ?? null,
          offer_id: body.offer_id ?? null,
          channel: body.channel ?? null,
          source: body.source ?? "railway_tamar_runtime",
          inbound_message: body.inbound_message ?? body.inbound ?? null,
          outbound_reply: body.outbound_reply ?? body.reply ?? null,
          runtime_mode,
          runtime_pack_fetch_ok: asBool(body.runtime_pack_fetch_ok),
          fallback_reason: body.fallback_reason ?? null,
          deployment_sha: body.deployment_sha ?? null,
          composition_version: body.composition_version ?? null,
          tamar_settings_version_at: body.tamar_settings_version_at ?? null,
          prompt_blocks_injected: Array.isArray(body.prompt_blocks_injected)
            ? body.prompt_blocks_injected
            : [],
          offer_intelligence_injected: !!body.offer_intelligence_injected,
          campaign_injected: !!body.campaign_injected,
          latency_ms:
            typeof body.latency_ms === "number" ? body.latency_ms : null,
          error: body.error ?? null,
          raw_payload: body,
        };

        const { data, error } = await supabaseAdmin
          .from("tamar_runtime_executions" as any)
          .insert(row)
          .select("id, created_at")
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ ok: false, error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        return Response.json({ ok: true, id: (data as any)?.id, created_at: (data as any)?.created_at });
      },
    },
  },
});