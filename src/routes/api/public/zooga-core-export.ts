/**
 * ZOOGA CORE — publicly reachable, token-authenticated, READ-ONLY
 * conversation transcript export for the Hostinger Chief of Staff CLI.
 *
 * GET /api/public/zooga-core-export?kind=conversation&phone=<exact>&limit=<1..100>
 *
 * Auth: Authorization: Bearer <gateway token>, validated ONLY through the
 * public.zooga_core_gateway_authorized RPC (SHA-256 digest comparison in the
 * database). No env secret, no arbitrary SQL/table access, no write method,
 * no message-text logging, no secret or database-error disclosure.
 *
 * /api/internal/zooga-core-export is intentionally left unchanged.
 */
import { createFileRoute } from "@tanstack/react-router";

const CONVERSATION_RPC = "zooga_core_read_conversation_history";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Extracts the bearer token, or null when the header is missing/malformed. */
export function extractGatewayToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length >= 20 ? token : null;
}

/** The public surface exposes the conversation transcript only. */
export function parsePublicKind(raw: string | null): "conversation" | null {
  return raw === "conversation" ? "conversation" : null;
}

/** Returns a bounded limit 1..100, or null when present but invalid. */
export function parsePublicLimit(raw: string | null): number | null {
  if (raw === null || raw === "") return 50;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1 || n > 100) return null;
  return n;
}

/**
 * Normalizes an exact phone parameter to bare MSISDN digits (Israeli
 * +972 / 972 / 05X variants included). Returns null when unusable.
 */
export function normalizeExportPhone(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("972")) d = "972" + d.slice(3).replace(/^0+/, "");
  else if (d.startsWith("0")) d = "972" + d.slice(1).replace(/^0+/, "");
  else if (d.length === 9 && d.startsWith("5")) d = "972" + d;
  if (d.length < 8 || d.length > 15) return null;
  return d;
}

export const Route = createFileRoute("/api/public/zooga-core-export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = extractGatewayToken(request.headers.get("authorization"));
        if (!token) return json({ ok: false, error_code: "unauthorized" }, 401);

        const url = new URL(request.url);
        const kind = parsePublicKind(url.searchParams.get("kind"));
        if (!kind) return json({ ok: false, error_code: "invalid_kind" }, 400);
        const limit = parsePublicLimit(url.searchParams.get("limit"));
        if (limit === null) return json({ ok: false, error_code: "invalid_limit" }, 400);
        const phone = normalizeExportPhone(url.searchParams.get("phone"));
        if (!phone) return json({ ok: false, error_code: "invalid_phone" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let authorized = false;
        try {
          const { data, error } = await (supabaseAdmin as any).rpc(
            "zooga_core_gateway_authorized",
            { _gateway_token: token },
          );
          authorized = !error && data === true;
        } catch {
          authorized = false;
        }
        if (!authorized) return json({ ok: false, error_code: "unauthorized" }, 401);

        try {
          const { data, error } = await (supabaseAdmin as any).rpc(CONVERSATION_RPC, {
            _gateway_token: token,
            _phone: phone,
            _limit: limit,
          });
          if (error) return json({ ok: false, error_code: "read_unavailable" }, 503);
          const rows = Array.isArray(data) ? data : [];
          return json({ ok: true, kind, rows, next_cursor: null });
        } catch {
          return json({ ok: false, error_code: "read_unavailable" }, 503);
        }
      },
    },
  },
});
