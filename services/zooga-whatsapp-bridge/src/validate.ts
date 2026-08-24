/** Pure request validation. Group-only sending is enforced here. */

export const GROUP_JID_SUFFIX = "@g.us";
const GROUP_JID_RE = /^\d{5,30}(?:-\d{5,20})?@g\.us$/;
const HTTPS_RE = /^https:\/\/[^\s]+$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,120}$/;

export type SendGroupInput = {
  chat_id: string;
  text: string;
  media_url?: string | null;
  idempotency_key: string;
};

export type ValidationError = { code: string; status: number };
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: ValidationError };

/** Only WhatsApp group JIDs are accepted. 1:1 JIDs are rejected outright. */
export function isGroupChatId(chatId: unknown): boolean {
  return typeof chatId === "string" && GROUP_JID_RE.test(chatId.trim());
}

export function validateSendGroup(
  body: unknown,
  limits: { maxTextLength: number },
): ValidationResult<SendGroupInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: { code: "invalid_body", status: 400 } };
  }
  const b = body as Record<string, unknown>;
  const chatId = typeof b["chat_id"] === "string" ? (b["chat_id"] as string).trim() : "";
  if (!isGroupChatId(chatId)) {
    return { ok: false, error: { code: "not_a_group_chat_id", status: 400 } };
  }
  const text = typeof b["text"] === "string" ? (b["text"] as string) : "";
  if (!text.trim()) return { ok: false, error: { code: "empty_text", status: 400 } };
  if (text.length > limits.maxTextLength) {
    return { ok: false, error: { code: "text_too_long", status: 413 } };
  }
  const rawMedia = b["media_url"];
  let mediaUrl: string | null = null;
  if (rawMedia !== undefined && rawMedia !== null && rawMedia !== "") {
    if (typeof rawMedia !== "string" || !HTTPS_RE.test(rawMedia)) {
      return { ok: false, error: { code: "media_url_must_be_https", status: 400 } };
    }
    mediaUrl = rawMedia;
  }
  const key = typeof b["idempotency_key"] === "string" ? (b["idempotency_key"] as string).trim() : "";
  if (!IDEMPOTENCY_RE.test(key)) {
    return { ok: false, error: { code: "invalid_idempotency_key", status: 400 } };
  }
  return { ok: true, value: { chat_id: chatId, text, media_url: mediaUrl, idempotency_key: key } };
}
