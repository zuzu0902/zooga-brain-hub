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
        // Only inbound messages are processable. status/unknown events are
        // ledger-only and go straight to the FINAL state "recorded", so the
        // pending backlog can never inflate with rows nobody will ever process.
        processing_state: input.kind === "message" ? "pending" : "recorded",
      });
    if (error) {
      const duplicate = String(error.code) === "23505" || /duplicate key/i.test(error.message ?? "");
      if (duplicate) {
        // real duplicate telemetry: the row is kept, the counter grows
        await db().rpc("tamar_lite_bump_duplicate", { p_provider_event_id: input.providerEventId });
        return { ok: true, duplicate: true };
      }
      await logLiteFailure("insert_event", error.message ?? String(error));
      return { ok: false, duplicate: false };
    }
    return { ok: true, duplicate: false };
  } catch (err: any) {
    await logLiteFailure("insert_event_throw", String(err?.message ?? err));
    return { ok: false, duplicate: false };
  }
}

export type LiteSignals = {
  text?: string | null;
  source_type?: "text" | "voice" | "interactive";
  is_opt_out?: boolean;
  is_handoff_request?: boolean;
  is_direct_question?: boolean;
  is_topic_shift?: boolean;
  consent_granted?: boolean;
};

/**
 * Idempotently link an already-stored lite event to the resolved contact and
 * merge the deterministic signals into its payload. Never touches CRM data;
 * every failure is swallowed and logged.
 */
export async function attachLiteEvent(
  providerEventId: string,
  contactId: string | null,
  signals: LiteSignals = {},
): Promise<string | null> {
  if (!providerEventId) return null;
  try {
    const { data, error } = await db().rpc("tamar_lite_attach_contact", {
      p_provider_event_id: providerEventId,
      p_contact_id: contactId,
      p_payload: signals as any,
    });
    if (error) {
      await logLiteFailure("attach_contact", error.message ?? String(error));
      return null;
    }
    return (data as string) ?? null;
  } catch (err: any) {
    await logLiteFailure("attach_contact_throw", String(err?.message ?? err));
    return null;
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