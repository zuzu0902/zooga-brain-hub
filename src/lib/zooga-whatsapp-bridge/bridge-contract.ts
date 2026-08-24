/**
 * ZOOGA OS — control-plane contract for the external WhatsApp Web bridge
 * (Alex Personal identity only). Pure and client-safe: no fetch, no secrets.
 *
 * Tamar Business WhatsApp (Meta Cloud API) must never use anything in this file.
 */

/** Canonical bridge paths — must match services/zooga-whatsapp-bridge. */
export const BRIDGE_PATHS = {
  health: "/health",
  status_path: "/v1/status",
  connect_path: "/v1/connect",
  qr_path: "/v1/qr",
  groups_sync_path: "/v1/groups",
  broadcast_path: "/v1/send-group",
  disconnect_path: "/v1/disconnect",
  logout_path: "/v1/logout",
} as const;

export type BridgePathKey = Exclude<keyof typeof BRIDGE_PATHS, "health">;

/** Non-secret endpoint metadata stored in `whatsapp_connections.config`. */
export const BRIDGE_CONFIG_FIELDS: { key: BridgePathKey | "bridge_base_url"; label: string; fallback: string }[] = [
  { key: "bridge_base_url", label: "כתובת בסיס של הגשר (Bridge Base URL)", fallback: "" },
  { key: "status_path", label: "נתיב סטטוס", fallback: BRIDGE_PATHS.status_path },
  { key: "connect_path", label: "נתיב חיבור", fallback: BRIDGE_PATHS.connect_path },
  { key: "qr_path", label: "נתיב QR", fallback: BRIDGE_PATHS.qr_path },
  { key: "groups_sync_path", label: "נתיב סנכרון קבוצות", fallback: BRIDGE_PATHS.groups_sync_path },
  { key: "broadcast_path", label: "נתיב שליחה לקבוצה", fallback: BRIDGE_PATHS.broadcast_path },
  { key: "disconnect_path", label: "נתיב ניתוק", fallback: BRIDGE_PATHS.disconnect_path },
  { key: "logout_path", label: "נתיב התנתקות מלאה", fallback: BRIDGE_PATHS.logout_path },
];

export const LOGOUT_CONFIRM_HEADER = "X-Confirm-Logout";
export const LOGOUT_CONFIRM_VALUE = "alex-personal";

export const BRIDGE_SESSION_STATES = [
  "not_configured",
  "waiting_for_qr",
  "connecting",
  "connected",
  "disconnected",
  "error",
] as const;
export type BridgeSessionState = (typeof BRIDGE_SESSION_STATES)[number];

export type BridgeStatus = {
  configured: boolean;
  live_send_enabled: boolean;
  state: BridgeSessionState;
  connected: boolean;
  last_connected_at: string | null;
  last_disconnect_reason: string;
  qr_available: boolean;
  service_version: string | null;
  error_code: string | null;
};

/** Safe placeholder shown when no server-side bridge secret is configured. */
export const BRIDGE_NOT_CONFIGURED: BridgeStatus = {
  configured: false,
  live_send_enabled: false,
  state: "not_configured",
  connected: false,
  last_connected_at: null,
  last_disconnect_reason: "none",
  qr_available: false,
  service_version: null,
  error_code: "bridge_server_not_configured",
};

export const BRIDGE_STATE_LABELS: Record<BridgeSessionState, string> = {
  not_configured: "לא מוגדר",
  waiting_for_qr: "ממתין לסריקת QR",
  connecting: "מתחבר…",
  connected: "מחובר",
  disconnected: "מנותק",
  error: "שגיאה",
};

export const BRIDGE_ERROR_LABELS: Record<string, string> = {
  bridge_server_not_configured: "שרת הגשר אינו מוגדר",
  bridge_unreachable: "שרת הגשר אינו זמין",
  bridge_unauthorized: "מפתח הגשר אינו תקין",
  qr_not_available: "אין כרגע קוד QR זמין",
  not_connected: "הגשר אינו מחובר",
  live_send_disabled: "שליחה חיה מושבתת (ZOOGA_WHATSAPP_BRIDGE_LIVE=false)",
};

/** Normalizes a raw bridge status payload into a sanitized control-plane shape. */
export function normalizeBridgeStatus(raw: unknown, liveSendEnabled: boolean): BridgeStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const state = BRIDGE_SESSION_STATES.includes(r["state"] as BridgeSessionState)
    ? (r["state"] as BridgeSessionState)
    : "error";
  return {
    configured: true,
    live_send_enabled: liveSendEnabled,
    state,
    connected: state === "connected",
    last_connected_at: typeof r["last_connected_at"] === "string" ? (r["last_connected_at"] as string) : null,
    last_disconnect_reason:
      typeof r["last_disconnect_reason"] === "string" ? (r["last_disconnect_reason"] as string) : "unknown",
    qr_available: r["qr_available"] === true,
    service_version: typeof r["service_version"] === "string" ? (r["service_version"] as string) : null,
    error_code: null,
  };
}

export type BridgeGroup = {
  chat_id: string;
  name: string;
  participant_count: number | null;
  is_announcement: boolean | null;
  is_admin: boolean | null;
};

/** Keeps only sanitized group fields. Participant identities are dropped. */
export function normalizeBridgeGroups(raw: unknown): BridgeGroup[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BridgeGroup[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const g = item as Record<string, unknown>;
    const chatId = typeof g["chat_id"] === "string" ? g["chat_id"].trim() : "";
    if (!chatId.endsWith("@g.us")) continue;
    out.push({
      chat_id: chatId,
      name: typeof g["name"] === "string" && g["name"].trim() ? g["name"].trim().slice(0, 200) : chatId,
      participant_count: typeof g["participant_count"] === "number" ? g["participant_count"] : null,
      is_announcement: typeof g["is_announcement"] === "boolean" ? g["is_announcement"] : null,
      is_admin: typeof g["is_admin"] === "boolean" ? g["is_admin"] : null,
    });
  }
  return out;
}

export type ExistingGroupRow = {
  id: string;
  whatsapp_chat_id: string;
  current_name: string;
  previous_name: string | null;
};

export type GroupSyncPlan = {
  inserts: { whatsapp_chat_id: string; current_name: string }[];
  renames: { id: string; current_name: string; previous_name: string }[];
  touched_ids: string[];
  missing_count: number;
  total_count: number;
};

/**
 * Conservative sync plan:
 *  - new groups are inserted
 *  - renamed groups keep previous_name/current_name history
 *  - groups missing from the latest sync are NEVER deleted or archived here;
 *    they are only counted (`missing_count`) for the sanitized sync log.
 */
export function computeGroupSyncPlan(existing: ExistingGroupRow[], incoming: BridgeGroup[]): GroupSyncPlan {
  const byChat = new Map(existing.map((row) => [row.whatsapp_chat_id, row]));
  const seen = new Set<string>();
  const plan: GroupSyncPlan = {
    inserts: [],
    renames: [],
    touched_ids: [],
    missing_count: 0,
    total_count: incoming.length,
  };

  for (const group of incoming) {
    seen.add(group.chat_id);
    const row = byChat.get(group.chat_id);
    if (!row) {
      plan.inserts.push({ whatsapp_chat_id: group.chat_id, current_name: group.name });
      continue;
    }
    plan.touched_ids.push(row.id);
    if (row.current_name !== group.name) {
      plan.renames.push({ id: row.id, current_name: group.name, previous_name: row.current_name });
    }
  }

  plan.missing_count = existing.filter((row) => !seen.has(row.whatsapp_chat_id)).length;
  return plan;
}

/** Server-side live-send flag. Disabled unless explicitly set to "true". */
export function isLiveSendEnabled(rawFlag: string | undefined | null): boolean {
  return rawFlag === "true";
}
