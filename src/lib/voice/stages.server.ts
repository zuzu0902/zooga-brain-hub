/**
 * VOICE PIPELINE STAGE RECORDER (server only).
 *
 * Reuses the existing `webhook_logs` table — no migration. One row per
 * stage, ordered by insertion, carrying only safe non-secret data.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { failureClass, safeDetail, type VoiceStageEvent } from "./stages";

export async function recordVoiceStages(args: {
  inboundMessageId: string | null;
  contactId?: string | null;
  events: VoiceStageEvent[];
  receipt?: Record<string, unknown> | null;
}): Promise<boolean> {
  if (!args.events.length) return false;
  try {
    const rows = args.events.map((e, i) => ({
      source: "meta_whatsapp",
      status: `voice_${e.stage}_${e.status}`,
      payload: {
        pipeline: "voice",
        inbound_message_id: args.inboundMessageId,
        contact_id: args.contactId ?? null,
        stage: e.stage,
        stage_index: i,
        stage_status: e.status,
        detail: safeDetail(e.detail),
        failure_class: e.status === "failed" ? failureClass(e.stage) : null,
        ...(args.receipt ?? {}),
      },
    }));
    const { error } = await (supabaseAdmin as any).from("webhook_logs").insert(rows);
    return !error;
  } catch {
    return false;
  }
}
