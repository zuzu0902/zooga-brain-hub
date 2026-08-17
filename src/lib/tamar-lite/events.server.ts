/**
 * TAMAR LITE — shadow dual-write of inbound/status events.
 *
 * Called from the webhook AFTER signature verification and AFTER the durable
 * zero-loss vault write. It is idempotent on provider_event_id and can NEVER
 * break the legacy flow: every failure is swallowed and logged.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = () => supabaseAdmin as any;

export type LiteEventInput = {
  providerEventId: string;
  kind: "message" | "status" | "unknown";
  contactId?: string | null;
  phoneMasked?: string | null;
  metaTimestamp?: string | null;
  payload?: Record<string, unknown>;
};

export async function recordLiteEvent(input: LiteEventInput): Promise<{ ok: boolean; duplicate: boolean }> {
  if (!input?.providerEventId) return { ok: false, duplicate: false };
  try {
    const { error } = await db()
      .from("tamar_lite_events")
      .insert({
        provider_event_id: input.providerEventId,
        event_kind: input.kind,
        contact_id: input.contactId ?? null,
        phone_masked: input.phoneMasked ?? null,
        meta_timestamp: input.metaTimestamp ?? null,
        payload: input.payload ?? {},
        processing_state: "pending",
      });
    if (error) {
      const duplicate = String(error.code) === "23505" || /duplicate key/i.test(error.message ?? "");
      if (duplicate) return { ok: true, duplicate: true };
      await logLiteFailure("insert_event", error.message ?? String(error));
      return { ok: false, duplicate: false };
    }
    return { ok: true, duplicate: false };
  } catch (err: any) {
    await logLiteFailure("insert_event_throw", String(err?.message ?? err));
    return { ok: false, duplicate: false };
  }
}

export async function logLiteFailure(stage: string, message: string) {
  try {
    await db()
      .from("webhook_logs")
      .insert({
        source: "tamar_lite_shadow",
        status: "shadow_error",
        error: `${stage}: ${message}`.slice(0, 500),
        payload: { stage },
      });
  } catch {
    /* shadow telemetry must never throw */
  }
}