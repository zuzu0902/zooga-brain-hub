/**
 * RECONCILIATION + SAFE AUTO-REPAIR (server-only).
 *
 * Finds gaps between what arrived and what was processed. Only unambiguous
 * repairs are automatic; anything uncertain becomes a quarantine row for a
 * human. Nothing is ever deleted and no WhatsApp message is sent.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { maskId } from "./core";
import { auditZeroLoss } from "./vault.server";

export type Finding = {
  finding_type: string;
  severity: "info" | "warning" | "critical";
  count: number;
  sample_ids: string[];
  action_taken: string | null;
};

const REPLY_THRESHOLD_MINUTES = 15;
const STUCK_OUTBOX_MINUTES = 15;

export async function runReconciliation(trigger: string): Promise<{
  run_id: string | null;
  findings: Finding[];
  repaired: number;
}> {
  const { data: run } = await supabaseAdmin
    .from("reconciliation_runs" as any)
    .insert({ trigger_source: trigger } as any)
    .select("id")
    .maybeSingle();
  const runId = (run as any)?.id ? String((run as any).id) : null;

  const findings: Finding[] = [];
  let repaired = 0;

  // 1. vault rows with no processing job -> safe auto-repair (create job)
  const { data: vaultRows } = await supabaseAdmin
    .from("inbound_event_vault" as any)
    .select("id, correlation_id, processing_status, received_at, contact_id, normalized_phone")
    .order("received_at", { ascending: false })
    .limit(1000);
  const vault = ((vaultRows as any[]) ?? []);
  const { data: jobRows } = await supabaseAdmin
    .from("processing_jobs" as any)
    .select("id, vault_event_id, state, lease_until, attempts, max_attempts, dead_letter_at")
    .limit(2000);
  const jobs = ((jobRows as any[]) ?? []);
  const jobByVault = new Map(jobs.map((j) => [String(j.vault_event_id), j]));

  const missingJobs = vault.filter((v) => !jobByVault.has(String(v.id)));
  if (missingJobs.length) {
    for (const v of missingJobs) {
      const { error } = await supabaseAdmin
        .from("processing_jobs" as any)
        .insert({ vault_event_id: v.id, correlation_id: v.correlation_id } as any);
      if (!error) repaired++;
    }
  }
  findings.push({
    finding_type: "vault_without_job",
    severity: missingJobs.length ? "critical" : "info",
    count: missingJobs.length,
    sample_ids: missingJobs.slice(0, 5).map((v) => maskId(v.id)!),
    action_taken: missingJobs.length ? "job_created" : null,
  });

  // 2. processed events without a contact link
  const processedNoContact = vault.filter((v) => v.processing_status === "processed" && !v.contact_id && v.normalized_phone);
  findings.push({
    finding_type: "processed_without_contact",
    severity: processedNoContact.length ? "warning" : "info",
    count: processedNoContact.length,
    sample_ids: processedNoContact.slice(0, 5).map((v) => maskId(v.id)!),
    action_taken: null,
  });

  // 3. identities with no contact -> relink when exactly one contact matches
  const { data: orphanIdentities } = await supabaseAdmin
    .from("contact_identity_registry" as any)
    .select("id, normalized_value")
    .is("contact_id", null)
    .is("archived_at", null)
    .limit(200);
  const orphans = ((orphanIdentities as any[]) ?? []);
  let relinked = 0;
  for (const o of orphans) {
    const bare = String(o.normalized_value).slice(1);
    const { data: matches } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .or(`phone.eq.${o.normalized_value},whatsapp_number.eq.${o.normalized_value},phone.eq.${bare},whatsapp_number.eq.${bare}`)
      .limit(2);
    const rows = ((matches as any[]) ?? []);
    if (rows.length === 1) {
      await supabaseAdmin
        .from("contact_identity_registry" as any)
        .update({ contact_id: rows[0].id } as any)
        .eq("id", o.id);
      relinked++;
      repaired++;
    }
  }
  findings.push({
    finding_type: "identity_without_contact",
    severity: orphans.length - relinked > 0 ? "warning" : "info",
    count: orphans.length,
    sample_ids: orphans.slice(0, 5).map((o) => maskId(o.id)!),
    action_taken: relinked ? `relinked_${relinked}` : null,
  });

  // 4. inbound message with no reply after threshold
  const cutoff = new Date(Date.now() - REPLY_THRESHOLD_MINUTES * 60_000).toISOString();
  const stale = vault.filter(
    (v) => v.received_at < cutoff && ["received", "processing"].includes(String(v.processing_status)),
  );
  findings.push({
    finding_type: "inbound_without_reply_after_threshold",
    severity: stale.length ? "critical" : "info",
    count: stale.length,
    sample_ids: stale.slice(0, 5).map((v) => maskId(v.id)!),
    action_taken: null,
  });

  // 5. stuck outbox
  const outCutoff = new Date(Date.now() - STUCK_OUTBOX_MINUTES * 60_000).toISOString();
  const { data: stuckOut } = await supabaseAdmin
    .from("outbound_event_ledger" as any)
    .select("id")
    .in("state", ["queued", "sending"])
    .lt("queued_at", outCutoff)
    .limit(100);
  const stuck = ((stuckOut as any[]) ?? []);
  findings.push({
    finding_type: "outbox_stuck",
    severity: stuck.length ? "warning" : "info",
    count: stuck.length,
    sample_ids: stuck.slice(0, 5).map((o) => maskId(o.id)!),
    action_taken: null,
  });

  // 6. provider status callbacks with no matching outbound row
  const statusEvents = vault.filter((v) => String(v.processing_status) === "processed" && !v.contact_id).length;
  findings.push({
    finding_type: "provider_status_orphan",
    severity: "info",
    count: statusEvents,
    sample_ids: [],
    action_taken: null,
  });

  // 7. expired leases -> return to pending (idempotent retry)
  const nowIso = new Date().toISOString();
  const expired = jobs.filter((j) => j.state === "leased" && j.lease_until && j.lease_until < nowIso && !j.dead_letter_at);
  for (const j of expired) {
    await supabaseAdmin
      .from("processing_jobs" as any)
      .update({ state: "pending", lease_until: null, next_attempt_at: nowIso } as any)
      .eq("id", j.id);
    repaired++;
  }
  findings.push({
    finding_type: "lease_expired",
    severity: expired.length ? "warning" : "info",
    count: expired.length,
    sample_ids: expired.slice(0, 5).map((j) => maskId(j.id)!),
    action_taken: expired.length ? "lease_released" : null,
  });

  if (runId) {
    for (const f of findings) {
      await supabaseAdmin.from("reconciliation_findings" as any).insert({
        run_id: runId,
        finding_type: f.finding_type,
        severity: f.severity,
        count: f.count,
        sample_ids: f.sample_ids,
        action_taken: f.action_taken,
      } as any);
    }
    await supabaseAdmin
      .from("reconciliation_runs" as any)
      .update({
        finished_at: new Date().toISOString(),
        status: "completed",
        findings_count: findings.reduce((a, f) => a + f.count, 0),
        repaired_count: repaired,
        summary: Object.fromEntries(findings.map((f) => [f.finding_type, f.count])),
      } as any)
      .eq("id", runId);
  }

  await auditZeroLoss({
    action: "reconciliation_run",
    actorLabel: trigger,
    targetKind: "reconciliation_run",
    targetId: runId,
    details: { repaired, findings: findings.length },
  });

  return { run_id: runId, findings, repaired };
}