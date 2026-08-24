/**
 * ZOOGA OS — WhatsApp Group Broadcast control-plane core (pure, client-safe).
 *
 * Hard separation rule:
 *  - Tamar = Meta Cloud API (`meta_cloud_api` / `conversation`) — 1:1 flows only.
 *  - Alex Personal = WhatsApp Web bridge (`whatsapp_web_bridge` / `group_broadcast`)
 *    — the ONLY identity allowed to own group broadcasts.
 *
 * This module performs NO network call and holds NO secret. Sending is executed
 * later by the external bridge; Lovable is control plane only.
 */

export const WA_TRANSPORTS = ["meta_cloud_api", "whatsapp_web_bridge"] as const;
export const WA_PURPOSES = ["conversation", "group_broadcast"] as const;
export const WA_CONNECTION_STATUSES = [
  "not_configured",
  "disconnected",
  "connecting",
  "connected",
  "error",
] as const;
export const WA_BROADCAST_STATUSES = [
  "draft",
  "queued",
  "running",
  "completed",
  "completed_with_errors",
  "cancelled",
] as const;

export type WaTransport = (typeof WA_TRANSPORTS)[number];
export type WaPurpose = (typeof WA_PURPOSES)[number];
export type WaConnectionStatus = (typeof WA_CONNECTION_STATUSES)[number];
export type WaBroadcastStatus = (typeof WA_BROADCAST_STATUSES)[number];

export const TAMAR_CONNECTION_KEY = "tamar_meta";
export const ALEX_CONNECTION_KEY = "alex_personal_web";

export type WaConnection = {
  id: string;
  connection_key: string;
  display_name: string;
  transport: WaTransport;
  purpose: WaPurpose;
  status: WaConnectionStatus;
  phone_label: string | null;
  capabilities: string[];
  enabled: boolean;
  allow_agent_broadcast: boolean;
  config: Record<string, string | null>;
  last_connected_at: string | null;
  last_sync_at: string | null;
};

/** Only the WhatsApp Web bridge with group_broadcast purpose may broadcast. */
export function canOwnGroupBroadcast(
  c: Pick<WaConnection, "transport" | "purpose"> | null | undefined,
): boolean {
  return !!c && c.transport === "whatsapp_web_bridge" && c.purpose === "group_broadcast";
}

/** Tamar/Meta must never be substituted for group broadcasts. */
export function isTamarConversationChannel(
  c: Pick<WaConnection, "transport" | "purpose"> | null | undefined,
): boolean {
  return !!c && c.transport === "meta_cloud_api";
}

const SECRET_KEY_RE = /(secret|token|password|qr|session|api_?key|credential|auth)/i;

/**
 * Non-secret endpoint metadata keys. Bridge route paths (e.g. `qr_path`,
 * `logout_path`) are plain URL paths, never credentials — allow them explicitly
 * so the generic secret heuristic does not reject the operator form.
 */
const SAFE_CONFIG_KEY_RE = /^(bridge_base_url|[a-z0-9_]+_path)$/;

function isSecretLikeKey(k: string): boolean {
  if (SAFE_CONFIG_KEY_RE.test(k)) return false;
  return SECRET_KEY_RE.test(k);
}

/** Drops any secret-like key. Only non-secret endpoint metadata survives. */
export function sanitizeConnectionConfig(raw: unknown): Record<string, string | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isSecretLikeKey(k)) continue;
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === "string") out[k] = v.slice(0, 300);
  }
  return out;
}

export function hasSecretLikeKey(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return Object.keys(raw as Record<string, unknown>).some((k) => isSecretLikeKey(k));
}

export type BroadcastDraftInput = {
  title: string;
  message_text: string;
  media_url?: string | null;
  group_ids: string[];
  scheduled_for?: string | null;
  interval_seconds?: number | null;
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

const HTTPS_RE = /^https:\/\/[^\s]+$/i;

/** Validates a broadcast draft. Hebrew errors — surfaced directly in the UI. */
export function validateBroadcastDraft(input: BroadcastDraftInput): ValidationResult {
  if (!input.title?.trim()) return { ok: false, error: "נדרשת כותרת פנימית להפצה" };
  if (input.title.trim().length > 120) return { ok: false, error: "כותרת ארוכה מדי (עד 120 תווים)" };
  if (!input.message_text?.trim()) return { ok: false, error: "נדרש תוכן הודעה" };
  if (input.message_text.length > 4000) return { ok: false, error: "ההודעה ארוכה מדי (עד 4000 תווים)" };
  if (input.media_url && !HTTPS_RE.test(input.media_url)) {
    return { ok: false, error: "כתובת מדיה חייבת להיות קישור https תקין" };
  }
  if (!input.group_ids?.length) return { ok: false, error: "יש לבחור לפחות קבוצה אחת" };
  if (input.group_ids.length > 500) return { ok: false, error: "יותר מדי קבוצות בהפצה אחת" };
  if (input.scheduled_for) {
    const t = Date.parse(input.scheduled_for);
    if (!Number.isFinite(t)) return { ok: false, error: "מועד תזמון לא תקין" };
    if (t < Date.now() - 60_000) return { ok: false, error: "מועד התזמון כבר עבר — יש לבחור מועד עתידי" };
  }
  if (input.interval_seconds != null) {
    const n = Number(input.interval_seconds);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: "מרווח זמן בין שליחות אינו תקין" };
    if (n < 5) return { ok: false, error: "מרווח מינימלי בין שליחות: 5 שניות (הגנה מחסימת Meta)" };
    if (n > 3600) return { ok: false, error: "מרווח מקסימלי בין שליחות: 3600 שניות" };
  }
  return { ok: true };
}

/** `queued` is a control-plane state only — nothing is sent from Lovable. */
export function nextBroadcastStatus(scheduledFor: string | null | undefined): WaBroadcastStatus {
  return scheduledFor ? "queued" : "draft";
}

export const BROADCAST_STATUS_LABELS: Record<WaBroadcastStatus, string> = {
  draft: "טיוטה",
  queued: "ממתין לשליחה",
  running: "בביצוע",
  completed: "הושלמה",
  completed_with_errors: "הושלמה עם שגיאות",
  cancelled: "בוטלה",
};

export const CONNECTION_STATUS_LABELS: Record<WaConnectionStatus, string> = {
  not_configured: "לא מוגדר",
  disconnected: "מנותק",
  connecting: "מתחבר…",
  connected: "מחובר",
  error: "שגיאה",
};

export const TRANSPORT_LABELS: Record<WaTransport, string> = {
  meta_cloud_api: "Meta Cloud API",
  whatsapp_web_bridge: "WhatsApp Web Bridge",
};

export const CAPABILITY_LABELS: Record<string, string> = {
  conversations: "שיחות אישיות",
  webhooks: "Webhooks",
  meta_api: "Meta API",
  group_broadcast: "קבוצות WhatsApp / הפצה",
};
