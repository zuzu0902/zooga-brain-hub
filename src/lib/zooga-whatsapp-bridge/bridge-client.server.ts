/**
 * ZOOGA OS — server-private client for the external WhatsApp Web bridge
 * (Alex Personal identity only).
 *
 * Configuration follows the established Zooga Gateway pattern: gateway_url and
 * bearer_token are resolved server-side from the service-role-only
 * `zooga_control_plane_config()` RPC. No build secrets, no database-visible
 * tokens, no browser access. The token is NEVER returned or logged.
 *
 * All bridge traffic goes through the Gateway's authenticated proxy routes
 * under /v1/whatsapp-bridge/*, including group sending. Group sending is the
 * Alex Personal identity only and is always idempotency-keyed.
 *
 * Tamar Business WhatsApp (Meta Cloud API) must never import this module.
 */
import {
  BRIDGE_NOT_CONFIGURED,
  LOGOUT_CONFIRM_HEADER,
  LOGOUT_CONFIRM_VALUE,
  normalizeBridgeGroups,
  normalizeBridgeStatus,
  type BridgeGroup,
  type BridgeStatus,
} from "./bridge-contract";

const TIMEOUT_MS = 15_000;

/** Gateway proxy routes (the only bridge surface reachable from the app). */
export const GATEWAY_BRIDGE_ROUTES = {
  status: "/v1/whatsapp-bridge/status",
  connect: "/v1/whatsapp-bridge/connect",
  qr: "/v1/whatsapp-bridge/qr",
  disconnect: "/v1/whatsapp-bridge/disconnect",
  logout: "/v1/whatsapp-bridge/logout",
  groups: "/v1/whatsapp-bridge/groups",
  sendGroup: "/v1/whatsapp-bridge/send-group",
} as const;

/** Group sending through the Gateway proxy (Alex Personal only). */
export const LIVE_SEND_ENABLED = true;

type GatewayConfig = { gateway_url: string; bearer_token: string };

async function loadGatewayConfig(): Promise<GatewayConfig | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("zooga_control_plane_config");
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    const url = typeof row?.gateway_url === "string" ? row.gateway_url.trim() : "";
    const token = typeof row?.bearer_token === "string" ? row.bearer_token.trim() : "";
    if (!url || !token) return null;
    return { gateway_url: url.replace(/\/+$/, ""), bearer_token: token };
  } catch {
    return null;
  }
}

export async function isBridgeConfigured(): Promise<boolean> {
  return (await loadGatewayConfig()) !== null;
}

export function isBridgeLiveSendEnabled(): boolean {
  return LIVE_SEND_ENABLED;
}

type CallResult = { ok: true; data: Record<string, unknown> } | { ok: false; code: string };

async function call(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; extraHeaders?: Record<string, string> },
): Promise<CallResult> {
  const config = await loadGatewayConfig();
  if (!config) return { ok: false, code: "bridge_server_not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.gateway_url}${path}`, {
      method: init.method,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        authorization: `Bearer ${config.bearer_token}`,
        "content-type": "application/json",
        accept: "application/json",
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
    if (res.status === 401 || res.status === 403) return { ok: false, code: "bridge_unauthorized" };
    if (!res.ok) {
      const code = typeof data["code"] === "string" ? (data["code"] as string) : "bridge_error";
      return { ok: false, code };
    }
    return { ok: true, data };
  } catch {
    // Never surface the raw error: it can contain the gateway host or token.
    return { ok: false, code: "bridge_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function failedStatus(code: string): BridgeStatus {
  return { ...BRIDGE_NOT_CONFIGURED, configured: code !== "bridge_server_not_configured", error_code: code };
}

export async function fetchBridgeStatus(): Promise<BridgeStatus> {
  const res = await call(GATEWAY_BRIDGE_ROUTES.status, { method: "GET" });
  if (!res.ok) return res.code === "bridge_server_not_configured" ? BRIDGE_NOT_CONFIGURED : failedStatus(res.code);
  return normalizeBridgeStatus(res.data, LIVE_SEND_ENABLED);
}

export async function startBridgeConnection(): Promise<BridgeStatus> {
  const res = await call(GATEWAY_BRIDGE_ROUTES.connect, { method: "POST", body: {} });
  if (!res.ok) return res.code === "bridge_server_not_configured" ? BRIDGE_NOT_CONFIGURED : failedStatus(res.code);
  return normalizeBridgeStatus(res.data, LIVE_SEND_ENABLED);
}

export async function disconnectBridge(): Promise<BridgeStatus> {
  const res = await call(GATEWAY_BRIDGE_ROUTES.disconnect, { method: "POST", body: {} });
  if (!res.ok) return res.code === "bridge_server_not_configured" ? BRIDGE_NOT_CONFIGURED : failedStatus(res.code);
  return normalizeBridgeStatus(res.data, LIVE_SEND_ENABLED);
}

export async function logoutBridge(): Promise<BridgeStatus> {
  const res = await call(GATEWAY_BRIDGE_ROUTES.logout, {
    method: "POST",
    body: {},
    extraHeaders: { [LOGOUT_CONFIRM_HEADER]: LOGOUT_CONFIRM_VALUE },
  });
  if (!res.ok) return res.code === "bridge_server_not_configured" ? BRIDGE_NOT_CONFIGURED : failedStatus(res.code);
  return normalizeBridgeStatus(res.data, LIVE_SEND_ENABLED);
}

export type BridgeQr = { qr_text: string; qr_data_url: string | null; expires_in_ms: number } | { error: string };

/** QR is proxied through the server and never cached anywhere. */
export async function fetchBridgeQr(): Promise<BridgeQr> {
  const res = await call(GATEWAY_BRIDGE_ROUTES.qr, { method: "GET" });
  if (!res.ok) return { error: res.code };
  return {
    qr_text: typeof res.data["qr_text"] === "string" ? (res.data["qr_text"] as string) : "",
    qr_data_url: typeof res.data["qr_data_url"] === "string" ? (res.data["qr_data_url"] as string) : null,
    expires_in_ms: typeof res.data["expires_in_ms"] === "number" ? (res.data["expires_in_ms"] as number) : 0,
  };
}

export async function fetchBridgeGroups(): Promise<{ ok: true; groups: BridgeGroup[] } | { ok: false; code: string }> {
  const res = await call(GATEWAY_BRIDGE_ROUTES.groups, { method: "GET" });
  if (!res.ok) return { ok: false, code: res.code };
  return { ok: true, groups: normalizeBridgeGroups(res.data["groups"]) };
}

/**
 * Single-group send through the Gateway proxy. The idempotency key must be
 * stable per (broadcast, group) so a re-run can never double-send.
 */
export async function sendGroupMessage(input: {
  chat_id: string;
  text: string;
  media_url?: string | null;
  idempotency_key: string;
}): Promise<{ ok: true; message_id: string | null; duplicate: boolean } | { ok: false; code: string }> {
  if (!LIVE_SEND_ENABLED) return { ok: false, code: "live_send_disabled" };
  const chatId = String(input.chat_id ?? "").trim();
  const text = String(input.text ?? "").trim();
  const key = String(input.idempotency_key ?? "").trim();
  if (!chatId || !text || key.length < 6) return { ok: false, code: "invalid_send_input" };

  const res = await call(GATEWAY_BRIDGE_ROUTES.sendGroup, {
    method: "POST",
    body: {
      chat_id: chatId,
      text,
      ...(input.media_url ? { media_url: input.media_url } : {}),
      idempotency_key: key,
    },
  });
  if (!res.ok) return { ok: false, code: res.code };
  return {
    ok: true,
    message_id: typeof res.data["message_id"] === "string" ? (res.data["message_id"] as string) : null,
    duplicate: res.data["duplicate"] === true,
  };
}
