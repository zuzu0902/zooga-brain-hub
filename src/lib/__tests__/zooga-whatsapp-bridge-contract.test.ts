/**
 * ZOOGA OS — control-plane bridge contract tests.
 * Asserts sanitization, conservative group sync, live-send default OFF,
 * strict Tamar/Meta separation and no browser-to-bridge calls.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_PATHS,
  computeGroupSyncPlan,
  isLiveSendEnabled,
  normalizeBridgeGroups,
  normalizeBridgeStatus,
  type ExistingGroupRow,
} from "@/lib/zooga-whatsapp-bridge/bridge-contract";

const SRC = join(process.cwd(), "src");
const BRIDGE_SERVICE = join(process.cwd(), "services", "zooga-whatsapp-bridge");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("bridge path contract", () => {
  it("matches the deployed service routes", () => {
    const router = readFileSync(join(BRIDGE_SERVICE, "src", "router.ts"), "utf8");
    for (const path of Object.values(BRIDGE_PATHS)) {
      expect(router).toContain(path);
    }
  });

  it("has no 1:1 send path anywhere in the contract", () => {
    const paths = Object.values(BRIDGE_PATHS).join(" ");
    expect(paths).not.toMatch(/send-(contact|dm|direct|individual)/);
  });
});

describe("status and group sanitization", () => {
  it("drops unknown state and never echoes secret-ish fields", () => {
    const status = normalizeBridgeStatus(
      { state: "bogus", api_key: "secret", session: "creds", qr_available: true },
      false,
    );
    expect(status.state).toBe("error");
    expect(status.live_send_enabled).toBe(false);
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(JSON.stringify(status)).not.toContain("creds");
  });

  it("keeps only sanitized group fields and rejects non-group ids", () => {
    const groups = normalizeBridgeGroups([
      { chat_id: "123456789-987654@g.us", name: " Zooga VIP ", participant_count: 42, participants: ["9725..."] },
      { chat_id: "972501234567@s.whatsapp.net", name: "private" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      chat_id: "123456789-987654@g.us",
      name: "Zooga VIP",
      participant_count: 42,
      is_announcement: null,
      is_admin: null,
    });
    expect(JSON.stringify(groups)).not.toContain("9725");
  });
});

describe("group sync plan", () => {
  const existing: ExistingGroupRow[] = [
    { id: "a", whatsapp_chat_id: "1@g.us", current_name: "Old Name", previous_name: null },
    { id: "b", whatsapp_chat_id: "2@g.us", current_name: "Stable", previous_name: null },
    { id: "c", whatsapp_chat_id: "3@g.us", current_name: "Vanished", previous_name: null },
  ];
  const incoming = normalizeBridgeGroups([
    { chat_id: "1@g.us", name: "New Name" },
    { chat_id: "2@g.us", name: "Stable" },
    { chat_id: "4@g.us", name: "Fresh" },
  ]);

  it("inserts new, preserves rename history and never deletes missing groups", () => {
    const plan = computeGroupSyncPlan(existing, incoming);
    expect(plan.inserts).toEqual([{ whatsapp_chat_id: "4@g.us", current_name: "Fresh" }]);
    expect(plan.renames).toEqual([{ id: "a", current_name: "New Name", previous_name: "Old Name" }]);
    expect(plan.touched_ids).toEqual(["a", "b"]);
    expect(plan.missing_count).toBe(1);
    expect(Object.keys(plan)).not.toContain("deletes");
    expect(Object.keys(plan)).not.toContain("archives");
  });

  it("is idempotent on a second identical sync", () => {
    const after: ExistingGroupRow[] = [
      { id: "a", whatsapp_chat_id: "1@g.us", current_name: "New Name", previous_name: "Old Name" },
      { id: "b", whatsapp_chat_id: "2@g.us", current_name: "Stable", previous_name: null },
      { id: "c", whatsapp_chat_id: "3@g.us", current_name: "Vanished", previous_name: null },
      { id: "d", whatsapp_chat_id: "4@g.us", current_name: "Fresh", previous_name: null },
    ];
    const plan = computeGroupSyncPlan(after, incoming);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.renames).toHaveLength(0);
    expect(plan.missing_count).toBe(1);
  });
});

describe("live send flag", () => {
  it("is disabled unless explicitly true", () => {
    expect(isLiveSendEnabled(undefined)).toBe(false);
    expect(isLiveSendEnabled("")).toBe(false);
    expect(isLiveSendEnabled("1")).toBe(false);
    expect(isLiveSendEnabled("TRUE")).toBe(false);
    expect(isLiveSendEnabled("true")).toBe(true);
  });
});

describe("isolation guarantees", () => {
  const files = walk(SRC);
  const clientPath = "zooga-whatsapp-bridge/bridge-client.server";

  it("bridge secrets and live flag exist only in the server-private client", () => {
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      if (!/process\.env\[\s*["']ZOOGA_WHATSAPP_BRIDGE_/.test(body)) continue;
      expect(file.endsWith("bridge-client.server.ts")).toBe(true);
    }

  });

  it("only server-side modules import the bridge client", () => {
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      if (!body.includes(clientPath)) continue;
      const isAllowed =
        file.endsWith("whatsapp-bridge.functions.ts") ||
        file.endsWith(".server.ts") ||
        file.includes("__tests__");
      expect(isAllowed).toBe(true);
    }
  });

  it("route and UI files never fetch the bridge directly", () => {
    for (const file of files.filter((f) => f.includes(`${join("src", "routes")}`) || f.includes(join("src", "components")))) {
      const body = readFileSync(file, "utf8");
      expect(body).not.toContain("bridge-client.server");
      expect(body).not.toMatch(/fetch\(\s*[`"']https?:\/\/[^`"']*bridge/i);
    }
  });

  it("Tamar Meta code has zero references to the bridge", () => {
    const metaFiles = files.filter((f) => /whatsapp-meta|whatsapp-templates|tamar-engine|whatsapp-status/.test(f));
    expect(metaFiles.length).toBeGreaterThan(0);
    for (const file of metaFiles) {
      const body = readFileSync(file, "utf8");
      expect(body).not.toContain("zooga-whatsapp-bridge");
      expect(body).not.toContain("whatsapp-bridge.functions");
    }
  });

  it("no bridge send is wired into broadcast creation", () => {
    const broadcastFns = readFileSync(join(SRC, "lib", "whatsapp-broadcast.functions.ts"), "utf8");
    expect(broadcastFns).not.toContain("sendGroupMessage");
    expect(broadcastFns).not.toContain("bridge-client.server");
  });
});

describe("gateway proxy configuration", () => {
  const clientSrc = readFileSync(join(SRC, "lib", "zooga-whatsapp-bridge", "bridge-client.server.ts"), "utf8");

  it("loads gateway_url and bearer_token from the service-role-only RPC", () => {
    expect(clientSrc).toContain("zooga_control_plane_config");
    expect(clientSrc).toContain("client.server");
    expect(clientSrc).not.toMatch(/process\.env\[\s*["\']ZOOGA_WHATSAPP_BRIDGE_/);
  });

  it("calls only the authenticated gateway proxy routes", async () => {
    const mod = await import("@/lib/zooga-whatsapp-bridge/bridge-client.server");
    expect(mod.GATEWAY_BRIDGE_ROUTES).toEqual({
      status: "/v1/whatsapp-bridge/status",
      connect: "/v1/whatsapp-bridge/connect",
      qr: "/v1/whatsapp-bridge/qr",
      disconnect: "/v1/whatsapp-bridge/disconnect",
      logout: "/v1/whatsapp-bridge/logout",
      groups: "/v1/whatsapp-bridge/groups",
      sendGroup: "/v1/whatsapp-bridge/send-group",
    });
  });

  it("uses bearer auth, a 15s timeout and no-store caching, and never logs the token", () => {
    expect(clientSrc).toContain("Bearer ${config.bearer_token}");
    expect(clientSrc).toContain("15_000");
    expect(clientSrc).toContain('cache: "no-store"');
    expect(clientSrc).not.toMatch(/console\.(log|warn|error)/);
  });

  it("group sending requires a chat id, text and an idempotency key", async () => {
    const mod = await import("@/lib/zooga-whatsapp-bridge/bridge-client.server");
    expect(mod.isBridgeLiveSendEnabled()).toBe(true);
    const res = await mod.sendGroupMessage({ chat_id: "", text: "x", idempotency_key: "k-000001" });
    expect(res).toEqual({ ok: false, code: "invalid_send_input" });
    const short = await mod.sendGroupMessage({ chat_id: "1@g.us", text: "x", idempotency_key: "k" });
    expect(short).toEqual({ ok: false, code: "invalid_send_input" });
  });
});
