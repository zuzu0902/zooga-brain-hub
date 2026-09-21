import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractGatewayToken,
  parseKind,
  parseLimit,
  normalizeExportPhone,
} from "@/routes/api/internal/zooga-core-export";

const SRC = readFileSync(
  join(process.cwd(), "src/routes/api/internal/zooga-core-export.ts"),
  "utf8",
);

const MIGRATION = readFileSync(
  join(process.cwd(), "drizzle/migrations/0002_zooga_core_read_conversation_history.sql"),
  "utf8",
);

describe("conversation history export — auth and parameters", () => {
  it("still requires a well-formed gateway bearer token", () => {
    expect(extractGatewayToken(null)).toBeNull();
    expect(extractGatewayToken("Bearer short")).toBeNull();
    expect(extractGatewayToken(`Bearer ${"t".repeat(24)}`)).toBe("t".repeat(24));
  });

  it("accepts conversation as a kind and rejects anything else", () => {
    expect(parseKind("conversation")).toBe("conversation");
    expect(parseKind("contact")).toBe("contact");
    expect(parseKind("catalog")).toBe("catalog");
    expect(parseKind("messages")).toBeNull();
    expect(parseKind("contacts; select 1")).toBeNull();
    expect(parseKind(null)).toBeNull();
  });

  it("bounds the conversation limit to 1..100", () => {
    expect(parseLimit(null, "conversation")).toBe(50);
    expect(parseLimit("1", "conversation")).toBe(1);
    expect(parseLimit("100", "conversation")).toBe(100);
    expect(parseLimit("101", "conversation")).toBeNull();
    expect(parseLimit("0", "conversation")).toBeNull();
    expect(parseLimit("abc", "conversation")).toBeNull();
    // other kinds keep their existing 200 ceiling
    expect(parseLimit("200", "contact")).toBe(200);
  });
});

describe("conversation history export — phone normalization", () => {
  it("normalizes Israeli +972 / 972 / 0 variants to one canonical value", () => {
    const canonical = "972512277533";
    expect(normalizeExportPhone("+972512277533")).toBe(canonical);
    expect(normalizeExportPhone("972512277533")).toBe(canonical);
    expect(normalizeExportPhone("00972512277533")).toBe(canonical);
    expect(normalizeExportPhone("0512277533")).toBe(canonical);
    expect(normalizeExportPhone("+972-51-227-7533")).toBe(canonical);
    expect(normalizeExportPhone("+9720512277533")).toBe(canonical);
  });

  it("normalizes a bare 9-digit mobile", () => {
    expect(normalizeExportPhone("512277533")).toBe("972512277533");
  });

  it("rejects unusable phone input", () => {
    expect(normalizeExportPhone(null)).toBeNull();
    expect(normalizeExportPhone("")).toBeNull();
    expect(normalizeExportPhone("abc")).toBeNull();
    expect(normalizeExportPhone("123")).toBeNull();
    expect(normalizeExportPhone("1".repeat(20))).toBeNull();
  });
});

describe("conversation history export — route contract safety", () => {
  it("fails safely on an invalid phone and stays read-only", () => {
    expect(SRC).toContain('error_code: "invalid_phone"');
    expect(SRC).toContain('error_code: "invalid_limit"');
    expect(SRC).toContain('error_code: "invalid_kind"');
    expect(SRC).toContain('error_code: "unauthorized"');
    expect(SRC).not.toMatch(/\b(POST|PUT|PATCH|DELETE):/);
  });

  it("exposes no arbitrary table or query parameter", () => {
    expect(SRC).not.toMatch(/\.from\(/);
    expect(SRC).not.toMatch(/searchParams\.get\("(table|sql|query|select)"\)/);
    expect(SRC).toContain("zooga_core_read_conversation_history");
  });

  it("logs no message text and leaks no credentials", () => {
    expect(SRC).not.toMatch(/console\.(log|info|warn|error)/);
    expect(SRC).not.toMatch(/SERVICE_ROLE|SUPABASE_URL/);
    expect(SRC).not.toMatch(/error\.message|error\.details/);
  });

  it("touches no group broadcast or sending surface", () => {
    expect(SRC).not.toMatch(/broadcast|group|sendWhatsApp/i);
  });
});

describe("conversation history export — migration guarantees", () => {
  it("is gateway-authorized, security definer and service-role only", () => {
    expect(MIGRATION).toContain("zooga_core_gateway_authorized");
    expect(MIGRATION).toContain("SECURITY DEFINER");
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  });

  it("bounds results to 100 and returns them chronologically", () => {
    expect(MIGRATION).toContain("least(coalesce(_limit, 50), 100)");
    expect(MIGRATION).toContain("ORDER BY c.occurred_at ASC");
  });

  it("performs no writes and no data destruction", () => {
    expect(MIGRATION).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP TABLE|TRUNCATE)\b/i);
    expect(MIGRATION).toMatch(/STABLE SECURITY DEFINER/);
  });
});
