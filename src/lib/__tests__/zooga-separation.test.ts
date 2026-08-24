import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const CRON_ROUTE = join(ROOT, "src/routes/api/public/cron/zooga-shadow-drain.ts");

const ZOOGA_FILES = [
  ...walk(join(ROOT, "src/lib/zooga-gateway")),
  join(ROOT, "src/routes/api/zooga/gateway-status.ts"),
  join(ROOT, "src/components/zooga-core-card.tsx"),
  CRON_ROUTE,
].filter(existsSync);

describe("Zooga separation from the legacy Tamar/Meta integration", () => {
  it("covers the expected Zooga source files", () => {
    expect(ZOOGA_FILES.length).toBeGreaterThanOrEqual(4);
  });

  it("never reads or references api_settings.webhook_token", () => {
    for (const file of ZOOGA_FILES) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toContain("webhook_token");
      expect(src, file).not.toContain("api_settings");
      expect(src, file).not.toContain("x-api-token");
    }
  });

  it("allows the dedicated cron route only with Zooga-only scheduler auth", () => {
    const cronDir = join(ROOT, "src/routes/api/public/cron");
    const zoogaCrons = existsSync(cronDir)
      ? readdirSync(cronDir).filter((f) => f.toLowerCase().includes("zooga"))
      : [];
    expect(zoogaCrons).toEqual(["zooga-shadow-drain.ts"]);

    const src = readFileSync(CRON_ROUTE, "utf8");
    expect(src).toContain("zooga_verify_scheduler_token_hash");
    expect(src).toContain('createHash("sha256")');
    expect(src).toContain("drainShadowOutbox");
  });

  it("rejects missing or malformed scheduler authorization", async () => {
    const { extractBearerToken } = await import("@/routes/api/public/cron/zooga-shadow-drain");
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken("Bearer short")).toBeNull();
    expect(extractBearerToken(`Bearer ${"a".repeat(40)}`)).toBe("a".repeat(40));
  });


  it("keeps the admin-authenticated POST as the only drain trigger", () => {
    const route = readFileSync(join(ROOT, "src/routes/api/zooga/gateway-status.ts"), "utf8");
    expect(route).toContain("requireAdmin");
    expect(route).toMatch(/POST:\s*async/);
    expect(route).toContain("drainShadowOutbox");

    const callers = walk(join(ROOT, "src")).filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes("drainShadowOutbox") && !f.endsWith("shadow-outbox.server.ts") && !f.includes("__tests__");
    });
    expect(callers.map((f) => f.replace(`${ROOT}/`, ""))).toEqual(["src/routes/api/zooga/gateway-status.ts"]);
  });

  it("logs only a fixed safe code when the webhook shadow enqueue fails", () => {
    const src = readFileSync(join(ROOT, "src/routes/api/public/webhook/tamar.ts"), "utf8");
    expect(src).toContain('console.warn("[zooga-shadow] enqueue_failed")');
    expect(src).not.toMatch(/\[zooga-shadow\][^\n]*shadowErr/);
  });
});
