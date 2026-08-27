/**
 * TAMAR V2 — audit trail for voice transcript normalization (server-only).
 *
 * The raw transcript stays exactly as produced by the transcription
 * provider. The normalized copy, the correction reason and the confidence
 * are written next to it so every rewrite is reviewable.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { VoiceNormalization } from "./voice-normalize";

const db = () => supabaseAdmin as any;

export async function recordVoiceNormalization(args: {
  contactId: string;
  waMessageId: string | null;
  normalization: VoiceNormalization;
}): Promise<boolean> {
  if (!args.waMessageId) return false;
  const patch = {
    transcript_normalized: args.normalization.changed ? args.normalization.normalized : null,
    normalization_reason: args.normalization.reason,
    normalization_confidence: args.normalization.confidence,
  };
  try {
    const { data } = await db()
      .from("voice_transcripts")
      .select("id")
      .eq("wa_message_id", args.waMessageId)
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      const { error } = await db().from("voice_transcripts").update(patch).eq("id", data.id);
      return !error;
    }
    const { error } = await db().from("voice_transcripts").insert({
      contact_id: args.contactId,
      wa_message_id: args.waMessageId,
      transcript: args.normalization.raw,
      status: "done",
      provider: "tamar_v2_normalizer",
      ...patch,
    });
    return !error;
  } catch {
    return false;
  }
}
