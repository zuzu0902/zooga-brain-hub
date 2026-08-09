/**
 * PHONE IDENTITY REGISTRY (server-only).
 *
 * A phone number that ever reached the system is never lost: the registry
 * row survives contact deletion (FK is ON DELETE SET NULL) and archiving.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone } from "./core";
import { phoneHash } from "./vault.server";

export type IdentityResolution = {
  identity_id: string | null;
  contact_id: string | null;
  created_contact: boolean;
  normalized_phone: string | null;
};

/** Register the number (idempotent) and link it to a contact when known. */
export async function registerIdentity(
  phone: string | null | undefined,
  contactId: string | null,
  source: string,
): Promise<string | null> {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  const { data, error } = await supabaseAdmin.rpc("zl_register_identity" as any, {
    p_normalized_value: e164,
    p_value_hash: phoneHash(e164),
    p_contact_id: contactId,
    p_source: source,
  } as any);
  if (error) return null;
  return data ? String(data) : null;
}

async function findContactByPhone(e164: string): Promise<string | null> {
  const bare = e164.slice(1);
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .or(`phone.eq.${e164},whatsapp_number.eq.${e164},phone.eq.${bare},whatsapp_number.eq.${bare}`)
    .limit(1)
    .maybeSingle();
  return (data as any)?.id ?? null;
}

/**
 * Resolve (or create) the contact for an inbound number, always through the
 * registry. Failure to create a contact is surfaced so the caller can keep
 * the event recoverable rather than dropping it.
 */
export async function resolveIdentity(args: {
  phone: string | null | undefined;
  displayName?: string | null;
  source?: string;
  createIfMissing?: boolean;
}): Promise<IdentityResolution> {
  const e164 = normalizePhone(args.phone);
  if (!e164) return { identity_id: null, contact_id: null, created_contact: false, normalized_phone: null };
  const source = args.source ?? "meta_whatsapp";

  const { data: existing } = await supabaseAdmin
    .from("contact_identity_registry" as any)
    .select("id, contact_id")
    .eq("identity_type", "whatsapp")
    .eq("normalized_value", e164)
    .maybeSingle();

  let contactId: string | null = (existing as any)?.contact_id ?? null;
  if (contactId) {
    const { data: alive } = await supabaseAdmin.from("contacts").select("id").eq("id", contactId).maybeSingle();
    if (!alive) contactId = null;
  }
  if (!contactId) contactId = await findContactByPhone(e164);

  let created = false;
  if (!contactId && args.createIfMissing !== false) {
    const { data: inserted, error } = await supabaseAdmin
      .from("contacts")
      .insert({
        full_name: args.displayName || e164,
        phone: e164,
        whatsapp_number: e164,
        source: "Tamar WhatsApp",
        status: "new_lead",
      } as any)
      .select("id")
      .maybeSingle();
    if (error || !(inserted as any)?.id) {
      // Keep the number no matter what; the event stays retryable upstream.
      const idOnly = await registerIdentity(e164, null, source);
      throw Object.assign(new Error(`contact_resolution_failed: ${error?.message ?? "insert_failed"}`), {
        identity_id: idOnly,
      });
    }
    contactId = String((inserted as any).id);
    created = true;
  }

  const identityId = await registerIdentity(e164, contactId, source);
  return { identity_id: identityId, contact_id: contactId, created_contact: created, normalized_phone: e164 };
}

/** Archive (never delete) a contact, keeping its identity rows intact. */
export async function archiveContact(contactId: string, reason: string): Promise<void> {
  await supabaseAdmin
    .from("contacts")
    .update({ archived_at: new Date().toISOString(), archive_reason: reason } as any)
    .eq("id", contactId);
}