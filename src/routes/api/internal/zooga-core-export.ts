/**
 * ZOOGA CORE MIGRATION BRIDGE — temporary, read-only CRM export adapter.
 *
 * GET /api/internal/zooga-core-export?kind=<allowlisted kind>&cursor=&limit=
 *
 * Migration kinds (paginated, read-only) go through the single static
 * zooga_core_read_migration_history RPC; the kind is allowlisted here and
 * again inside the database function. No table name ever comes from input.
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

/** Allowlisted, paginated, read-only migration kinds (see migration 0005). */
export const MIGRATION_KINDS = [
  "interaction_history",
  "message_history",
  "conversation_turn_history",
  "task_history",
  "contact_memory_history",
  "contact_profile_fact_history",
  "contact_profile_change_history",
  "manager_handoff_history",
  "organizational_knowledge_source",
  "organizational_knowledge_chunk",
  "tamar_audit_record",
] as const;

export type MigrationKind = (typeof MIGRATION_KINDS)[number];
const MIGRATION_RPC = "zooga_core_read_migration_history";
const MAX_CURSOR_LENGTH = 200;

type ExportKind = keyof typeof KIND_RPC | MigrationKind;

export function isMigrationKind(kind: string | null): kind is MigrationKind {
  return kind !== null && (MIGRATION_KINDS as readonly string[]).includes(kind);
}

/** Returns a cursor, undefined when absent, or null when present but invalid. */
export function parseCursor(raw: string | null): string | undefined | null {
  if (raw === null || raw === "") return undefined;
  if (raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_:\-]+$/.test(raw)) return null;
  return raw;
}

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
  if (raw === "contact" || raw === "catalog" || raw === "conversation") return raw;
  return isMigrationKind(raw) ? raw : null;
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
        const cursor = parseCursor(url.searchParams.get("cursor"));
        if (cursor === null) return json({ ok: false, error_code: "invalid_cursor" }, 400);
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
          if (isMigrationKind(kind)) {
            const { data, error } = await (supabaseAdmin as any).rpc(MIGRATION_RPC, {
              _gateway_token: token,
              _kind: kind,
              _cursor: cursor ?? null,
              _limit: limit,
            });
            if (error) return json({ ok: false, error_code: "read_unavailable" }, 503);
            const rows = Array.isArray(data) ? data : [];
            return json({ ok: true, kind, rows, next_cursor: nextCursor(rows, limit) });
          }
          const params =
            kind === "conversation"
              ? { _gateway_token: token, _phone: phone, _limit: limit }
              : { _gateway_token: token, _cursor: cursor, _limit: limit };
          const { data, error } = await (supabaseAdmin as any).rpc(KIND_RPC[kind as keyof typeof KIND_RPC], params);
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
