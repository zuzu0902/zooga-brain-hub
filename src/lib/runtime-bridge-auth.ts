import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Shared auth for /api/public/runtime/* bridge endpoints called by the
 * Railway brain. Accepts `Authorization: Bearer <token>` matching the
 * RUNTIME_BRIDGE_TOKEN env var. Falls back to api_settings.webhook_token
 * (or x-api-token header) so older callers don't break during rollout.
 */
export async function authorizeRuntimeBridge(request: Request): Promise<Response | null> {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : null;
  const xToken = request.headers.get("x-api-token");
  const url = new URL(request.url);
  const qToken = url.searchParams.get("token");
  const provided = bearer || xToken || qToken;

  const expected = process.env.RUNTIME_BRIDGE_TOKEN || null;
  if (expected && provided && provided === expected) return null;

  // Fallback to legacy webhook_token so existing Railway deploys keep working.
  if (provided) {
    const { data: settings } = await supabaseAdmin
      .from("api_settings")
      .select("webhook_token")
      .eq("id", 1)
      .maybeSingle();
    if (settings?.webhook_token && settings.webhook_token === provided) return null;
  }

  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export function normalizePhone(raw: any): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.startsWith("+") ? s : s;
}