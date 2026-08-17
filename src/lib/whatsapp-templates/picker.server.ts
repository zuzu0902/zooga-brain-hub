/**
 * Template picker data for the contact card: the live 24h window plus every
 * template that may (or may not) be used, each with an exact reason.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sessionWindowState } from "@/lib/whatsapp-meta.server";
import { isOfferSellable } from "@/lib/offer-sellable";
import { listStoredTemplates } from "./sync.server";
import { autofillParams, templateBlockReason } from "./schema";

export type PickerTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  body_text: string;
  header: any;
  footer_text: string | null;
  buttons: any[];
  variable_count: number;
  variable_schema: any[];
  is_default: boolean;
  requires_active_offer: boolean;
  purpose: string | null;
  topics: string[];
  last_checked_at: string | null;
  usable: boolean;
  block_reason_he: string | null;
  suggested_params: string[];
};

export async function loadTemplatePicker(args: {
  contactId: string;
  topic: string;
  offerId?: string | null;
}): Promise<{
  session_window: Awaited<ReturnType<typeof sessionWindowState>>;
  templates: PickerTemplate[];
  synced_at: string | null;
}> {
  const [window, stored] = await Promise.all([sessionWindowState(args.contactId), listStoredTemplates()]);

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("first_name, full_name")
    .eq("id", args.contactId)
    .maybeSingle();

  let offer: any = null;
  if (args.offerId) {
    const { data } = await supabaseAdmin
      .from("offers")
      .select("id, title, offer_url, status, event_date, event_end_date, category")
      .eq("id", args.offerId)
      .maybeSingle();
    offer = data ?? null;
  }
  const offerSellable = offer ? isOfferSellable(offer) : false;

  const templates: PickerTemplate[] = stored.map((t) => {
    const reason = templateBlockReason(t, {
      topic: args.topic,
      language: t.language,
      offerSellable,
      offerCategory: offer?.category ?? null,
    });
    return {
      id: t.id,
      name: t.name,
      language: t.language,
      status: t.status,
      category: t.category,
      body_text: t.body_text,
      header: t.header,
      footer_text: t.footer_text,
      buttons: t.buttons,
      variable_count: t.variable_count,
      variable_schema: t.variable_schema,
      is_default: t.is_default,
      requires_active_offer: t.requires_active_offer,
      purpose: t.purpose,
      topics: t.topics,
      last_checked_at: t.last_checked_at,
      usable: reason === null,
      block_reason_he: reason,
      suggested_params: autofillParams(t, {
        firstName: (contact as any)?.first_name ?? (contact as any)?.full_name ?? null,
        contactName: (contact as any)?.full_name ?? null,
        offerTitle: offer?.title ?? null,
        offerUrl: offer?.offer_url ?? null,
        offerDate: offer?.event_date ?? null,
      }),
    };
  });

  const synced_at =
    stored.map((t) => t.last_checked_at).filter(Boolean).sort().slice(-1)[0] ?? null;
  return { session_window: window, templates, synced_at };
}