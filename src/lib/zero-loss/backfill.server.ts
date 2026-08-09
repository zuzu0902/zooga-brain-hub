/**
 * IDEMPOTENT BACKFILL (server-only).
 *
 * Sources that already exist in the database:
 *  - contacts.phone / whatsapp_number  -> identity registry
 *  - imported_leads.phone              -> identity registry
 *  - webhook_logs (payload.inbound_message_id) -> vault "legacy_backfill"
 *
 * We never invent a raw payload: legacy vault rows carry only the evidence
 * we actually have plus source_confidence, and are marked processed so the
 * retry worker does not re-run history.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone } from "./core";
import { registerIdentity } from "./identity.server";
import { auditZeroLoss, phoneHash, sha256 } from "./vault.server";

export type BackfillReport = {
  dry_run: boolean;
  contacts_scanned: number;
  leads_scanned: number;
  identities_missing: number;
  identities_created: number;
  webhook_logs_scanned: number;
  vault_candidates: number;
  vault_created: number;
  skipped_invalid_phone: number;
};

export async function runBackfill(opts: { dryRun: boolean; limit?: number }): Promise<BackfillReport> {
  const limit = opts.limit ?? 2000;
  const report: BackfillReport = {
    dry_run: opts.dryRun,
    contacts_scanned: 0,
    leads_scanned: 0,
    identities_missing: 0,
    identities_created: 0,
    webhook_logs_scanned: 0,
    vault_candidates: 0,
    vault_created: 0,
    skipped_invalid_phone: 0,
  };

  const { data: existingIdentities } = await supabaseAdmin
    .from("contact_identity_registry" as any)
    .select("normalized_value")
    .limit(20000);
  const known = new Set(((existingIdentities as any[]) ?? []).map((r) => String(r.normalized_value)));

  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select("id, phone, whatsapp_number")
    .limit(limit);
  for (const c of ((contacts as any[]) ?? [])) {
    report.contacts_scanned++;
    for (const raw of [c.phone, c.whatsapp_number]) {
      const e164 = normalizePhone(raw);
      if (!e164) {
        if (raw) report.skipped_invalid_phone++;
        continue;
      }
      if (known.has(e164)) continue;
      known.add(e164);
      report.identities_missing++;
      if (!opts.dryRun) {
        const id = await registerIdentity(e164, c.id, "legacy_backfill:contacts");
        if (id) report.identities_created++;
      }
    }
  }

  const { data: leads } = await supabaseAdmin
    .from("imported_leads")
    .select("id, phone, contact_id")
    .limit(limit);
  for (const l of ((leads as any[]) ?? [])) {
    report.leads_scanned++;
    const e164 = normalizePhone(l.phone);
    if (!e164) {
      if (l.phone) report.skipped_invalid_phone++;
      continue;
    }
    if (known.has(e164)) continue;
    known.add(e164);
    report.identities_missing++;
    if (!opts.dryRun) {
      const id = await registerIdentity(e164, l.contact_id ?? null, "legacy_backfill:imported_leads");
      if (id) report.identities_created++;
    }
  }

  const { data: logs } = await supabaseAdmin
    .from("webhook_logs")
    .select("id, source, status, payload, created_at")
    .eq("source", "meta_whatsapp")
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data: vaultIds } = await supabaseAdmin
    .from("inbound_event_vault" as any)
    .select("provider_event_id")
    .limit(20000);
  const knownEvents = new Set(
    ((vaultIds as any[]) ?? []).map((v) => String(v.provider_event_id ?? "")).filter(Boolean),
  );

  for (const log of ((logs as any[]) ?? [])) {
    report.webhook_logs_scanned++;
    const wamid = log?.payload?.inbound_message_id ? String(log.payload.inbound_message_id) : null;
    if (!wamid || knownEvents.has(wamid)) continue;
    knownEvents.add(wamid);
    report.vault_candidates++;
    if (opts.dryRun) continue;
    const evidence = { legacy_backfill: true, source_confidence: "low", webhook_log_id: log.id, evidence: log.payload };
    const json = JSON.stringify(evidence);
    const { error } = await supabaseAdmin.from("inbound_event_vault" as any).insert({
      provider: "meta_whatsapp",
      provider_event_id: wamid,
      event_type: "message.legacy_backfill",
      dedupe_key: `meta_whatsapp:id:${wamid}`,
      raw_payload: evidence,
      payload_sha256: sha256(json),
      normalized_phone: null,
      phone_hash: phoneHash(null),
      processing_status: "processed",
      processed_at: log.created_at ?? new Date().toISOString(),
    } as any);
    if (!error) report.vault_created++;
  }

  await auditZeroLoss({
    action: opts.dryRun ? "backfill_dry_run" : "backfill_executed",
    actorLabel: "zero_loss",
    targetKind: "backfill",
    details: report as unknown as Record<string, unknown>,
  });

  return report;
}