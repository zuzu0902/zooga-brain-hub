/**
 * ZOOGA OS — server-private client for the external WhatsApp Web bridge.
 *
 * Secrets live in server env only (never in Supabase tables, never in the client
 * bundle). The browser never talks to the bridge; only server functions do.
 * Live group sending stays disabled unless ZOOGA_WHATSAPP_BRIDGE_LIVE=true.
 *
 * Tamar Business WhatsApp (Meta Cloud API) must never import this module.
 */
import {
  BRIDGE_NOT_CONFIGURED,
  BRIDGE_PATHS,
  LOGOUT_CONFIRM_HEADER,
  LOGOUT_CONFIRM_VALUE,
  isLiveSendEnabled,
  normalizeBridgeGroups,
  normalizeBridgeStatus,
  type BridgeGroup,
  type BridgeStatus,
} from "./bridge-contract";

type BridgeEnv = { baseUrl: string; apiKey: string; live: boolean };

function readEnv(): BridgeEnv | null {
  const baseUrl = (process.env["ZOOGA_WHATSAPP_BRIDGE_URL"] ?? "").trim().replace(/\/+$/, "");
  const apiKey = (process.env["ZOOGA_WHATSAPP_BRIDGE_API_KEY"] ?? "").trim();
  if (!baseUrl || !apiKey || !/^https:\/\//i.test(baseUrl)) return null;
  return { baseUrl, apiKey, live: isLiveSendEnabled(process.env["ZOOGA_WHATSAPP_BRIDGE_LIVE"]) };
}

export function isBridgeConfigured(): boolean {
  return readEnv() !== null;
}

export function isBridgeLiveSendEnabled(): boolean {
  return readEnv()?.live === true;
}

type CallResult = { ok: true; data: Record<string, unknown> } | { ok: false; code: string };

async function call(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; extraHeaders?: Record<string, string> },
): Promise<CallResult> {
  const env = readEnv();
  if (!env) return { ok: false, code: "bridge_server_not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${env.baseUrl}${path}`, {
      method: init.method,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.apiKey}`,
        "content-type": "application/json",
        ...(init.extraHeaders ?? {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }
    if (res.status === 401) return { ok: false, code: "bridge_unauthorized" };
    if (!res.ok) {
      const code = typeof data["code"] === "string" ? (data["code"] as string) : "bridge_error";
      return { ok: false, code };
    }
    return { ok: true, data };
  } catch {
    // Never surface the raw error: it can contain the bridge host or key.
    return { ok: false, code: "bridge_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function failedStatus(code: string): BridgeStatus {
  return { ...BRIDGE_NOT_CONFIGURED, configured: code !== "bridge_server_not_configured", error_code: code };
}

export async function fetchBridgeStatus(): Promise<BridgeStatus> {
  const env = readEnv();
  if (!env) return BRIDGE_NOT_CONFIGURED;
  const res = await call(BRIDGE_PATHS.status_path, { method: "GET" });
  if (!res.ok) return failedStatus(res.code);
  return normalizeBridgeStatus(res.data, env.live);
}

export async function startBridgeConnection(): Promise<BridgeStatus> {
  const env = readEnv();
  if (!env) return BRIDGE_NOT_CONFIGURED;
  const res = await call(BRIDGE_PATHS.connect_path, { method: "POST", body: {} });
  if (!res.ok) return failedStatus(res.code);
  return normalizeBridgeStatus(res.data, env.live);
}

export async function disconnectBridge(): Promise<BridgeStatus> {
  const env = readEnv();
  if (!env) return BRIDGE_NOT_CONFIGURED;
  const res = await call(BRIDGE_PATHS.disconnect_path, { method: "POST", body: {} });
  if (!res.ok) return failedStatus(res.code);
  return normalizeBridgeStatus(res.data, env.live);
}

export async function logoutBridge(): Promise<BridgeStatus> {
  const env = readEnv();
  if (!env) return BRIDGE_NOT_CONFIGURED;
  const res = await call(BRIDGE_PATHS.logout_path, {
    method: "POST",
    body: {},
    extraHeaders: { [LOGOUT_CONFIRM_HEADER]: LOGOUT_CONFIRM_VALUE },
  });
  if (!res.ok) return failedStatus(res.code);
  return normalizeBridgeStatus(res.data, env.live);
}

export type BridgeQr = { qr_text: string; qr_data_url: string | null; expires_in_ms: number } | { error: string };

/** QR is proxied through the server and never cached anywhere. */
export async function fetchBridgeQr(): Promise<BridgeQr> {
  if (!isBridgeConfigured()) return { error: "bridge_server_not_configured" };
  const res = await call(BRIDGE_PATHS.qr_path, { method: "GET" });
  if (!res.ok) return { error: res.code };
  return {
    qr_text: typeof res.data["qr_text"] === "string" ? (res.data["qr_text"] as string) : "",
    qr_data_url: typeof res.data["qr_data_url"] === "string" ? (res.data["qr_data_url"] as string) : null,
    expires_in_ms: typeof res.data["expires_in_ms"] === "number" ? (res.data["expires_in_ms"] as number) : 0,
  };
}

export async function fetchBridgeGroups(): Promise<{ ok: true; groups: BridgeGroup[] } | { ok: false; code: string }> {
  if (!isBridgeConfigured()) return { ok: false, code: "bridge_server_not_configured" };
  const res = await call(BRIDGE_PATHS.groups_sync_path, { method: "GET" });
  if (!res.ok) return { ok: false, code: res.code };
  return { ok: true, groups: normalizeBridgeGroups(res.data["groups"]) };
}

/**
 * Live single-group send. Hard-disabled unless ZOOGA_WHATSAPP_BRIDGE_LIVE=true.
 * Nothing in this batch calls it: broadcasts are still control-plane only.
 */
export async function sendGroupMessage(input: {
  chat_id: string;
  text: string;
  media_url?: string | null;
  idempotency_key: string;
}): Promise<{ ok: true; message_id: string | null; duplicate: boolean } | { ok: false; code: string }> {
  const env = readEnv();
  if (!env) return { ok: false, code: "bridge_server_not_configured" };
  if (!env.live) return { ok: false, code: "live_send_disabled" };
  if (!input.chat_id.endsWith("@g.us")) return { ok: false, code: "not_a_group_chat_id" };
  const res = await call(BRIDGE_PATHS.broadcast_path, { method: "POST", body: input });
  if (!res.ok) return { ok: false, code: res.code };
  return {
    ok: true,
    duplicate: res.data["duplicate"] === true,
    message_id: typeof res.data["message_id"] === "string" ? (res.data["message_id"] as string) : null,
  };
}
