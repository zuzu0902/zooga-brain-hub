/**
 * Lead -> contact reconciliation. Server-only.
 * A lead is never allowed into a campaign without a linked contact row.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone, splitName } from "@/lib/phone";

export async function ensureContactsForLeads(
  leadIds: string[],
): Promise<{ created: number; linked: number; byLead: Record<string, string> }> {
  const byLead: Record<string, string> = {};
  if (!leadIds.length) return { created: 0, linked: 0, byLead };

  const { data: leads } = await supabaseAdmin
    .from("imported_leads")
    .select("id, full_name, first_name, last_name, phone, contact_id, consent_status, consent_source, consent_at")
    .in("id", leadIds);
  if (!leads?.length) return { created: 0, linked: 0, byLead };

  const phones = Array.from(
    new Set(leads.map((l: any) => normalizePhone(l.phone)).filter(Boolean) as string[]),
  );
  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select("id, phone")
    .in("phone", phones);
  const byPhone = new Map<string, string>();
  (contacts ?? []).forEach((c: any) => c.phone && byPhone.set(c.phone, c.id));

  const toCreate: any[] = [];
  for (const l of leads as any[]) {
    const phone = normalizePhone(l.phone);
    if (!phone || byPhone.has(phone)) continue;
    const { first, last } = splitName(l.full_name);
    toCreate.push({
      phone,
      whatsapp_number: phone,
      full_name: l.full_name,
      first_name: l.first_name ?? first,
      last_name: l.last_name ?? last,
      source: "Manual",
      status: "new_lead",
      consent_marketing: l.consent_status === "approved",
      consent_date: l.consent_at ?? null,
      consent_source: l.consent_source ?? null,
    });
  }

  let created = 0;
  if (toCreate.length) {
    const { data: made } = await supabaseAdmin.from("contacts").insert(toCreate as any).select("id, phone");
    (made ?? []).forEach((c: any) => byPhone.set(c.phone, c.id));
    created = made?.length ?? 0;
  }

  let linked = 0;
  for (const l of leads as any[]) {
    const phone = normalizePhone(l.phone);
    const contactId = phone ? byPhone.get(phone) : undefined;
    if (!contactId) continue;
    byLead[l.id] = contactId;
    if (l.contact_id !== contactId) {
      await supabaseAdmin.from("imported_leads").update({ contact_id: contactId } as any).eq("id", l.id);
    }
    linked++;
  }
  return { created, linked, byLead };
}
