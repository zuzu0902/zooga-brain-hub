/**
 * Delivery-callback + inbound-state reconciliation (server-only).
 * Meta reports recipients as bare digits; the CRM stores E.164. Every match
 * goes through phoneVariants() so the two never drift apart again.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { phoneVariants, toE164, type MetaStatusUpdate } from "@/lib/whatsapp-meta.server";

const TS_COLUMN: Record<string, string> = {
  sent: "sent_at",
  delivered: "delivered_at",
  read: "read_at",
};

const LEAD_TEMPLATE_STATUS: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

/** Apply one Meta status callback to campaign_contacts + imported_leads. */
export async function applyStatusUpdate(s: MetaStatusUpdate): Promise<void> {
  const nowIso = new Date().toISOString();
  const variants = phoneVariants(s.recipient);
  const tsCol = TS_COLUMN[s.status];
  const isFailure = s.status === "failed";

  const patchCommon: Record<string, unknown> = {
    ...(tsCol ? { [tsCol]: nowIso } : {}),
    ...(isFailure ? { last_error: (s.error ?? "meta_failed").slice(0, 300) } : {}),
  };

  // 1) match by provider_message_id (exact)
  if (s.wamid) {
    await supabaseAdmin
      .from("campaign_contacts")
      .update({ ...patchCommon, send_state: isFailure ? "failed_retryable" : s.status, last_activity_at: nowIso } as any)
      .eq("provider_message_id", s.wamid);
    await supabaseAdmin
      .from("imported_leads")
      .update({
        ...patchCommon,
        send_state: isFailure ? "failed_retryable" : s.status,
        whatsapp_template_status: (LEAD_TEMPLATE_STATUS[s.status] ?? "sent") as any,
        last_message_at: nowIso,
      } as any)
      .eq("provider_message_id", s.wamid);
  }

  // 2) fallback: match by normalized phone on rows already in flight
  if (variants.length) {
    await supabaseAdmin
      .from("imported_leads")
      .update({
        ...patchCommon,
        whatsapp_template_status: (LEAD_TEMPLATE_STATUS[s.status] ?? "sent") as any,
        last_message_at: nowIso,
      } as any)
      .in("phone", variants)
      .in("whatsapp_template_status", ["sent", "delivered"] as any);
  }

  await supabaseAdmin.from("webhook_logs").insert({
    source: "meta_whatsapp_status",
    status: s.status,
    error: s.error,
    payload: { provider_message_id: s.wamid, recipient_present: !!s.recipient },
  } as any);
}

/** Mark replied on the lead + campaign membership for an inbound message. */
export async function markReplied(phone: string, contactId: string | null): Promise<void> {
  const nowIso = new Date().toISOString();
  const variants = phoneVariants(phone);
  if (variants.length) {
    await supabaseAdmin
      .from("imported_leads")
      .update({
        send_state: "replied",
        replied_at: nowIso,
        whatsapp_template_status: "replied" as any,
        import_status: "replied" as any,
        last_message_at: nowIso,
        ...(contactId ? { contact_id: contactId } : {}),
      } as any)
      .in("phone", variants);
  }
  if (contactId) {
    await supabaseAdmin
      .from("campaign_contacts")
      .update({ send_state: "replied", replied_at: nowIso, last_activity_at: nowIso } as any)
      .eq("contact_id", contactId)
      .in("send_state", ["sent", "delivered", "read"]);
  }
}

/** Persist an opt-out across contact, lead and campaign membership. */
export async function applyOptOut(phone: string, contactId: string | null): Promise<void> {
  const nowIso = new Date().toISOString();
  const variants = phoneVariants(phone);
  const e164 = toE164(phone);

  if (contactId) {
    await supabaseAdmin
      .from("contacts")
      .update({ consent_marketing: false, opted_out_at: nowIso } as any)
      .eq("id", contactId);
    await supabaseAdmin
      .from("campaign_contacts")
      .update({ send_state: "opted_out", opted_out_at: nowIso } as any)
      .eq("contact_id", contactId)
      .neq("send_state", "opted_out");
  } else if (e164) {
    await supabaseAdmin
      .from("contacts")
      .update({ consent_marketing: false, opted_out_at: nowIso } as any)
      .in("phone", variants);
  }

  if (variants.length) {
    await supabaseAdmin
      .from("imported_leads")
      .update({
        send_state: "opted_out",
        opted_out_at: nowIso,
        import_status: "opted_out" as any,
        consent_status: "declined" as any,
      } as any)
      .in("phone", variants);
  }

  await supabaseAdmin.from("webhook_logs").insert({
    source: "meta_whatsapp_optout",
    status: "opted_out",
    payload: { contact_id: contactId, phone_present: !!phone },
  } as any);
}

/** Re-enable marketing after an explicit opt-in. */
export async function applyOptIn(phone: string, contactId: string | null): Promise<void> {
  const nowIso = new Date().toISOString();
  const variants = phoneVariants(phone);
  if (contactId) {
    await supabaseAdmin
      .from("contacts")
      .update({ consent_marketing: true, opted_out_at: null, consent_date: nowIso, consent_source: "whatsapp_opt_in" } as any)
      .eq("id", contactId);
  }
  if (variants.length) {
    await supabaseAdmin
      .from("imported_leads")
      .update({ consent_status: "approved" as any, opted_out_at: null, send_state: "queued" } as any)
      .in("phone", variants);
  }
}

/** True when this contact/phone must not receive proactive marketing. */
export async function isMarketingBlocked(contactId: string | null, phone?: string | null): Promise<boolean> {
  if (contactId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("consent_marketing, opted_out_at")
      .eq("id", contactId)
      .maybeSingle();
    if (!data) return true;
    return !(data as any).consent_marketing || !!(data as any).opted_out_at;
  }
  const variants = phoneVariants(phone);
  if (!variants.length) return true;
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("consent_marketing, opted_out_at")
    .in("phone", variants)
    .maybeSingle();
  if (!data) return true;
  return !(data as any).consent_marketing || !!(data as any).opted_out_at;
}
