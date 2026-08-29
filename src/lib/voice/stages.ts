/**
 * VOICE PIPELINE STAGES (PURE, no I/O).
 *
 * Stage-level observability for inbound WhatsApp audio. Every stage is safe
 * to persist: no media bytes, no temporary media URL, no API keys.
 *
 * A text message is NOT a failed voice message: when no audio is present the
 * pipeline records `no_audio` on the receipt stage and never creates a
 * transcription-failed record.
 */
export const VOICE_STAGES = [
  "audio_received",
  "media_metadata",
  "media_download",
  "transcription_started",
  "transcription",
  "normalized",
  "runtime_dispatched",
] as const;
export type VoiceStage = (typeof VOICE_STAGES)[number];

export type VoiceStageEvent = {
  stage: VoiceStage;
  status: "ok" | "failed" | "skipped" | "started";
  /** short, non-secret detail (error class, mime, counts) */
  detail?: string | null;
};

/** Longest safe error text we keep on a stage row. */
const MAX_DETAIL = 200;

const SECRET_RE =
  /(Bearer\s+[\w.\-]+|sb_[A-Za-z0-9_\-]{8,}|eyJ[\w\-.]{20,}|access_token=[^&\s]+|https?:\/\/[^\s]*lookaside[^\s]*)/gi;

/** Strip credentials, tokens and media URLs from any stage detail. */
export function safeDetail(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value : String(value);
  const clean = raw.replace(SECRET_RE, "[redacted]").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, MAX_DETAIL) : null;
}

export function stageEvent(
  stage: VoiceStage,
  status: VoiceStageEvent["status"],
  detail?: unknown,
): VoiceStageEvent {
  return { stage, status, detail: safeDetail(detail) };
}

/** Stage classes are stable machine-readable failure buckets. */
export function failureClass(stage: VoiceStage): string {
  switch (stage) {
    case "media_metadata":
      return "media_metadata_failed";
    case "media_download":
      return "media_download_failed";
    case "transcription":
      return "transcription_failed";
    case "normalized":
      return "normalization_failed";
    default:
      return "voice_pipeline_failed";
  }
}

/** Safe, non-secret receipt facts recorded for EVERY inbound message. */
export function inboundReceipt(msg: {
  wamid?: string | null;
  type?: string | null;
  audio?: { id?: string | null; mime_type?: string | null } | null;
}): {
  inbound_message_id: string | null;
  message_type: string;
  has_audio: boolean;
  has_media_id: boolean;
  mime_type: string | null;
} {
  return {
    inbound_message_id: msg.wamid ?? null,
    message_type: String(msg.type ?? "unknown"),
    has_audio: !!msg.audio,
    has_media_id: !!msg.audio?.id,
    mime_type: msg.audio?.mime_type ? String(msg.audio.mime_type) : null,
  };
}
