/**
 * Shared gateway-credential authorization for public runtime routes.
 *
 * Identical contract to /api/public/runtime/tamar-turn: an
 * `Authorization: Bearer <token>` header validated ONLY through the
 * database RPC `public.zooga_core_gateway_authorized` (SHA-256 digest
 * comparison against the active `hostinger-core` credential).
 *
 * No token is ever logged, echoed or returned.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Extracts a bearer gateway token, or null when missing/malformed. */
export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length >= 20 ? token : null;
}

export async function authorizeGatewayRequest(request: Request): Promise<boolean> {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) return false;
  try {
    const { data, error } = await (supabaseAdmin as any).rpc("zooga_core_gateway_authorized", {
      _gateway_token: token,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "cache-control": "no-store" },
  });
}
