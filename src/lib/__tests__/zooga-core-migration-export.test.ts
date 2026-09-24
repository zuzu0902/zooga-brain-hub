import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc } }));

import {
  MIGRATION_KINDS,
  Route,
  isMigrationKind,
  parseCursor,
  parseKind,
  parseLimit,
  nextCursor,
} from "@/routes/api/internal/zooga-core-export";

const SRC = readFileSync(join(process.cwd(), "src/routes/api/internal/zooga-core-export.ts"), "utf8");
const SQL = readFileSync(
  join(process.cwd(), "drizzle/migrations/0005_zooga_core_read_migration_history.sql"),
  "utf8",
);
// 0006 supersedes the function body from 0005 (applied migrations are immutable).
const SQL6 = readFileSync(
  join(process.cwd(), "drizzle/migrations/0006_zooga_core_migration_history_runtime_audit.sql"),
  "utf8",
);
const TOKEN = "g".repeat(32);

const EXPECTED = [
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
];

const GET = (Route as any).options.server.handlers.GET as (a: { request: Request }) => Promise<Response>;
function call(qs: string, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  return GET({ request: new Request(`https://x/api/internal/zooga-core-export?${qs}`, { headers }) });
}

beforeEach(() => rpc.mockReset());

describe("migration export — kind allowlist", () => {
  it("exposes exactly the approved kinds", () => {
    expect([...MIGRATION_KINDS]).toEqual(EXPECTED);
    for (const k of EXPECTED) expect(parseKind(k)).toBe(k);
  });

  it("rejects table names, SQL and unknown kinds", () => {
    for (const bad of ["messages", "contacts", "whatsapp_broadcasts", "whatsapp_groups", "tamar_runtime_executions", "api_settings", "x; drop table", ""]) {
      expect(parseKind(bad)).toBeNull();
      expect(isMigrationKind(bad)).toBe(false);
    }
  });

  it("database function enforces the same allowlist", () => {
    for (const k of EXPECTED) expect(SQL).toContain(`'${k}'`);
    expect(SQL).toContain("zooga_core_invalid_kind");
  });
});

describe("migration export — limits and cursor", () => {
  it("bounds limits to 1..200 and validates cursors", () => {
    expect(parseLimit(null, "message_history")).toBe(50);
    expect(parseLimit("200", "tamar_audit_record")).toBe(200);
    expect(parseLimit("201", "task_history")).toBeNull();
    expect(parseLimit("0", "task_history")).toBeNull();
    expect(parseCursor(null)).toBeUndefined();
    expect(parseCursor("tamar_prompt_blocks:3f1c-uuid")).toBe("tamar_prompt_blocks:3f1c-uuid");
    expect(parseCursor("a' or 1=1")).toBeNull();
    expect(parseCursor("a".repeat(201))).toBeNull();
    expect(nextCursor([{ external_ref: "a" }, { external_ref: "b" }], 2)).toBe("b");
    expect(SQL).toContain("least(coalesce(_limit, 50), 200)");
    expect(SQL).toMatch(/ORDER BY t\.id::text/);
  });
});

describe("migration export — route behavior", () => {
  it("requires a bearer token before any database call", async () => {
    const res = await call("kind=message_history", null);
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects when the gateway digest check fails", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    const res = await call("kind=message_history");
    expect(res.status).toBe(401);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown kinds and bad cursors without touching the database", async () => {
    expect((await call("kind=whatsapp_broadcasts")).status).toBe(400);
    expect((await call("kind=message_history&cursor=%27%3B")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes only the allowlisted kind, cursor and limit to the single RPC", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const rows = [
      { external_ref: "a", source_system: "zooga_os_lovable", contact_external_ref: "c1", source_created_at: "t", payload: {} },
      { external_ref: "b", source_system: "zooga_os_lovable", contact_external_ref: "c1", source_created_at: "t", payload: {} },
    ];
    rpc.mockResolvedValueOnce({ data: rows, error: null });
    const res = await call("kind=task_history&limit=2&cursor=abc&table=contacts&sql=select");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, kind: "task_history", rows, next_cursor: "b" });
    expect(rpc).toHaveBeenLastCalledWith("zooga_core_read_migration_history", {
      _gateway_token: TOKEN,
      _kind: "task_history",
      _cursor: "abc",
      _limit: 2,
    });
  });

  it("hides database errors", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "relation secret_table" } });
    const res = await call("kind=tamar_audit_record");
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("secret_table");
  });
});

describe("migration export — read-only, no group surfaces, no arbitrary tables", () => {
  it("route has no write method and no table/sql parameters", () => {
    expect(SRC).not.toMatch(/\b(POST|PUT|PATCH|DELETE):/);
    expect(SRC).not.toMatch(/\.from\(/);
    expect(SRC).not.toMatch(/searchParams\.get\("(table|sql|query|select)"\)/);
  });

  it("migration is read-only, definer, gateway-gated and service-role only", () => {
    expect(SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER TABLE|EXECUTE format)\b/i);
    expect(SQL).toContain("STABLE SECURITY DEFINER");
    expect(SQL).toContain("zooga_core_gateway_authorized");
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.zooga_core_read_migration_history[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.zooga_core_read_migration_history[\s\S]*TO service_role/);
  });

  it("reads no group/broadcast, credential or runtime output tables", () => {
    const tables = [...SQL.matchAll(/FROM public\.([a-z_]+)/g)].map((m) => m[1]);
    for (const t of tables) {
      expect(t).not.toMatch(/whatsapp|broadcast|group|api_settings|gateway_credentials|tamar_runtime_executions|connections/);
    }
    const tables6 = [...SQL6.matchAll(/FROM public\.([a-z_]+)/g)].map((m) => m[1]);
    for (const t of tables6) expect(t).not.toMatch(/whatsapp|broadcast|group|api_settings|gateway_credentials|connections/);
    expect(SQL).toContain("zooga_core_strip_sensitive");
  });

  it("every row carries external_ref, source_system, contact ref, timestamps and payload", () => {
    expect(SQL).toMatch(/RETURNS TABLE\(external_ref text, source_system text, source_table text, contact_external_ref text,\s*source_created_at timestamp with time zone, source_updated_at timestamp with time zone, payload jsonb\)/);
  });

  it("0006 keeps allowlist, read-only posture and grants", () => {
    for (const k of EXPECTED) expect(SQL6).toContain(`'${k}'`);
    expect(SQL6).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER TABLE|EXECUTE format)\b/i);
    expect(SQL6).toContain("STABLE SECURITY DEFINER");
    expect(SQL6).toContain("zooga_core_gateway_authorized");
    expect(SQL6).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  });
});

describe("migration export — sanitized runtime execution audit (0006)", () => {
  const block = SQL6.slice(SQL6.indexOf("'tamar_runtime_executions:'"), SQL6.indexOf("FROM public.tamar_runtime_executions r"));

  it("adds tamar_runtime_executions to the tamar_audit_record union with metadata", () => {
    expect(block.length).toBeGreaterThan(0);
    for (const f of ["contact_id", "created_at", "channel", "source", "runtime_mode", "runtime_pack_fetch_ok", "composition_version", "deployment_sha", "latency_ms", "fallback_reason", "has_error", "conversation_mode", "conversation_mode_reasons", "prompt_blocks_injected", "offer_intelligence_injected", "campaign_injected"]) {
      expect(block).toContain(`'${f}'`);
    }
  });

  it("never reads or exports message content, raw payloads or free-text errors", () => {
    expect(block).not.toMatch(/to_jsonb\(r\)/);
    for (const f of ["inbound_message", "outbound_reply", "output_text", "raw_payload"]) {
      expect(block).not.toMatch(new RegExp(`\\b${f}\\b`));
    }
    expect(block).not.toMatch(/'error',/);
    expect(block).not.toMatch(/secret|token|password|credential/i);
  });
});
