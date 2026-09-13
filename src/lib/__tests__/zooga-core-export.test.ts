import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractGatewayToken,
  parseKind,
  parseLimit,
  nextCursor,
} from "@/routes/api/internal/zooga-core-export";

const SRC = readFileSync(
  join(process.cwd(), "src/routes/api/internal/zooga-core-export.ts"),
  "utf8",
);

describe("Zooga Core export adapter", () => {
  it("accepts only well-formed bearer tokens", () => {
    expect(extractGatewayToken(null)).toBeNull();
    expect(extractGatewayToken("Basic abc")).toBeNull();
    expect(extractGatewayToken("Bearer short")).toBeNull();
    expect(extractGatewayToken(`Bearer ${"t".repeat(24)}`)).toBe("t".repeat(24));
  });

  it("accepts only the supported kinds", () => {
    expect(parseKind("contact")).toBe("contact");
    expect(parseKind("catalog")).toBe("catalog");
    expect(parseKind("messages")).toBeNull();
    expect(parseKind(null)).toBeNull();
  });

  it("bounds the limit to 1..200", () => {
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("200")).toBe(200);
    expect(parseLimit("0")).toBeNull();
    expect(parseLimit("201")).toBeNull();
    expect(parseLimit("abc")).toBeNull();
  });

  it("derives next_cursor only from a full page's final external_ref", () => {
    expect(nextCursor([], 2)).toBeNull();
    expect(nextCursor([{ external_ref: "a" }], 2)).toBeNull();
    expect(nextCursor([{ external_ref: "a" }, { external_ref: "b" }], 2)).toBe("b");
  });

  it("is read-only and leaks no credentials, SQL or database errors", () => {
    expect(SRC).toContain("zooga_core_gateway_authorized");
    expect(SRC).not.toMatch(/\b(POST|PUT|PATCH|DELETE):/);
    expect(SRC).not.toMatch(/SERVICE_ROLE|SUPABASE_URL/);
    expect(SRC).not.toMatch(/error\.message|error\.details|JSON\.stringify\(error/);
    expect(SRC).not.toMatch(/\.from\(/);
    expect(SRC).toContain('"cache-control": "no-store"');
  });

  it("touches no group broadcast or messaging surface", () => {
    expect(SRC).not.toMatch(/broadcast|group|sendWhatsApp|alex/i);
  });
});
