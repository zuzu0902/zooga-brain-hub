/**
 * ZOOGA OS CONTROL PLANE — STATUS ENDPOINT (admin-only, read-only).
 * Requires a Supabase bearer token belonging to an admin user.
 * Returns only the sanitized status projection — never the gateway token.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { emptyStatus } from "@/lib/zooga-gateway/status";
import { getGatewayStatus } from "@/lib/zooga-gateway/gateway.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/zooga/gateway-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const checkedAt = new Date().toISOString();
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

        return json(await getGatewayStatus());
      },
    },
  },
});
