/**
 * ZERO-LOSS INGESTION VAULT (server-only).
 *
 * Contract: an HTTP 2xx is only ever returned to Meta after the raw event is
 * durably committed to `inbound_event_vault`. If the durable write fails the
 * caller MUST return 5xx so Meta retries. Nothing here creates contacts,
 * calls a model or sends a message.
 */
import { createHash, randomUUID } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  backoffSeconds,
  buildDedupeKey,
  normalizePhone,
  type QuarantineReason,
  type ZlSplitEvent,
} from "./core";

export const PROVIDER = "meta_whatsapp";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function phoneHash(e164: string | null): string | null {
  return e164 ? sha256("zooga:phone:" + e164) : null;
}

export type IngestResult = {
  vault_id: string;
  correlation_id: string;
  duplicate: boolean;
};

/** Durable append of one raw event + its processing job. Throws on failure. */
export async function ingestEvent(ev: ZlSplitEvent, opts?: { correlationId?: string | null }): Promise<IngestResult> {
  const rawJson = JSON.stringify(ev.raw ?? null);
  const digest = sha256(rawJson);
  const e164 = normalizePhone(ev.phone);
  const dedupeKey = buildDedupeKey({
    provider: PROVIDER,
    providerEventId: ev.provider_event_id,
    eventType: ev.event_type,
    payloadSha256: digest,
  });

  const { data, error } = await supabaseAdmin.rpc("zl_ingest_event" as any, {
    p_provider: PROVIDER,
    p_provider_event_id: ev.provider_event_id,
    p_event_type: ev.event_type,
    p_dedupe_key: dedupeKey,
    p_raw_payload: ev.raw ?? {},
    p_payload_sha256: digest,
    p_normalized_phone: e164,
    p_phone_hash: phoneHash(e164),
    p_correlation_id: opts?.correlationId ?? randomUUID(),
  } as any);

  if (error) throw new Error(`vault_unavailable: ${error.message}`);
  const row: any = Array.isArray(data) ? data[0] : data;
  if (!row?.vault_id) throw new Error("vault_unavailable: no row returned");
  return {
    vault_id: String(row.vault_id),
    correlation_id: String(row.correlation_id),
    duplicate: !!row.duplicate,
  };
}

/** Mark the job for a freshly ingested event as in-flight for this request. */
export async function leaseJobForVault(vaultId: string, worker: string, leaseSeconds = 120): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("processing_jobs" as any)
    .select("id, attempts")
    .eq("vault_event_id", vaultId)
    .maybeSingle();
  const job: any = data;
  if (!job?.id) return null;
  await supabaseAdmin
    .from("processing_jobs" as any)
    .update({
      state: "leased",
      attempts: (Number(job.attempts) || 0) + 1,
      leased_by: worker,
      lease_until: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
    } as any)
    .eq("id", job.id);
  await supabaseAdmin
    .from("inbound_event_vault" as any)
    .update({ processing_status: "processing", claimed_at: new Date().toISOString(), claimed_by: worker } as any)
    .eq("id", vaultId);
  return String(job.id);
}

/** Terminal success / retryable failure. Never deletes anything. */
export async function finishJob(args: {
  jobId: string | null;
  success: boolean;
  error?: string | null;
  attempt?: number;
  contactId?: string | null;
}): Promise<void> {
  if (!args.jobId) return;
  await supabaseAdmin.rpc("zl_finish_job" as any, {
    p_job_id: args.jobId,
    p_success: args.success,
    p_error: args.error ?? null,
    p_backoff_seconds: backoffSeconds(args.attempt ?? 1),
    p_contact_id: args.contactId ?? null,
  } as any);
}

/** Park an event for human review. Idempotent per vault event. */
export async function quarantineEvent(args: {
  vaultId: string;
  jobId?: string | null;
  reason: QuarantineReason;
  severity?: "info" | "warning" | "critical";
  details?: Record<string, unknown>;
}): Promise<void> {
  const { vaultId, jobId = null, reason, severity = "warning", details = {} } = args;
  await supabaseAdmin
    .from("quarantine_events" as any)
    .upsert(
      {
        vault_event_id: vaultId,
        reason_code: reason,
        severity,
        details,
      } as any,
      { onConflict: "vault_event_id" } as any,
    );
  await supabaseAdmin
    .from("inbound_event_vault" as any)
    .update({ processing_status: "quarantined", last_error_code: reason } as any)
    .eq("id", vaultId);
  if (jobId) {
    await supabaseAdmin
      .from("processing_jobs" as any)
      .update({
        state: "failed",
        lease_until: null,
        last_error: `quarantined:${reason}`,
        next_attempt_at: new Date(Date.now() + 3600_000).toISOString(),
      } as any)
      .eq("id", jobId);
  }
}

/** Append-only audit trail for every admin/system action. */
export async function auditZeroLoss(args: {
  action: string;
  actorUserId?: string | null;
  actorLabel?: string | null;
  targetKind?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  await supabaseAdmin.from("zero_loss_audit_log" as any).insert({
    action: args.action,
    actor_user_id: args.actorUserId ?? null,
    actor_label: args.actorLabel ?? null,
    target_kind: args.targetKind ?? null,
    target_id: args.targetId ?? null,
    details: args.details ?? {},
  } as any);
}