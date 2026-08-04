import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RawRow = z.object({
  full_name: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40),
  email: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  source_campaign: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const ImportInput = z.object({
  rows: z.array(RawRow).min(1).max(2000),
  source_file_name: z.string().trim().max(255).optional().nullable(),
  consent_marketing: z.boolean(),
  consent_source: z.string().trim().min(2).max(120),
  dry_run: z.boolean().optional(),
});

export type ImportLeadsResult = {
  ok: boolean;
  error?: string;
  total: number;
  imported: number;
  updated: number;
  invalid: number;
  duplicates_in_file: number;
  contacts_created: number;
  contacts_linked: number;
  dry_run: boolean;
};

/**
 * Server-side lead import.
 *  - normalizes to E.164 before anything touches the DB
 *  - de-duplicates inside the payload AND against the DB via a real unique
 *    index on imported_leads.phone (upsert, race-safe)
 *  - creates/updates the matching contact immediately and links lead -> contact
 *  - records consent + source + timestamp on both rows
 */
export const importLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ImportInput.parse(input))
  .handler(async ({ data }): Promise<ImportLeadsResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizePhone, splitName } = await import("@/lib/phone");

    const dryRun = !!data.dry_run;
    const now = new Date().toISOString();
    const result: ImportLeadsResult = {
      ok: true,
      total: data.rows.length,
      imported: 0,
      updated: 0,
      invalid: 0,
      duplicates_in_file: 0,
      contacts_created: 0,
      contacts_linked: 0,
      dry_run: dryRun,
    };

    const seen = new Set<string>();
    const clean: Array<{ phone: string; full_name: string | null; first: string | null; last: string | null; row: any }> = [];

    for (const row of data.rows) {
      const phone = normalizePhone(row.phone);
      if (!phone) {
        result.invalid++;
        continue;
      }
      if (seen.has(phone)) {
        result.duplicates_in_file++;
        continue;
      }
      seen.add(phone);
      const fullName = (row.full_name ?? "").trim() || null;
      const { first, last } = splitName(fullName);
      clean.push({ phone, full_name: fullName, first, last, row });
    }

    if (!clean.length) return { ...result, ok: false, error: "no_valid_rows" };
    if (dryRun) {
      result.imported = clean.length;
      return result;
    }

    // ---- contacts first, so every lead is linked from the start ----
    const phones = clean.map((c) => c.phone);
    const { data: existingContacts } = await supabaseAdmin
      .from("contacts")
      .select("id, phone")
      .in("phone", phones);
    const contactByPhone = new Map<string, string>();
    (existingContacts ?? []).forEach((c: any) => c.phone && contactByPhone.set(c.phone, c.id));

    const newContacts = clean
      .filter((c) => !contactByPhone.has(c.phone))
      .map((c) => ({
        phone: c.phone,
        whatsapp_number: c.phone,
        full_name: c.full_name,
        first_name: c.first,
        last_name: c.last,
        email: c.row.email || null,
        city: c.row.city || null,
        region: c.row.region || null,
        source: "Manual" as const,
        status: "new_lead" as const,
        consent_marketing: data.consent_marketing,
        consent_date: data.consent_marketing ? now : null,
        consent_source: data.consent_source,
      }));

    if (newContacts.length) {
      const { data: created, error } = await supabaseAdmin
        .from("contacts")
        .insert(newContacts as any)
        .select("id, phone");
      if (error) return { ...result, ok: false, error: error.message };
      (created ?? []).forEach((c: any) => contactByPhone.set(c.phone, c.id));
      result.contacts_created = created?.length ?? 0;
    }

    // refresh consent on pre-existing contacts only when consent is granted
    if (data.consent_marketing) {
      const existingIds = clean
        .map((c) => contactByPhone.get(c.phone))
        .filter(Boolean) as string[];
      if (existingIds.length) {
        await supabaseAdmin
          .from("contacts")
          .update({
            consent_marketing: true,
            consent_date: now,
            consent_source: data.consent_source,
            opted_out_at: null,
          } as any)
          .in("id", existingIds)
          .is("opted_out_at", null);
      }
    }

    // ---- leads: race-safe upsert on the unique phone index ----
    const leadRows = clean.map((c) => ({
      full_name: c.full_name,
      first_name: c.first,
      last_name: c.last,
      phone: c.phone,
      source_file_name: data.source_file_name ?? null,
      source_campaign: c.row.source_campaign || null,
      notes: c.row.notes || null,
      raw_row_data: c.row,
      contact_id: contactByPhone.get(c.phone) ?? null,
      import_status: "imported" as const,
      consent_status: (data.consent_marketing ? "approved" : "unknown") as any,
      consent_source: data.consent_source,
      consent_at: data.consent_marketing ? now : null,
    }));

    const { data: before } = await supabaseAdmin
      .from("imported_leads")
      .select("phone")
      .in("phone", phones);
    const existedBefore = new Set((before ?? []).map((l: any) => l.phone));

    const { data: upserted, error: upErr } = await supabaseAdmin
      .from("imported_leads")
      .upsert(leadRows as any, { onConflict: "phone", ignoreDuplicates: false })
      .select("id, phone, contact_id");
    if (upErr) return { ...result, ok: false, error: upErr.message };

    for (const l of upserted ?? []) {
      if (existedBefore.has((l as any).phone)) result.updated++;
      else result.imported++;
      if ((l as any).contact_id) result.contacts_linked++;
    }

    return result;
  });

const MarkInput = z.object({ lead_ids: z.array(z.string().uuid()).min(1).max(2000) });

/** Move leads to ready_for_intake and guarantee each one has a linked contact. */
export const markLeadsReady = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => MarkInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ensureContactsForLeads } = await import("@/lib/lead-contacts.server");

    const link = await ensureContactsForLeads(data.lead_ids);
    const { error } = await supabaseAdmin
      .from("imported_leads")
      .update({ import_status: "ready_for_intake", send_state: "queued" } as any)
      .in("id", data.lead_ids);
    if (error) return { ok: false, error: error.message };
    return { ok: true, marked: data.lead_ids.length, contacts_created: link.created, contacts_linked: link.linked };
  });
