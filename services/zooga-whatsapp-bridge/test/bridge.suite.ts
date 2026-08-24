import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractBearer, isAuthorized } from "../src/auth.js";
import { loadConfig, LOGOUT_CONFIRM_HEADER, SERVICE_VERSION } from "../src/config.js";
import { IdempotencyLedger } from "../src/idempotency.js";
import { QrStore } from "../src/qr-store.js";
import { SendRateLimiter, jitterMs } from "../src/rate-limit.js";
import { handleRoute, type RouterDeps } from "../src/router.js";
import { isGroupChatId, validateSendGroup } from "../src/validate.js";
import { backoffDelayMs, categorizeDisconnect, sanitizeGroups, sanitizeStatus } from "../src/session-state.js";
import { redact } from "../src/logger.js";
import { fetchMedia } from "../src/media.js";

const API_KEY = "x".repeat(32);

function makeEnv(dir: string) {
  return { BRIDGE_API_KEY: API_KEY, DATA_DIR: dir, SESSION_DIR: join(dir, "session"), SEND_JITTER: "false" };
}

function makeDeps(dir: string, overrides: Partial<RouterDeps> = {}): RouterDeps {
  const config = loadConfig(makeEnv(dir) as never);
  const sends: Array<{ chat: string; text: string }> = [];
  const session = {
    isConnected: true,
    status: () =>
      sanitizeStatus(
        {
          state: "connected",
          lastConnectedAt: "2026-08-24T00:00:00.000Z",
          lastDisconnectCategory: "none",
          qrAvailable: false,
          reconnectAttempts: 0,
        },
        SERVICE_VERSION,
      ),
    currentQr: () => null,
    connect: async () => session.status(),
    disconnect: async () => session.status(),
    logout: async () => session.status(),
    listGroups: async () => [{ chat_id: "123456789@g.us", name: "Zooga VIP" }],
    sendGroupText: async (chat: string, text: string) => {
      sends.push({ chat, text });
      return { message_id: `m${sends.length}`, timestamp: 1000 + sends.length };
    },
    sendGroupImage: async (chat: string, _b: Buffer, text: string) => {
      sends.push({ chat, text });
      return { message_id: "img", timestamp: 2000 };
    },
  } as unknown as RouterDeps["session"];
  return {
    config,
    session,
    ledger: IdempotencyLedger.atDataDir(dir, config.idempotencyTtlMs),
    limiter: new SendRateLimiter(config.minSendIntervalMs, config.maxSendsPerMinute),
    sleep: async () => {},
    ...overrides,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zooga-bridge-"));
});

const auth = { authorization: `Bearer ${API_KEY}` };

describe("bridge auth", () => {
  it("requires a bearer key on every operational endpoint", async () => {
    const deps = makeDeps(dir);
    for (const [method, path] of [
      ["GET", "/v1/status"],
      ["POST", "/v1/connect"],
      ["GET", "/v1/qr"],
      ["POST", "/v1/disconnect"],
      ["POST", "/v1/logout"],
      ["GET", "/v1/groups"],
      ["POST", "/v1/send-group"],
    ] as const) {
      const res = await handleRoute({ method, path, headers: {} }, deps);
      expect(res.status, path).toBe(401);
      expect(res.body).toEqual({ ok: false, code: "unauthorized" });
    }
  });

  it("leaves only /health unauthenticated and free of sensitive data", async () => {
    const res = await handleRoute({ method: "GET", path: "/health", headers: {} }, makeDeps(dir));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(API_KEY);
    expect(Object.keys(res.body as object).sort()).toEqual(["identity", "ok", "service", "version"]);
  });

  it("compares keys safely and rejects malformed headers", () => {
    expect(extractBearer(null)).toBeNull();
    expect(extractBearer("Basic abc")).toBeNull();
    expect(extractBearer(`Bearer ${API_KEY}`)).toBe(API_KEY);
    expect(isAuthorized(`Bearer ${API_KEY}`, API_KEY)).toBe(true);
    expect(isAuthorized(`Bearer ${"y".repeat(32)}`, API_KEY)).toBe(false);
    expect(isAuthorized(`Bearer short`, API_KEY)).toBe(false);
  });

  it("refuses to start without a strong BRIDGE_API_KEY", () => {
    expect(() => loadConfig({} as never)).toThrow(/BRIDGE_API_KEY/);
    expect(() => loadConfig({ BRIDGE_API_KEY: "short" } as never)).toThrow(/BRIDGE_API_KEY/);
  });
});

describe("QR handling", () => {
  it("is memory-only with a TTL and never persisted", () => {
    const store = new QrStore(60_000);
    store.set("2@qr-secret-payload", "data:image/png;base64,AAA", 0);
    expect(store.available(0)).toBe(true);
    expect(store.get(59_999)?.text).toBe("2@qr-secret-payload");
    expect(store.get(60_001)).toBeNull();
    const files = readdirSync(dir);
    for (const f of files) {
      expect(readFileSync(join(dir, f), "utf8")).not.toContain("qr-secret-payload");
    }
  });

  it("returns a fixed code when no QR is current", async () => {
    const res = await handleRoute({ method: "GET", path: "/v1/qr", headers: auth }, makeDeps(dir));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, code: "qr_not_available" });
  });

  it("never logs QR payloads or phone numbers", () => {
    expect(redact("qr=2@secret-material")).not.toContain("secret-material");
    expect(redact("contact +972 54 123 4567")).not.toContain("123 4567");
    expect(redact("chat 972541234567@s.whatsapp.net")).toBe("chat [jid]");
  });

  it("hides QR once the session is connected", async () => {
    const store = new QrStore(60_000);
    store.set("2@abc", null, 0);
    store.clear();
    expect(store.available(0)).toBe(false);
  });
});

describe("group-only sending", () => {
  it("exposes no 1:1 send endpoint at all", async () => {
    const deps = makeDeps(dir);
    for (const path of ["/v1/send", "/v1/send-message", "/v1/send-direct", "/v1/chat"]) {
      const res = await handleRoute({ method: "POST", path, headers: auth }, deps);
      expect(res.status, path).toBe(404);
    }
    const src = readFileSync(new URL("../src/router.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/s\.whatsapp\.net/);
    expect(src).toContain("/v1/send-group");
  });

  it("validates group chat ids", () => {
    expect(isGroupChatId("123456789012-1234567890@g.us")).toBe(true);
    expect(isGroupChatId("972541234567@s.whatsapp.net")).toBe(false);
    expect(isGroupChatId("972541234567")).toBe(false);
    expect(isGroupChatId("@g.us")).toBe(false);
  });

  it("rejects non-group targets, empty text, oversized text and non-https media", () => {
    const base = { chat_id: "123456789@g.us", text: "שלום", idempotency_key: "bcast-1-group-1" };
    expect(validateSendGroup({ ...base, chat_id: "972541234567@s.whatsapp.net" }, { maxTextLength: 10 }).ok).toBe(false);
    expect(validateSendGroup({ ...base, text: "  " }, { maxTextLength: 10 }).ok).toBe(false);
    expect(validateSendGroup({ ...base, text: "x".repeat(50) }, { maxTextLength: 10 }).ok).toBe(false);
    expect(validateSendGroup({ ...base, media_url: "http://x/y.png" }, { maxTextLength: 10 }).ok).toBe(false);
    expect(validateSendGroup({ ...base, idempotency_key: "sh" }, { maxTextLength: 10 }).ok).toBe(false);
    expect(validateSendGroup(base, { maxTextLength: 10 }).ok).toBe(true);
  });

  it("rejects sends to a group when disconnected", async () => {
    const deps = makeDeps(dir);
    (deps.session as unknown as { isConnected: boolean }).isConnected = false;
    const res = await handleRoute(
      {
        method: "POST",
        path: "/v1/send-group",
        headers: auth,
        body: { chat_id: "123456789@g.us", text: "hi", idempotency_key: "key-000001" },
      },
      deps,
    );
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, code: "not_connected" });
  });
});

describe("idempotency", () => {
  it("prevents duplicate group sends across retries and processes", async () => {
    const deps = makeDeps(dir);
    const body = { chat_id: "123456789@g.us", text: "מסר", idempotency_key: "bcast-42-group-7" };
    const first = await handleRoute({ method: "POST", path: "/v1/send-group", headers: auth, body }, deps);
    expect(first.body).toMatchObject({ ok: true, duplicate: false, message_id: "m1" });

    const retry = await handleRoute({ method: "POST", path: "/v1/send-group", headers: auth, body }, deps);
    expect(retry.body).toMatchObject({ ok: true, duplicate: true, message_id: "m1" });

    // survives a process restart (persistent ledger under DATA_DIR)
    const restarted = makeDeps(dir);
    const afterRestart = await handleRoute(
      { method: "POST", path: "/v1/send-group", headers: auth, body },
      restarted,
    );
    expect(afterRestart.body).toMatchObject({ duplicate: true });
  });

  it("retains entries for at least 7 days and stores no chat id or text", () => {
    const ledger = IdempotencyLedger.atDataDir(dir, 7 * 24 * 60 * 60 * 1000);
    ledger.record("bcast-1-group-1", { message_id: "abc", timestamp: 1 }, 0);
    expect(ledger.get("bcast-1-group-1", 6 * 24 * 60 * 60 * 1000)).not.toBeNull();
    expect(ledger.get("bcast-1-group-1", 8 * 24 * 60 * 60 * 1000)).toBeNull();
    const raw = readFileSync(join(dir, "idempotency.json"), "utf8");
    expect(raw).not.toContain("bcast-1-group-1");
    expect(raw).not.toContain("@g.us");
  });
});

describe("rate limiting", () => {
  it("enforces a minimum interval and a per-minute cap with Retry-After", () => {
    const limiter = new SendRateLimiter(2000, 3);
    expect(limiter.check(0).allowed).toBe(true);
    limiter.commit(0);
    const blocked = limiter.check(500);
    expect(blocked).toMatchObject({ allowed: false, code: "min_interval" });
    expect(limiter.check(2500).allowed).toBe(true);
    limiter.commit(2500);
    limiter.commit(5000);
    const capped = limiter.check(7500);
    expect(capped).toMatchObject({ allowed: false, code: "per_minute_cap" });
    if (!capped.allowed) expect(capped.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("returns 429 with Retry-After from the route", async () => {
    const deps = makeDeps(dir, { limiter: new SendRateLimiter(60_000, 5) });
    const send = (n: number) =>
      handleRoute(
        {
          method: "POST",
          path: "/v1/send-group",
          headers: auth,
          body: { chat_id: "123456789@g.us", text: "hi", idempotency_key: `key-00000${n}` },
        },
        deps,
      );
    expect((await send(1)).status).toBe(200);
    const second = await send(2);
    expect(second.status).toBe(429);
    expect(second.headers?.["retry-after"]).toBeDefined();
  });

  it("keeps jitter bounded to 500-1500ms", () => {
    expect(jitterMs(() => 0)).toBe(500);
    expect(jitterMs(() => 0.999)).toBeLessThanOrEqual(1500);
  });
});

describe("logout guard", () => {
  it("requires the explicit confirmation header", async () => {
    const deps = makeDeps(dir);
    const denied = await handleRoute({ method: "POST", path: "/v1/logout", headers: auth }, deps);
    expect(denied.status).toBe(428);
    expect(denied.body).toEqual({ ok: false, code: "logout_confirmation_required" });

    const allowed = await handleRoute(
      { method: "POST", path: "/v1/logout", headers: { ...auth, [LOGOUT_CONFIRM_HEADER]: "alex-personal" } },
      deps,
    );
    expect(allowed.status).toBe(200);
  });
});

describe("sanitized responses", () => {
  it("returns no secrets or auth state from status", async () => {
    const res = await handleRoute({ method: "GET", path: "/v1/status", headers: auth }, makeDeps(dir));
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toMatch(/creds|noiseKey|signedIdentityKey|session/i);
    expect(Object.keys(res.body as object).sort()).toEqual([
      "connected",
      "identity",
      "last_connected_at",
      "last_disconnect_reason",
      "ok",
      "qr_available",
      "reconnect_attempts",
      "service_version",
      "state",
    ]);
  });

  it("returns group metadata without participant identities", () => {
    const groups = sanitizeGroups({
      a: {
        id: "123456789@g.us",
        subject: "Zooga VIP",
        announce: false,
        participants: [
          { id: "972541234567@s.whatsapp.net", admin: "superadmin" },
          { id: "972501234567@s.whatsapp.net" },
        ],
      },
      b: { id: "972541234567@s.whatsapp.net", subject: "not a group" },
    });
    expect(groups).toHaveLength(1);
    expect(JSON.stringify(groups)).not.toContain("s.whatsapp.net");
    expect(groups[0]).toMatchObject({ chat_id: "123456789@g.us", name: "Zooga VIP", participant_count: 2 });
  });

  it("categorizes disconnects without leaking provider detail and backs off within bounds", () => {
    expect(categorizeDisconnect(401)).toBe("logged_out");
    expect(categorizeDisconnect(515)).toBe("restart_required");
    expect(categorizeDisconnect(408)).toBe("transient");
    expect(categorizeDisconnect(null)).toBe("unknown");
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(20)).toBe(60_000);
  });
});

describe("media limits", () => {
  it("rejects non-https, disallowed mime and oversized media", async () => {
    const limits = { maxBytes: 100, timeoutMs: 1000 };
    expect(await fetchMedia("http://x/a.png", limits)).toMatchObject({ code: "media_url_must_be_https" });

    const badMime = (async () =>
      new Response(new Uint8Array(10), { headers: { "content-type": "application/zip" } })) as unknown as typeof fetch;
    expect(await fetchMedia("https://x/a.zip", limits, badMime)).toMatchObject({ code: "media_mime_not_allowed" });

    const tooBig = (async () =>
      new Response(new Uint8Array(500), { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    expect(await fetchMedia("https://x/a.png", limits, tooBig)).toMatchObject({ code: "media_too_large" });

    const ok = (async () =>
      new Response(new Uint8Array(10), { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    expect(await fetchMedia("https://x/a.png", limits, ok)).toMatchObject({ ok: true, mimeType: "image/png" });
  });
});
