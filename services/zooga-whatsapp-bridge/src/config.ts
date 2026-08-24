/**
 * ZOOGA OS WhatsApp Web Bridge — environment configuration.
 *
 * Secrets come from the environment ONLY. Nothing here is ever written to a
 * database, returned in an HTTP response, or logged.
 */

export const SERVICE_NAME = "zooga-whatsapp-bridge";
export const SERVICE_VERSION = "0.1.0";
/** Fixed identity of this bridge. Tamar/Meta Cloud API never uses it. */
export const BRIDGE_IDENTITY = "alex-personal";
export const LOGOUT_CONFIRM_HEADER = "x-confirm-logout";
export const LOGOUT_CONFIRM_VALUE = BRIDGE_IDENTITY;

export type BridgeConfig = {
  port: number;
  apiKey: string;
  sessionDir: string;
  dataDir: string;
  trustProxy: boolean;
  allowedOrigin: string | null;
  minSendIntervalMs: number;
  maxSendsPerMinute: number;
  sendJitter: boolean;
  qrTtlMs: number;
  idempotencyTtlMs: number;
  maxTextLength: number;
  maxMediaBytes: number;
  mediaTimeoutMs: number;
};

function num(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(raw: string | undefined, fallback = false): boolean {
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const apiKey = env["BRIDGE_API_KEY"] ?? "";
  if (apiKey.length < 24) {
    throw new Error("BRIDGE_API_KEY missing or too short (min 24 chars)");
  }
  const dataDir = env["DATA_DIR"] ?? "/data";
  return {
    port: num(env["PORT"], 8080),
    apiKey,
    sessionDir: env["SESSION_DIR"] ?? `${dataDir}/session`,
    dataDir,
    trustProxy: bool(env["TRUST_PROXY"], false),
    allowedOrigin: env["ALLOWED_ORIGIN"] ?? null,
    minSendIntervalMs: num(env["MIN_SEND_INTERVAL_MS"], 2000),
    maxSendsPerMinute: num(env["MAX_SENDS_PER_MINUTE"], 20),
    sendJitter: bool(env["SEND_JITTER"], true),
    qrTtlMs: num(env["QR_TTL_MS"], 60_000),
    idempotencyTtlMs: num(env["IDEMPOTENCY_TTL_MS"], 7 * 24 * 60 * 60 * 1000),
    maxTextLength: num(env["MAX_TEXT_LENGTH"], 4000),
    maxMediaBytes: num(env["MAX_MEDIA_BYTES"], 10 * 1024 * 1024),
    mediaTimeoutMs: num(env["MEDIA_TIMEOUT_MS"], 15_000),
  };
}
