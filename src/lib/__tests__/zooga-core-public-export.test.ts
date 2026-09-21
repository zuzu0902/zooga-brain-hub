import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractGatewayToken,
  parsePublicKind,
  parsePublicLimit,
  normalizeExportPhone,
  normalizeTranscriptRow,
} from "@/routes/api/public/zooga-core-export";

const SRC = readFileSync(
  join(process.cwd(), "src/routes/api/public/zooga-core-export.ts"),
  "utf8",
);

const INTERNAL = readFileSync(
  join(process.cwd(), "src/routes/api/internal/zooga-core-export.ts"),
  "utf8",
);

describe("public conversation export — authorization", () => {
  it("requires a well-formed bearer token of at least 20 chars", () => {
    expect(extractGatewayToken(null)).toBeNull();
    expect(extractGatewayToken("Basic abc")).toBeNull();
    expect(extractGatewayToken("Bearer short")).toBeNull();
    expect(extractGatewayToken(`Bearer ${"t".repeat(19)}`)).toBeNull();
    expect(extractGatewayToken(`Bearer ${"t".repeat(20)}`)).toBe("t".repeat(20));
  });

  it("authorizes only through the database RPC, never an env secret", () => {
    expect(SRC).toContain("zooga_core_gateway_authorized");
    expect(SRC).not.toMatch(/process\.env/);
    expect(SRC).not.toMatch(/GATEWAY_TOKEN|SERVICE_ROLE|SUPABASE_URL/);
  });
});

describe("public conversation export — parameters", () => {
  it("accepts kind=conversation only", () => {
    expect(parsePublicKind("conversation")).toBe("conversation");
    expect(parsePublicKind("contact")).toBeNull();
    expect(parsePublicKind("catalog")).toBeNull();
    expect(parsePublicKind(null)).toBeNull();
  });

  it("bounds the limit to 1..100 with a default of 50", () => {
    expect(parsePublicLimit(null)).toBe(50);
    expect(parsePublicLimit("")).toBe(50);
    expect(parsePublicLimit("1")).toBe(1);
    expect(parsePublicLimit("100")).toBe(100);
    expect(parsePublicLimit("0")).toBeNull();
    expect(parsePublicLimit("101")).toBeNull();
    expect(parsePublicLimit("abc")).toBeNull();
  });

  it("normalizes Israeli phone variants identically to the internal route", () => {
    const canonical = "972512277533";
    expect(normalizeExportPhone("+972512277533")).toBe(canonical);
    expect(normalizeExportPhone("972512277533")).toBe(canonical);
    expect(normalizeExportPhone("00972512277533")).toBe(canonical);
    expect(normalizeExportPhone("0512277533")).toBe(canonical);
    expect(normalizeExportPhone("+972-51-227-7533")).toBe(canonical);
    expect(normalizeExportPhone("512277533")).toBe(canonical);
  });

  it("rejects unusable phone input", () => {
    expect(normalizeExportPhone(null)).toBeNull();
    expect(normalizeExportPhone("abc")).toBeNull();
    expect(normalizeExportPhone("123")).toBeNull();
    expect(normalizeExportPhone("1".repeat(20))).toBeNull();
  });
});

describe("public conversation export — safety", () => {
  it("is read-only and fails safely", () => {
    expect(SRC).not.toMatch(/\b(POST|PUT|PATCH|DELETE):/);
    expect(SRC).not.toMatch(/\.from\(/);
    expect(SRC).toContain('error_code: "invalid_phone"');
    expect(SRC).toContain('error_code: "invalid_limit"');
    expect(SRC).toContain('error_code: "invalid_kind"');
    expect(SRC).toContain('error_code: "unauthorized"');
    expect(SRC).toContain('"cache-control": "no-store"');
  });

  it("logs nothing and discloses no database errors", () => {
    expect(SRC).not.toMatch(/console\.(log|info|warn|error)/);
    expect(SRC).not.toMatch(/error\.message|error\.details|JSON\.stringify\(error/);
  });

  it("touches no group broadcast or sending surface", () => {
    expect(SRC).not.toMatch(/broadcast|group|sendWhatsApp/i);
  });

  it("leaves the internal route contract unchanged", () => {
    expect(INTERNAL).toContain('createFileRoute("/api/internal/zooga-core-export")');
    expect(INTERNAL).toContain("zooga_core_read_contact_context");
    expect(INTERNAL).toContain("zooga_core_read_catalog_context");
    expect(INTERNAL).toContain("zooga_core_read_conversation_history");
  });
});

describe("public conversation export — 500 hardening", () => {
  it("wraps the whole handler so no unexpected throw escapes as a 500", () => {
    const handler = SRC.slice(SRC.indexOf("GET: async"));
    expect(handler).toMatch(/GET: async \(\{ request \}\) => \{\s*try \{/);
    expect(handler).toContain('return json({ ok: false, error_code: "read_unavailable" }, 503);');
    expect(SRC).toContain('await import("@/integrations/supabase/client.server")');
    // the dynamic import must itself be guarded
    expect(SRC).toMatch(/try \{\s*const mod = await import/);
    expect(SRC).toContain('typeof client.rpc !== "function"');
  });

  it("maps database-level auth and phone errors to their strict status codes", () => {
    expect(SRC).toContain('code === "28000"');
    expect(SRC).toContain('code === "22023"');
  });

  it("normalizes rows defensively, including rows with no message text", () => {
    expect(
      normalizeTranscriptRow({
        direction: "outbound",
        occurred_at: "2026-09-21T18:01:11.284Z",
        status: "sent",
        provider_message_id: "wamid.X",
        message_text: "x",
      }),
    ).toEqual({
      direction: "outbound",
      occurred_at: "2026-09-21T18:01:11.284Z",
      status: "sent",
      provider_message_id: "wamid.X",
      message_text: "x",
    });

    expect(normalizeTranscriptRow({ direction: "inbound" })).toEqual({
      direction: "inbound",
      occurred_at: null,
      status: null,
      provider_message_id: null,
      message_text: null,
    });

    expect(normalizeTranscriptRow({ direction: "inbound", message_text: "" })?.message_text).toBeNull();
    expect(normalizeTranscriptRow(null)).toBeNull();
    expect(normalizeTranscriptRow("nope")).toBeNull();
  });

  it("serializes Date timestamps and defaults unknown directions to inbound", () => {
    const d = new Date("2026-09-21T18:01:11.284Z");
    expect(normalizeTranscriptRow({ direction: "weird", occurred_at: d })).toEqual({
      direction: "inbound",
      occurred_at: "2026-09-21T18:01:11.284Z",
      status: null,
      provider_message_id: null,
      message_text: null,
    });
  });

  it("still requires a bearer token of at least 20 characters", () => {
    expect(extractGatewayToken("Bearer short")).toBeNull();
    expect(extractGatewayToken(null)).toBeNull();
    expect(extractGatewayToken("Bearer " + "a".repeat(24))).toBe("a".repeat(24));
  });
});
