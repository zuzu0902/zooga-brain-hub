/**
 * PILOT ORCHESTRATION (SERVER).
 *
 * Owns the durable side of the canonical individual pilot journey:
 *   - import an approved pilot file -> eligibility only (never consent)
 *   - launch the personalized consent-first opener (reuses the existing
 *     consent-opening path; no parallel sender)
 *   - the 48h no-answer lifecycle (one follow-up, then a CRM alert)
 *   - a read-only Pilot Control Center status
 *
 * The WhatsApp group broadcast system is not touched anywhere in this module.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { quiet } from "@/lib/db-safe";
import { normalizePhone, splitName } from "@/lib/phone";
import {
  classifyPilotRows,
  pilotContactPatch,
  pilotImportCounts,
  type PilotImportRow,
} from "./eligibility";
import {
  decidePilotLifecycle,
  pilotFollowupText,
  pilotNoResponseAlert,
  type PilotLifecycleDecision,
} from "./lifecycle";
import { relationshipStatusDefinition } from "./relationship-status";

const CONTACT_PILOT_COLUMNS =
  "id, first_name, full_name, phone, whatsapp_number, opted_out_at, human_owned, consent_marketing, " +
  "whatsapp_opt_in_status, opening_status, last_inbound_at, last_interaction_at, " +
  "pilot_batch_id, pilot_file_name, pilot_eligible_at, pilot_opener_sent_at, pilot_followup_sent_at, pilot_no_response_at";

export type PilotImportResult = {
  ok: boolean;
  dry_run: boolean;
  batch_id: string | null;
  counts: ReturnType<typeof pilotImportCounts>;
  rows: ReturnType<typeof classifyPilotRows>;
  contacts_created: number;
  contacts_marked: number;
  error?: string;
};

/** Import an approved pilot file. Eligibility only — no consent is implied. */
export async function importPilotFile(args: {
  rows: PilotImportRow[];
  fileName: string;
  actorId: string;
  dryRun?: boolean;
}): Promise<PilotImportResult> {
  const dryRun = !!args.dryRun;
  const phones = args.rows
    .map((r) => normalizePhone(r?.phone))
    .filter((p): p is string => !!p);

  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("id, phone, whatsapp_number, opted_out_at, pilot_eligible_at, pilot_opener_sent_at")
    .in("phone", phones.length ? phones : ["__none__"]);

  const classified = classifyPilotRows({
    rows: args.rows,
    existing: ((existing as any[]) ?? []).map((c) => ({
      id: c.id,
      phone: c.phone ?? c.whatsapp_number ?? null,
      opted_out_at: c.opted_out_at,
      pilot_eligible_at: c.pilot_eligible_at,
      pilot_opener_sent_at: c.pilot_opener_sent_at,
    })),
  });
  const counts = pilotImportCounts(classified);

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      batch_id: null,
      counts,
      rows: classified,
      contacts_created: 0,
      contacts_marked: 0,
    };
  }

  const at = new Date().toISOString();
  const { data: batch, error: batchErr } = await supabaseAdmin
    .from("pilot_batches" as any)
    .insert({ file_name: args.fileName, imported_by: args.actorId, counts: counts as any } as any)
    .select("id")
    .maybeSingle();
  if (batchErr || !batch) {
    return {
      ok: false,
      dry_run: false,
      batch_id: null,
      counts,
      rows: classified,
      contacts_created: 0,
      contacts_marked: 0,
      error: batchErr?.message ?? "batch_insert_failed",
    };
  }
  const batchId = (batch as any).id as string;
  const patch = pilotContactPatch({ batchId, fileName: args.fileName, at });

  let created = 0;
  let marked = 0;
  for (const row of classified) {
    if (row.classification !== "eligible" || !row.phone) continue;
    if (row.contact_id) {
      const { error } = await supabaseAdmin
        .from("contacts")
        .update(patch as any)
        .eq("id", row.contact_id);
      if (!error) marked += 1;
      continue;
    }
    const name = splitName(row.full_name);
    const { error } = await supabaseAdmin.from("contacts").insert({
      phone: row.phone,
      whatsapp_number: row.phone,
      first_name: name.first,
      last_name: name.last,
      full_name: row.full_name,
      source: "Manual",
      status: "new_lead",
      ...patch,
    } as any);
    if (!error) created += 1;
  }

  await quiet(
    supabaseAdmin.from("zero_loss_audit_log" as any).insert({
      actor_user_id: args.actorId,
      actor_label: "pilot_console",
      action: "import_pilot_file",
      target_kind: "pilot_batch",
      target_id: batchId,
      details: { file_name: args.fileName, counts, contacts_created: created, contacts_marked: marked },
    } as any),
  );

  return {
    ok: true,
    dry_run: false,
    batch_id: batchId,
    counts,
    rows: classified,
    contacts_created: created,
    contacts_marked: marked,
  };
}

/** Ensure the canonical relationship-status menu exists in the CRM intake. */
export async function ensureRelationshipStatusQuestion() {
  const def = relationshipStatusDefinition();
  const { data: current } = await supabaseAdmin
    .from("intake_field_definitions")
    .select("id, presentation, options, enabled")
    .eq("field_key", def.field_key)
    .maybeSingle();
  if (!current) {
    const { error } = await supabaseAdmin.from("intake_field_definitions").insert(def as any);
    return { created: !error, updated: false, error: error?.message ?? null };
  }
  const { error } = await supabaseAdmin
    .from("intake_field_definitions")
    .update({ presentation: def.presentation, options: def.options as any, enabled: true } as any)
    .eq("id", (current as any).id);
  return { created: false, updated: !error, error: error?.message ?? null };
}

/** Send the personalized consent-first opener through the canonical sender. */
export async function launchPilotOpener(args: { contactId: string; dryRun?: boolean }) {
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select(CONTACT_PILOT_COLUMNS)
    .eq("id", args.contactId)
    .maybeSingle();
  if (!contact) return { ok: false, reason: "contact_not_found", reason_he: "איש הקשר לא נמצא" };

  const { isPilotOutreachEligible } = await import("./eligibility");
  const gate = isPilotOutreachEligible(contact as any);
  if (!gate.eligible) return { ok: false, reason: gate.reason, reason_he: gate.reason_he };

  const { sendConsentOpening } = await import("@/lib/whatsapp-optin/optin.server");
  const outcome = await sendConsentOpening(args.contactId, { dryRun: args.dryRun });
  if (outcome.status === "sent" && !args.dryRun) {
    await quiet(
      supabaseAdmin
        .from("contacts")
        .update({ pilot_opener_sent_at: new Date().toISOString() } as any)
        .eq("id", args.contactId)
        .is("pilot_opener_sent_at", null),
    );
  }
  return { ok: outcome.status === "sent", ...outcome };
}

export type PilotLifecycleRun = {
  scanned: number;
  followups_sent: number;
  alerts_raised: number;
  dry_run: boolean;
  items: Array<{ contact_id: string; decision: PilotLifecycleDecision; applied: boolean }>;
};

/**
 * The 48h no-answer lifecycle. Idempotent per contact: a follow-up is claimed
 * before it is sent, and the CRM alert is raised exactly once.
 */
export async function runPilotLifecycle(opts: { dryRun?: boolean; limit?: number } = {}): Promise<PilotLifecycleRun> {
  const dryRun = opts.dryRun !== false; // safe default: never sends unless explicitly asked
  const { data } = await supabaseAdmin
    .from("contacts")
    .select(CONTACT_PILOT_COLUMNS)
    .not("pilot_opener_sent_at", "is", null)
    .is("pilot_no_response_at", null)
    .limit(opts.limit ?? 100);

  const now = new Date();
  const run: PilotLifecycleRun = { scanned: 0, followups_sent: 0, alerts_raised: 0, dry_run: dryRun, items: [] };

  for (const c of ((data as any[]) ?? [])) {
    run.scanned += 1;
    const decision = decidePilotLifecycle(
      {
        opener_sent_at: c.pilot_opener_sent_at,
        followup_sent_at: c.pilot_followup_sent_at,
        no_response_at: c.pilot_no_response_at,
        last_inbound_at: c.last_inbound_at ?? c.last_interaction_at ?? null,
        opted_out_at: c.opted_out_at,
        human_owned: c.human_owned,
        consent_granted: !!c.consent_marketing,
      },
      now,
    );
    let applied = false;

    if (!dryRun && decision.action === "send_followup") {
      // Claim the single follow-up slot BEFORE the network call.
      const { data: claimed } = await supabaseAdmin
        .from("contacts")
        .update({ pilot_followup_sent_at: now.toISOString() } as any)
        .eq("id", c.id)
        .is("pilot_followup_sent_at", null)
        .select("id");
      if (claimed?.length) {
        const { sendWhatsAppText, recordDelivery } = await import("@/lib/whatsapp-meta.server");
        const to = String(c.whatsapp_number || c.phone || "");
        const text = pilotFollowupText(c.first_name);
        // LAST GATE before the real send: canonical live allowlist.
        const { assertLiveSendAllowed } = await import("./live-allowlist.server");
        const allow = await assertLiveSendAllowed({ phone: to, contactId: c.id, kind: "pilot_followup" });
        const res = allow.allowed
          ? await sendWhatsAppText(to, text)
          : { ok: false, error: allow.reason, error_he: allow.reason_he };
        if (allow.allowed) {
          await quiet(
            recordDelivery({ contactId: c.id, text, result: res as any, kind: "pilot_followup" }) as any,
          );
        }

        if (res?.ok) {
          run.followups_sent += 1;
          applied = true;
        } else {
          // Release the slot so the single follow-up is not silently lost.
          await quiet(
            supabaseAdmin.from("contacts").update({ pilot_followup_sent_at: null } as any).eq("id", c.id),
          );
        }
      }
    }

    if (!dryRun && decision.action === "raise_no_response_alert") {
      const { data: claimed } = await supabaseAdmin
        .from("contacts")
        .update({ pilot_no_response_at: now.toISOString() } as any)
        .eq("id", c.id)
        .is("pilot_no_response_at", null)
        .select("id");
      if (claimed?.length) {
        const alert = pilotNoResponseAlert({ contactId: c.id, firstName: c.first_name });
        await quiet(
          supabaseAdmin.from("tasks" as any).insert({
            contact_id: c.id,
            title: alert.title,
            description: alert.body,
            status: "pending",
            priority: "medium",
            task_type: "pilot_no_response",
          } as any),
        );
        await quiet(
          supabaseAdmin.from("zero_loss_audit_log" as any).insert({
            actor_label: "pilot_lifecycle",
            action: "pilot_no_response_alert",
            target_kind: "contact",
            target_id: c.id,
            details: { hours: decision.hours_since_last_outreach },
          } as any),
        );
        run.alerts_raised += 1;
        applied = true;
      }
    }

    run.items.push({ contact_id: c.id, decision, applied });
  }
  return run;
}

/** Read-only Pilot Control Center status (no phone numbers, no secrets). */
export async function pilotStatus() {
  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select(CONTACT_PILOT_COLUMNS)
    .not("pilot_eligible_at", "is", null)
    .order("pilot_eligible_at", { ascending: false })
    .limit(200);

  const { data: batches } = await supabaseAdmin
    .from("pilot_batches" as any)
    .select("id, file_name, counts, created_at, launched_at, paused")
    .order("created_at", { ascending: false })
    .limit(20);

  const now = new Date();
  const rows = ((contacts as any[]) ?? []).map((c) => {
    const decision = decidePilotLifecycle(
      {
        opener_sent_at: c.pilot_opener_sent_at,
        followup_sent_at: c.pilot_followup_sent_at,
        no_response_at: c.pilot_no_response_at,
        last_inbound_at: c.last_inbound_at ?? c.last_interaction_at ?? null,
        opted_out_at: c.opted_out_at,
        human_owned: c.human_owned,
        consent_granted: !!c.consent_marketing,
      },
      now,
    );
    return {
      contact_id: c.id as string,
      name: (c.first_name || c.full_name || "—") as string,
      file_name: c.pilot_file_name as string | null,
      opener_sent_at: c.pilot_opener_sent_at as string | null,
      followup_sent_at: c.pilot_followup_sent_at as string | null,
      no_response_at: c.pilot_no_response_at as string | null,
      consent: !!c.consent_marketing,
      opted_out: !!c.opted_out_at,
      human_owned: !!c.human_owned,
      next_action: decision.action,
      next_action_he: decision.reason_he,
    };
  });

  return {
    generated_at: now.toISOString(),
    totals: {
      eligible: rows.length,
      opener_sent: rows.filter((r) => !!r.opener_sent_at).length,
      awaiting_reply: rows.filter((r) => !!r.opener_sent_at && !r.consent && !r.no_response_at && !r.opted_out).length,
      consented: rows.filter((r) => r.consent).length,
      opted_out: rows.filter((r) => r.opted_out).length,
      no_response: rows.filter((r) => !!r.no_response_at).length,
      human_owned: rows.filter((r) => r.human_owned).length,
      followup_due: rows.filter((r) => r.next_action === "send_followup").length,
    },
    rows,
    batches: ((batches as any[]) ?? []).map((b) => ({
      id: b.id,
      file_name: b.file_name,
      counts: b.counts,
      created_at: b.created_at,
      launched_at: b.launched_at,
      paused: !!b.paused,
    })),
  };
}
