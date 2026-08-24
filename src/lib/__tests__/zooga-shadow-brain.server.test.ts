import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const tenantRow = vi.fn();
const configRow = vi.fn();
const usageRow = vi.fn();
const leasedCount = vi.fn();
const writes = vi.fn();

function selectChain(terminal: () => Promise<unknown>) {
  const self: any = {
    eq: () => self,
    limit: () => terminal(),
    maybeSingle: () => terminal(),
    then: (ok: any, err: any) => terminal().then(ok, err),
  };
  return self;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...a: unknown[]) => {
      writes("rpc", ...a);
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => ({
      select: (_cols?: unknown, opts?: any) => {
        if (table === "tenants") return selectChain(() => tenantRow());
        if (table === "zooga_shadow_brain_config") return selectChain(() => configRow());
        if (table === "zooga_shadow_brain_usage") return selectChain(() => usageRow());
        if (table === "zooga_shadow_runs" && opts?.head) return selectChain(() => leasedCount());
        return selectChain(() => Promise.resolve({ data: [], error: null }));
      },
      insert: (...a: unknown[]) => {
        writes("insert", table, ...a);
        return Promise.resolve({ error: null });
      },
      update: (...a: unknown[]) => {
        writes("update", table, ...a);
        return selectChain(() => Promise.resolve({ error: null }));
      },
      upsert: (...a: unknown[]) => {
        writes("upsert", table, ...a);
        return Promise.resolve({ error: null });
      },
      delete: (...a: unknown[]) => {
        writes("delete", table, ...a);
        return selectChain(() => Promise.resolve({ error: null }));
      },
    }),
  },
}));

const { getShadowBrainStatus } = await import("@/lib/zooga-gateway/shadow-brain.server");

beforeEach(() => {
  writes.mockReset();
  tenantRow.mockResolvedValue({ data: { id: "tenant-zooga" }, error: null });
  configRow.mockResolvedValue({ data: null, error: null });
  usageRow.mockResolvedValue({ data: null, error: null });
  leasedCount.mockResolvedValue({ data: null, count: 0, error: null });
});

describe("shadow brain admin status (read-only)", () => {
  it("reports OFF with zero usage when no config row exists", async () => {
    const s = await getShadowBrainStatus();
    expect(s.enabled).toBe(false);
    expect(s.requests_today).toBe(0);
    expect(s.cost_usd_today).toBe(0);
  });

  it("performs no write of any kind", async () => {
    await getShadowBrainStatus();
    expect(writes).not.toHaveBeenCalled();
  });

  it("projects configured limits and today's usage", async () => {
    configRow.mockResolvedValue({
      data: {
        enabled: false,
        model_id: "gpt-5.6-luna",
        model_version: "2026-08-01",
        prompt_version: "zooga_shadow_brain_v1",
        daily_request_limit: 20,
        daily_input_token_limit: 20000,
        daily_output_token_limit: 4000,
        daily_cost_limit_usd: 0.05,
      },
      error: null,
    });
    usageRow.mockResolvedValue({
      data: { requests: 4, successes: 3, errors: 1, input_tokens: 1200, output_tokens: 300, cost_usd: 0.0045 },
      error: null,
    });
    leasedCount.mockResolvedValue({ data: null, count: 2, error: null });

    const s = await getShadowBrainStatus();
    expect(s).toMatchObject({
      enabled: false,
      model_id: "gpt-5.6-luna",
      prompt_version: "zooga_shadow_brain_v1",
      requests_today: 4,
      successes_today: 3,
      errors_today: 1,
      input_tokens_today: 1200,
      output_tokens_today: 300,
      daily_request_limit: 20,
      daily_cost_limit_usd: 0.05,
      leased_runs: 2,
    });
  });

  it("degrades to safe defaults on backend failure", async () => {
    tenantRow.mockResolvedValue({ data: null, error: { message: "x" } });
    const s = await getShadowBrainStatus();
    expect(s.enabled).toBe(false);
    expect(s.leased_runs).toBe(0);
  });
});

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}
const ZOOGA_FILES = [
  ...walk(join(ROOT, "src/lib/zooga-gateway")),
  join(ROOT, "src/routes/api/zooga/gateway-status.ts"),
  join(ROOT, "src/routes/api/public/cron/zooga-shadow-drain.ts"),
  join(ROOT, "src/components/zooga-core-card.tsx"),
].filter(existsSync);

describe("no OpenAI key or model call ever lives in Lovable", () => {
  it("never reads an OpenAI key or posts to the OpenAI API", () => {
    for (const file of ZOOGA_FILES) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toContain("OPENAI_API_KEY");
      expect(src, file).not.toContain("api.openai.com");
      expect(src, file).not.toMatch(/sk-[A-Za-z0-9]/);
    }
  });

  it("keeps the protected scheduler on transport/maintenance only", () => {
    const src = readFileSync(join(ROOT, "src/routes/api/public/cron/zooga-shadow-drain.ts"), "utf8");
    expect(src).toContain("drainShadowOutbox");
    expect(src).toContain("pruneShadowRuns");
    expect(src).not.toContain("zooga_brain_claim_runs");
    expect(src).not.toContain("openai");
  });

  it("never references LORA", () => {
    for (const file of ZOOGA_FILES) {
      expect(readFileSync(file, "utf8").toLowerCase(), file).not.toContain("lora");
    }
  });
});
