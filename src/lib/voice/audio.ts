/**
 * Inbound voice-note validation — pure logic, no I/O, no secrets.
 */

export const SUPPORTED_AUDIO_MIME = [
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/amr",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
] as const;

/** WhatsApp caps voice notes at 16 MB; anything larger is not ours to process. */
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
export const MIN_AUDIO_BYTES = 512;

export type AudioValidation =
  | { ok: true; mime: string; format: string }
  | { ok: false; reason: "unsupported_mime" | "too_large" | "too_small" | "missing" };

function baseMime(raw: string | null | undefined): string {
  return String(raw ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Container hint the transcription provider needs alongside the bytes. */
export function audioFormat(mime: string | null | undefined): string {
  const m = baseMime(mime);
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("aac")) return "aac";
  if (m.includes("wav")) return "wav";
  if (m.includes("webm")) return "webm";
  if (m.includes("amr")) return "amr";
  return "ogg";
}

export function validateInboundAudio(input: {
  mime: string | null | undefined;
  bytes: number | null | undefined;
}): AudioValidation {
  const mime = baseMime(input.mime);
  if (!mime) return { ok: false, reason: "missing" };
  if (!(SUPPORTED_AUDIO_MIME as readonly string[]).includes(mime)) {
    return { ok: false, reason: "unsupported_mime" };
  }
  const bytes = Number(input.bytes ?? 0);
  if (bytes > MAX_AUDIO_BYTES) return { ok: false, reason: "too_large" };
  if (bytes > 0 && bytes < MIN_AUDIO_BYTES) return { ok: false, reason: "too_small" };
  return { ok: true, mime, format: audioFormat(mime) };
}

/** Never let a temporary media URL or a token reach a log or the client. */
export function sanitizeForLog(value: string | null | undefined): string {
  const s = String(value ?? "");
  if (!s) return "";
  return s
    .replace(/https?:\/\/[^\s"']+/g, "[url_redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/(access_token|api[_-]?key|token)=[^&\s]+/gi, "$1=[redacted]")
    .slice(0, 300);
}