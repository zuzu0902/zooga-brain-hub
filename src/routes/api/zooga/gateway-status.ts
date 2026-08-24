/**
 * ZOOGA OS CONTROL PLANE — STATUS ENDPOINT (admin-only, read-only).
 * Requires a Supabase bearer token belonging to an admin user.
 * Returns only the sanitized status projection — never the gateway token.
 *
 * POST runs the same bounded, status-only shadow drain as the cron route.
 * It never activates traffic and never sends a customer message.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { emptyStatus, type GatewayStatus } from "@/lib/zooga-gateway/status";
import { getGatewayStatus } from "@/lib/zooga-gateway/gateway.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Returns null when the caller is a verified admin, otherwise an error Response. */
async function requireAdmin(request: Request, checkedAt: string): Promise<Response | null> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return json(emptyStatus(checkedAt, "unauthorized"), 401);
  }
  const token = auth.slice(7).trim();
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!token || !url || !key) {
    return json(emptyStatus(checkedAt, "unauthorized"), 401);
  }
  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
  const userId = claims?.claims?.sub;
  if (claimsError || !userId) {
    return json(emptyStatus(checkedAt, "unauthorized"), 401);
  }
  const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (roleError || isAdmin !== true) {
    return json(emptyStatus(checkedAt, "forbidden"), 403);
  }
  return null;
}

async function withShadow(status: GatewayStatus): Promise<GatewayStatus> {
  const { getShadowMetrics } = await import("@/lib/zooga-gateway/shadow-outbox.server");
  return { ...status, shadow: await getShadowMetrics() };
}

export const Route = createFileRoute("/api/zooga/gateway-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const checkedAt = new Date().toISOString();
        const denied = await requireAdmin(request, checkedAt);
        if (denied) return denied;
        return json(await withShadow(await getGatewayStatus()));
      },
      POST: async ({ request }) => {
        const checkedAt = new Date().toISOString();
        const denied = await requireAdmin(request, checkedAt);
        if (denied) return denied;
        const { drainShadowOutbox } = await import("@/lib/zooga-gateway/shadow-outbox.server");
        let drain: unknown = null;
        try {
          drain = await drainShadowOutbox(20);
        } catch {
          drain = { claimed: 0, delivered: 0, failed: 0, error_code: "drain_failed" };
        }
        return json({ ...(await withShadow(await getGatewayStatus())), drain });
      },
    },
  },
});
