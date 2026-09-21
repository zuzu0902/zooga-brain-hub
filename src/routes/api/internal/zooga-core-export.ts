/**
 * ZOOGA CORE MIGRATION BRIDGE — temporary, read-only CRM export adapter.
 *
 * GET /api/internal/zooga-core-export?kind=contact|catalog&cursor=&limit=
 *
 * Auth: Authorization: Bearer <gateway token>, validated ONLY through the
 * public.zooga_core_gateway_authorized RPC. No arbitrary SQL/table access,
 * no write method, no secret or database-error disclosure.
 */
import { createFileRoute } from "@tanstack/react-router";

const KIND_RPC = {
  contact: "zooga_core_read_contact_context",
  catalog: "zooga_core_read_catalog_context",
  conversation: "zooga_core_read_conversation_history",
} as const;

type ExportKind = keyof typeof KIND_RPC;

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

export function parseKind(raw: string | null): ExportKind | null {
  return raw === "contact" || raw === "catalog" || raw === "conversation" ? raw : null;
}

/** Returns a bounded limit, or null when the value is present but invalid. */
export function parseLimit(raw: string | null, kind: ExportKind = "contact"): number | null {
  const max = kind === "conversation" ? 100 : 200;
  if (raw === null || raw === "") return 50;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1 || n > max) return null;
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

export function nextCursor(rows: Array<{ external_ref?: string }>, limit: number): string | null {
  if (rows.length < limit || rows.length === 0) return null;
  return rows[rows.length - 1]?.external_ref ?? null;
}

export const Route = createFileRoute("/api/internal/zooga-core-export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = extractGatewayToken(request.headers.get("authorization"));
        if (!token) return json({ ok: false, error_code: "unauthorized" }, 401);

        const url = new URL(request.url);
        const kind = parseKind(url.searchParams.get("kind"));
        if (!kind) return json({ ok: false, error_code: "invalid_kind" }, 400);
        const limit = parseLimit(url.searchParams.get("limit"), kind);
        if (limit === null) return json({ ok: false, error_code: "invalid_limit" }, 400);
        const cursorParam = url.searchParams.get("cursor");
        const cursor = cursorParam && cursorParam.length > 0 ? cursorParam : undefined;
        const phone =
          kind === "conversation" ? normalizeExportPhone(url.searchParams.get("phone")) : null;
        if (kind === "conversation" && !phone) {
          return json({ ok: false, error_code: "invalid_phone" }, 400);
        }

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
          const params =
            kind === "conversation"
              ? { _gateway_token: token, _phone: phone, _limit: limit }
              : { _gateway_token: token, _cursor: cursor, _limit: limit };
          const { data, error } = await (supabaseAdmin as any).rpc(KIND_RPC[kind], params);
          if (error) return json({ ok: false, error_code: "read_unavailable" }, 503);
          const rows = Array.isArray(data) ? data : [];
          if (kind === "conversation") {
            return json({ ok: true, kind, rows, next_cursor: null });
          }
          return json({ ok: true, kind, rows, next_cursor: nextCursor(rows, limit) });
        } catch {
          return json({ ok: false, error_code: "read_unavailable" }, 503);
        }
      },
    },
  },
});
