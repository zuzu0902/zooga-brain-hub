import { createFileRoute } from "@tanstack/react-router";

/**
 * One-time operational rotation of the Hostinger Core gateway credential.
 * Authorized by the control-plane bearer (compared server-side in the DB).
 * Never logs, echoes or returns any secret. No CORS: not for browser use.
 */
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/runtime/gateway-rotate-credential")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const m = /^Bearer\s+(\S+)$/.exec(auth);
        if (!m) return json({ ok: false, error: "unauthorized" }, 401);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "bad_request" }, 400);
        }
        const token = (body as { gateway_token?: unknown } | null)?.gateway_token;
        if (typeof token !== "string" || token.length < 20 || token.length > 4096) {
          return json({ ok: false, error: "bad_request" }, 400);
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc(
            "zooga_rotate_gateway_credential" as never,
            { _bearer: m[1], _gateway_token: token } as never,
          );
          if (error || data !== true) return json({ ok: false, error: "unauthorized" }, 401);
          return json({ ok: true }, 200);
        } catch {
          return json({ ok: false, error: "unauthorized" }, 401);
        }
      },
    },
  },
});
