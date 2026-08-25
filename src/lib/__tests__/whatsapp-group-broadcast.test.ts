import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ALEX_CONNECTION_KEY,
  TAMAR_CONNECTION_KEY,
  canOwnGroupBroadcast,
  hasSecretLikeKey,
  isTamarConversationChannel,
  nextBroadcastStatus,
  sanitizeConnectionConfig,
  validateBroadcastDraft,
} from "@/lib/whatsapp-broadcast/core";

const ROOT = process.cwd();

const TAMAR = { transport: "meta_cloud_api", purpose: "conversation" } as const;
const ALEX = { transport: "whatsapp_web_bridge", purpose: "group_broadcast" } as const;

const BROADCAST_FILES = [
  "src/lib/whatsapp-broadcast/core.ts",
  "src/lib/whatsapp-broadcast.functions.ts",
  "src/routes/_app.broadcasts.tsx",
  "src/routes/_app.broadcasts.$id.tsx",
  "src/routes/_app.settings.whatsapp-connections.tsx",
].map((f) => join(ROOT, f));

describe("WhatsApp group broadcast — transport separation", () => {
  it("keeps two distinct connection keys", () => {
    expect(TAMAR_CONNECTION_KEY).toBe("tamar_meta");
    expect(ALEX_CONNECTION_KEY).toBe("alex_personal_web");
    expect(TAMAR_CONNECTION_KEY).not.toBe(ALEX_CONNECTION_KEY);
  });

  it("only Alex Personal (whatsapp_web_bridge + group_broadcast) may own broadcasts", () => {
    expect(canOwnGroupBroadcast(ALEX)).toBe(true);
    expect(canOwnGroupBroadcast(TAMAR)).toBe(false);
    expect(canOwnGroupBroadcast(null)).toBe(false);
    expect(canOwnGroupBroadcast({ transport: "meta_cloud_api", purpose: "group_broadcast" })).toBe(false);
    expect(canOwnGroupBroadcast({ transport: "whatsapp_web_bridge", purpose: "conversation" })).toBe(false);
  });

  it("recognizes Tamar as a Meta conversation channel that is never a broadcast owner", () => {
    expect(isTamarConversationChannel(TAMAR)).toBe(true);
    expect(isTamarConversationChannel(ALEX)).toBe(false);
    expect(isTamarConversationChannel(TAMAR) && canOwnGroupBroadcast(TAMAR)).toBe(false);
  });
});

describe("WhatsApp group broadcast — secrets hygiene", () => {
  it("drops every secret-like config key", () => {
    const cfg = sanitizeConnectionConfig({
      bridge_base_url: "https://bridge.example.com",
      status_path: "/status",
      qr_code: "data:image/png;base64,AAA",
      session_token: "abc",
      api_key: "sk-live",
      auth_header: "Bearer x",
      password: "p",
      nested: { a: 1 },
    });
    expect(cfg).toEqual({ bridge_base_url: "https://bridge.example.com", status_path: "/status" });
    expect(JSON.stringify(cfg)).not.toMatch(/sk-live|Bearer|base64/);
  });

  it("flags secret-like payloads before they reach the database", () => {
    expect(hasSecretLikeKey({ qr: "x" })).toBe(true);
    expect(hasSecretLikeKey({ session: "x" })).toBe(true);
    expect(hasSecretLikeKey({ bridge_base_url: "https://x" })).toBe(false);
  });

  it("never renders or stores QR/session values in broadcast code", () => {
    for (const file of BROADCAST_FILES) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/qr_?code|session_token|access_token|WHATSAPP_TOKEN|phone_number_id/i);
    }
  });
});

describe("WhatsApp group broadcast — control plane only", () => {
  it("introduces no fetch/send to WhatsApp Web or Meta", () => {
    for (const file of BROADCAST_FILES) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/\bfetch\(/);
      expect(src, file).not.toMatch(/graph\.facebook\.com|sendWhatsApp|sendTemplate|whatsapp-meta/);
    }
  });

  it("does not touch Tamar/Meta sender or webhook code", () => {
    for (const file of BROADCAST_FILES) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/tamar-engine|webhook\/tamar|whatsapp-templates\.server/);
    }
  });

  it("queued is a control-plane state derived from scheduling only", () => {
    expect(nextBroadcastStatus(null)).toBe("draft");
    expect(nextBroadcastStatus(new Date().toISOString())).toBe("queued");
  });

  it("validates drafts before anything is persisted", () => {
    const base = { title: "קיץ", message_text: "שלום", group_ids: ["g1"] };
    expect(validateBroadcastDraft(base).ok).toBe(true);
    expect(validateBroadcastDraft({ ...base, title: "" }).ok).toBe(false);
    expect(validateBroadcastDraft({ ...base, message_text: " " }).ok).toBe(false);
    expect(validateBroadcastDraft({ ...base, group_ids: [] }).ok).toBe(false);
    expect(validateBroadcastDraft({ ...base, media_url: "http://x.com/a.jpg" }).ok).toBe(false);
    expect(validateBroadcastDraft({ ...base, media_url: "https://x.com/a.jpg" }).ok).toBe(true);
    expect(validateBroadcastDraft({ ...base, scheduled_for: "not-a-date" }).ok).toBe(false);
  });

  it("server functions gate every entry point on admin and reject non-bridge connections", () => {
    const src = readFileSync(join(ROOT, "src/lib/whatsapp-broadcast.functions.ts"), "utf8");
    const handlers = src.match(/createServerFn\(\{/g) ?? [];
    const gates = src.match(/assertAdmin\(context\)/g) ?? [];
    expect(gates.length).toBe(handlers.length);
    expect(src).toContain("canOwnGroupBroadcast");
    expect(src).not.toMatch(/from\(\s*["'`](contacts|messages|manager_handoffs)["'`]/);
  });

  it("agent broadcasting stays disabled by default in the UI copy", () => {
    const src = readFileSync(join(ROOT, "src/routes/_app.settings.whatsapp-connections.tsx"), "utf8");
    expect(src).toContain("allow_agent_broadcast");
  });

  it("no other source file starts writing broadcasts", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(p)) out.push(p);
      }
      return out;
    };
    const writers = walk(join(ROOT, "src")).filter((f) => {
      if (f.includes("__tests__") || f.endsWith("types.ts") || f.endsWith("routeTree.gen.ts")) return false;
      return /from\(\s*["'`]whatsapp_broadcasts["'`]/.test(readFileSync(f, "utf8"));
    });
    expect(writers.map((f) => f.replace(`${ROOT}/`, "")).sort()).toEqual([
      "src/lib/whatsapp-broadcast-runner.functions.ts",
      "src/lib/whatsapp-broadcast.functions.ts",
      "src/lib/whatsapp-broadcast/runner.server.ts",
    ]);
  });
});
