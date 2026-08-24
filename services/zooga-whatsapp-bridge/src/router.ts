/**
 * HTTP contract for the bridge. Group-only sending; no 1:1 endpoint exists.
 * Every route except /health requires `Authorization: Bearer <BRIDGE_API_KEY>`.
 */
import { isAuthorized } from "./auth.js";
import {
  BRIDGE_IDENTITY,
  LOGOUT_CONFIRM_HEADER,
  LOGOUT_CONFIRM_VALUE,
  SERVICE_NAME,
  SERVICE_VERSION,
  type BridgeConfig,
} from "./config.js";
import { IdempotencyLedger } from "./idempotency.js";
import { log } from "./logger.js";
import { fetchMedia } from "./media.js";
import { SendRateLimiter, jitterMs } from "./rate-limit.js";
import { validateSendGroup } from "./validate.js";
import type { WhatsAppSessionManager } from "./session.js";

export type BridgeResponse = { status: number; body: unknown; headers?: Record<string, string> };

export const PUBLIC_ROUTES = ["GET /health"] as const;

export type RouteRequest = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
};

export type RouterDeps = {
  config: BridgeConfig;
  session: Pick<
    WhatsAppSessionManager,
    "status" | "currentQr" | "connect" | "disconnect" | "logout" | "listGroups" | "sendGroupText" | "sendGroupImage"
  > & { isConnected: boolean };
  ledger: IdempotencyLedger;
  limiter: SendRateLimiter;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
};

const json = (status: number, body: unknown, headers?: Record<string, string>): BridgeResponse => ({
  status,
  body,
  headers,
});
const fail = (status: number, code: string, headers?: Record<string, string>): BridgeResponse =>
  json(status, { ok: false, code }, headers);

export async function handleRoute(req: RouteRequest, deps: RouterDeps): Promise<BridgeResponse> {
  const route = `${req.method.toUpperCase()} ${req.path.replace(/\/+$/, "") || "/"}`;

  if (route === "GET /health") {
    return json(200, { ok: true, service: SERVICE_NAME, version: SERVICE_VERSION, identity: BRIDGE_IDENTITY });
  }

  if (!isAuthorized(req.headers["authorization"], deps.config.apiKey)) {
    return fail(401, "unauthorized");
  }

  switch (route) {
    case "GET /v1/status":
      return json(200, { ok: true, ...deps.session.status() });

    case "POST /v1/connect": {
      const status = await deps.session.connect();
      return json(200, { ok: true, ...status });
    }

    case "GET /v1/qr": {
      const qr = deps.session.currentQr();
      if (!qr) return fail(409, "qr_not_available");
      return json(200, { ok: true, ...qr }, { "cache-control": "no-store" });
    }

    case "POST /v1/disconnect": {
      const status = await deps.session.disconnect();
      return json(200, { ok: true, ...status });
    }

    case "POST /v1/logout": {
      if (req.headers[LOGOUT_CONFIRM_HEADER] !== LOGOUT_CONFIRM_VALUE) {
        return fail(428, "logout_confirmation_required");
      }
      const status = await deps.session.logout();
      return json(200, { ok: true, ...status });
    }

    case "GET /v1/groups": {
      if (!deps.session.isConnected) return fail(409, "not_connected");
      try {
        const groups = await deps.session.listGroups();
        return json(200, { ok: true, count: groups.length, groups });
      } catch {
        return fail(502, "group_fetch_failed");
      }
    }

    case "POST /v1/send-group":
      return sendGroup(req, deps);
  }

  return fail(404, "not_found");
}

async function sendGroup(req: RouteRequest, deps: RouterDeps): Promise<BridgeResponse> {
  const parsed = validateSendGroup(req.body, { maxTextLength: deps.config.maxTextLength });
  if (!parsed.ok) return fail(parsed.error.status, parsed.error.code);
  const input = parsed.value;

  const existing = deps.ledger.get(input.idempotency_key);
  if (existing) {
    return json(200, {
      ok: true,
      duplicate: true,
      message_id: existing.message_id,
      timestamp: existing.timestamp,
    });
  }

  if (!deps.session.isConnected) return fail(409, "not_connected");

  const rate = deps.limiter.check();
  if (!rate.allowed) {
    return fail(429, rate.code, { "retry-after": String(rate.retryAfterSeconds) });
  }
  deps.limiter.commit();

  if (deps.config.sendJitter) {
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    await sleep(jitterMs());
  }

  try {
    let result: { message_id: string | null; timestamp: number | null };
    if (input.media_url) {
      const media = await fetchMedia(
        input.media_url,
        { maxBytes: deps.config.maxMediaBytes, timeoutMs: deps.config.mediaTimeoutMs },
        deps.fetchImpl ?? fetch,
      );
      if (!media.ok) return fail(media.status, media.code);
      result = await deps.session.sendGroupImage(input.chat_id, media.buffer, input.text);
    } else {
      result = await deps.session.sendGroupText(input.chat_id, input.text);
    }
    deps.ledger.record(input.idempotency_key, result);
    log.info("group_send_ok");
    return json(200, { ok: true, duplicate: false, message_id: result.message_id, timestamp: result.timestamp });
  } catch {
    log.error("group_send_failed");
    return fail(502, "send_failed");
  }
}
