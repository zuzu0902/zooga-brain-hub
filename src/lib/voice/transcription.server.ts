/**
 * VOICE TRANSCRIPTION — server only.
 *
 * Meta media id -> temporary media URL -> bytes in memory -> transcript.
 * The audio file is NEVER persisted and the temporary URL is never stored,
 * logged or returned. Buffers are dropped in a finally block, including on
 * failure. Only the transcript and its metadata are kept.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { audioFormat, sanitizeForLog, validateInboundAudio, MAX_AUDIO_BYTES } from "./audio";

const GRAPH_VERSION = "v21.0";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_GATEWAY_MODEL = "google/gemini-3.6-flash";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini-transcribe";

export type TranscriptionReadiness = {
  configured: boolean;
  provider: "lovable_ai" | "openai" | null;
  model: string | null;
  missing: string[];
};

/** Presence-only. Never returns a secret value. */
export function transcriptionReadiness(): TranscriptionReadiness {
  const hasLovable = !!process.env['LOVABLE_API_KEY'];
  const hasOpenAI = !!process.env['OPENAI_API_KEY'];
  const missing: string[] = [];
  if (!process.env['WHATSAPP_ACCESS_TOKEN']) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (!process.env['WHATSAPP_PHONE_NUMBER_ID']) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (hasOpenAI) {
    return {
      configured: missing.length === 0,
      provider: "openai",
      model: process.env['TRANSCRIPTION_MODEL'] ?? DEFAULT_OPENAI_MODEL,
      missing,
    };
  }
  if (hasLovable) {
    return {
      configured: missing.length === 0,
      provider: "lovable_ai",
      model: process.env['TRANSCRIPTION_MODEL'] ?? DEFAULT_GATEWAY_MODEL,
      missing,
    };
  }
  missing.push("LOVABLE_API_KEY או OPENAI_API_KEY");
  return { configured: false, provider: null, model: null, missing };
}

export type MediaFetchResult =
  | { ok: true; bytes: Uint8Array; mime: string; size: number }
  | { ok: false; error: string };

/**
 * Two server-side Graph calls: media id -> temporary URL -> bytes.
 * The URL lives only inside this function scope.
 */
export async function downloadMetaMedia(
  mediaId: string,
  opts: { phoneNumberId?: string | null } = {},
): Promise<MediaFetchResult> {
  const token = process.env['WHATSAPP_ACCESS_TOKEN'];
  if (!token) return { ok: false, error: "whatsapp_credentials_missing" };
  const phoneId = opts.phoneNumberId ?? process.env['WHATSAPP_PHONE_NUMBER_ID'] ?? null;
  let url: string | null = null;
  try {
    const metaUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(mediaId)}${
      phoneId ? `?phone_number_id=${encodeURIComponent(phoneId)}` : ""
    }`;
    const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
    const meta: any = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !meta?.url) {
      return { ok: false, error: sanitizeForLog(meta?.error?.message ?? `meta_${metaRes.status}`) };
    }
    url = String(meta.url);
    const declaredMime = String(meta.mime_type ?? "");
    const declaredSize = Number(meta.file_size ?? 0);
    const pre = validateInboundAudio({ mime: declaredMime, bytes: declaredSize });
    if (!pre.ok) return { ok: false, error: `rejected_${pre.reason}` };

    const binRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!binRes.ok) return { ok: false, error: `media_download_${binRes.status}` };
    const buf = new Uint8Array(await binRes.arrayBuffer());
    if (buf.byteLength > MAX_AUDIO_BYTES) return { ok: false, error: "rejected_too_large" };
    const post = validateInboundAudio({ mime: declaredMime, bytes: buf.byteLength });
    if (!post.ok) return { ok: false, error: `rejected_${post.reason}` };
    return { ok: true, bytes: buf, mime: declaredMime, size: buf.byteLength };
  } catch (e: any) {
    return { ok: false, error: sanitizeForLog(e?.message ?? String(e)) };
  } finally {
    url = null; // temporary URL is never kept
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // btoa exists in the Worker runtime
  return btoa(bin);
}

export type TranscriptionResult =
  | {
      ok: true;
      transcript: string;
      language: string | null;
      provider: string;
      model: string;
      /** only when the provider really returns one */
      confidence: number | null;
    }
  | { ok: false; error: string; provider: string | null; model: string | null };

/** Provider adapter. Audio bytes stay in memory for the call only. */
export async function transcribeAudio(input: {
  bytes: Uint8Array;
  mime: string;
}): Promise<TranscriptionResult> {
  const readiness = transcriptionReadiness();
  if (!readiness.provider) {
    return { ok: false, error: "transcription_provider_not_configured", provider: null, model: null };
  }
  const model = readiness.model!;
  try {
    if (readiness.provider === "openai") {
      const form = new FormData();
      form.append("model", model);
      form.append(
        "file",
        new Blob([input.bytes as unknown as BlobPart], { type: input.mime }),
        `voice.${audioFormat(input.mime)}`,
      );
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env['OPENAI_API_KEY']}` },
        body: form,
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: sanitizeForLog(json?.error?.message ?? `openai_${res.status}`),
          provider: "openai",
          model,
        };
      }
      return {
        ok: true,
        transcript: String(json?.text ?? "").trim(),
        language: json?.language ?? null,
        provider: "openai",
        model,
        confidence: typeof json?.confidence === "number" ? json.confidence : null,
      };
    }

    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env['LOVABLE_API_KEY']}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "תמלל את ההודעה הקולית המצורפת מילה במילה, בשפה שבה היא נאמרה (בדרך כלל עברית). " +
                  "החזר אך ורק את הטקסט המתומלל, בלי הקדמות. אם חלק לא ברור, סמן אותו [לא ברור].",
              },
              {
                type: "input_audio",
                input_audio: { data: toBase64(input.bytes), format: audioFormat(input.mime) },
              },
            ],
          },
        ],
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: sanitizeForLog(json?.error?.message ?? `gateway_${res.status}`),
        provider: "lovable_ai",
        model,
      };
    }
    const transcript = String(json?.choices?.[0]?.message?.content ?? "").trim();
    if (!transcript) {
      return { ok: false, error: "empty_transcript", provider: "lovable_ai", model };
    }
    return { ok: true, transcript, language: null, provider: "lovable_ai", model, confidence: null };
  } catch (e: any) {
    return {
      ok: false,
      error: sanitizeForLog(e?.message ?? String(e)),
      provider: readiness.provider,
      model,
    };
  }
}

export type VoiceIntakeResult = {
  status: "ok" | "duplicate" | "failed";
  transcript: string | null;
  confidence: number | null;
  error: string | null;
};

/**
 * Idempotent per WhatsApp message id: a replayed webhook never transcribes,
 * stores or answers twice.
 */
export async function transcribeInboundVoice(args: {
  contactId: string | null;
  waMessageId: string;
  mediaId: string;
  mime: string | null;
  phoneNumberId?: string | null;
  durationSeconds?: number | null;
}): Promise<VoiceIntakeResult> {
  const db = supabaseAdmin as any;
  const { data: existing } = await db
    .from("voice_transcripts")
    .select("id,status,transcript,confidence,error")
    .eq("wa_message_id", args.waMessageId)
    .maybeSingle();
  if (existing) {
    return {
      status: "duplicate",
      transcript: existing.transcript ?? null,
      confidence: existing.confidence ?? null,
      error: existing.error ?? null,
    };
  }

  const readiness = transcriptionReadiness();
  let bytes: Uint8Array | null = null;
  try {
    const media = await downloadMetaMedia(args.mediaId, { phoneNumberId: args.phoneNumberId ?? null });
    if (!media.ok) {
      await db.from("voice_transcripts").insert({
        contact_id: args.contactId,
        wa_message_id: args.waMessageId,
        media_id: args.mediaId,
        mime_type: args.mime,
        duration_seconds: args.durationSeconds ?? null,
        provider: readiness.provider,
        model: readiness.model,
        status: "failed",
        error: sanitizeForLog(media.error),
      });
      return { status: "failed", transcript: null, confidence: null, error: media.error };
    }
    bytes = media.bytes;
    const result = await transcribeAudio({ bytes, mime: media.mime || args.mime || "audio/ogg" });
    await db.from("voice_transcripts").insert({
      contact_id: args.contactId,
      wa_message_id: args.waMessageId,
      media_id: args.mediaId,
      mime_type: media.mime || args.mime,
      size_bytes: media.size,
      duration_seconds: args.durationSeconds ?? null,
      language: result.ok ? result.language : null,
      provider: result.provider,
      model: result.model,
      transcript: result.ok ? result.transcript : null,
      confidence: result.ok ? result.confidence : null,
      status: result.ok ? "transcribed" : "failed",
      error: result.ok ? null : sanitizeForLog(result.error),
    });
    if (!result.ok) {
      return { status: "failed", transcript: null, confidence: null, error: result.error };
    }
    return { status: "ok", transcript: result.transcript, confidence: result.confidence, error: null };
  } finally {
    // audio bytes are dropped on every path, success or failure
    bytes = null;
  }
}

/** Sanitized health for the Tamar Studio readiness card. */
export async function transcriptionHealth() {
  const readiness = transcriptionReadiness();
  const db = supabaseAdmin as any;
  const { data: lastOk } = await db
    .from("voice_transcripts")
    .select("created_at,provider,model")
    .eq("status", "transcribed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: lastErr } = await db
    .from("voice_transcripts")
    .select("created_at,error")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    ...readiness,
    last_success_at: lastOk?.created_at ?? null,
    last_error_at: lastErr?.created_at ?? null,
    last_error: lastErr?.error ? sanitizeForLog(lastErr.error) : null,
  };
}