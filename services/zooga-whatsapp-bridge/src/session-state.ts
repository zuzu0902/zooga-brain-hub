/** Pure session state model + sanitizers (no Baileys import, unit-testable). */

export const SESSION_STATES = [
  "not_configured",
  "waiting_for_qr",
  "connecting",
  "connected",
  "disconnected",
  "error",
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

export const DISCONNECT_CATEGORIES = [
  "none",
  "transient",
  "restart_required",
  "logged_out",
  "connection_replaced",
  "unknown",
] as const;

export type DisconnectCategory = (typeof DISCONNECT_CATEGORIES)[number];

/** Maps a Baileys numeric disconnect reason to a coarse, non-identifying category. */
export function categorizeDisconnect(statusCode: number | null | undefined): DisconnectCategory {
  switch (statusCode) {
    case undefined:
    case null:
      return "unknown";
    case 401:
    case 403:
      return "logged_out";
    case 440:
      return "connection_replaced";
    case 515:
      return "restart_required";
    case 408:
    case 428:
    case 500:
    case 503:
      return "transient";
    default:
      return "unknown";
  }
}

/** Bounded exponential backoff for transient reconnects. */
export function backoffDelayMs(attempt: number): number {
  const base = 2000 * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(base, 60_000);
}

export type SanitizedStatus = {
  identity: "alex-personal";
  state: SessionState;
  connected: boolean;
  last_connected_at: string | null;
  last_disconnect_reason: DisconnectCategory;
  qr_available: boolean;
  reconnect_attempts: number;
  service_version: string;
};

export type StatusSource = {
  state: SessionState;
  lastConnectedAt: string | null;
  lastDisconnectCategory: DisconnectCategory;
  qrAvailable: boolean;
  reconnectAttempts: number;
};

const SANITIZED_KEYS = [
  "identity",
  "state",
  "connected",
  "last_connected_at",
  "last_disconnect_reason",
  "qr_available",
  "reconnect_attempts",
  "service_version",
] as const;

export function sanitizeStatus(src: StatusSource, serviceVersion: string): SanitizedStatus {
  const out: SanitizedStatus = {
    identity: "alex-personal",
    state: src.state,
    connected: src.state === "connected",
    last_connected_at: src.lastConnectedAt,
    last_disconnect_reason: src.lastDisconnectCategory,
    qr_available: src.qrAvailable,
    reconnect_attempts: src.reconnectAttempts,
    service_version: serviceVersion,
  };
  // Defensive: the response shape is a closed allow-list.
  for (const key of Object.keys(out)) {
    if (!(SANITIZED_KEYS as readonly string[]).includes(key)) delete (out as never as Record<string, unknown>)[key];
  }
  return out;
}

export type SanitizedGroup = {
  chat_id: string;
  name: string;
  participant_count?: number;
  is_announcement?: boolean;
  is_admin?: boolean;
};

/**
 * Projects Baileys group metadata to sanitized fields only.
 * Participant JIDs / phone numbers are never included.
 */
export function sanitizeGroups(raw: unknown, selfId?: string | null): SanitizedGroup[] {
  const values = raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>) : [];
  const out: SanitizedGroup[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const g = value as Record<string, any>;
    const chatId = typeof g["id"] === "string" ? g["id"] : "";
    if (!chatId.endsWith("@g.us")) continue;
    const participants = Array.isArray(g["participants"]) ? g["participants"] : [];
    const me = selfId
      ? participants.find((p: any) => typeof p?.id === "string" && p.id.split(":")[0] === selfId.split(":")[0])
      : undefined;
    const group: SanitizedGroup = {
      chat_id: chatId,
      name: typeof g["subject"] === "string" ? g["subject"].slice(0, 200) : "",
    };
    if (participants.length) group.participant_count = participants.length;
    if (typeof g["announce"] === "boolean") group.is_announcement = g["announce"];
    if (me) group.is_admin = me.admin === "admin" || me.admin === "superadmin";
    out.push(group);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
