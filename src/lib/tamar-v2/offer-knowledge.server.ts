/**
 * TAMAR V2 — loading the full structured offer knowledge and the per-contact
 * link-delivery ledger. All policy lives in ./offer-knowledge (pure).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { OfferKnowledge, PendingProductHandoff } from "./offer-knowledge";

const COLUMNS =
  "id,title,offer_url,category,status,event_date,event_end_date,ai_summary,description," +
  "grounded_facts,faq_bundle,objection_notes,matching_tags,escalation_boundary," +
  "itinerary_summary,included,not_included,rooming_policy,pricing_status," +
  "base_price_per_person,single_supplement,couple_price,price_basis,currency,nights,flights_included";

function toKnowledge(o: any): OfferKnowledge {
  return {
    id: o.id,
    title: o.title ?? "",
    offer_url: o.offer_url ?? null,
    category: o.category ?? null,
    status: o.status ?? null,
    event_date: o.event_date ?? null,
    event_end_date: o.event_end_date ?? null,
    ai_summary: o.ai_summary ?? null,
    description: o.description ?? null,
    grounded_facts: o.grounded_facts ?? null,
    faq_bundle: Array.isArray(o.faq_bundle) ? o.faq_bundle : null,
    objection_notes: Array.isArray(o.objection_notes) ? o.objection_notes : null,
    matching_tags: Array.isArray(o.matching_tags) ? o.matching_tags : null,
    escalation_boundary: o.escalation_boundary ?? null,
    itinerary_summary: o.itinerary_summary ?? null,
    included: Array.isArray(o.included) ? o.included : null,
    not_included: Array.isArray(o.not_included) ? o.not_included : null,
    rooming_policy: o.rooming_policy ?? null,
    pricing_status: o.pricing_status ?? null,
    base_price_per_person: o.base_price_per_person ?? null,
    single_supplement: o.single_supplement ?? null,
    couple_price: o.couple_price ?? null,
    price_basis: o.price_basis ?? null,
    currency: o.currency ?? null,
    nights: o.nights ?? null,
    flights_included: o.flights_included ?? null,
  };
}

/**
 * Candidates for RESOLUTION only (includes past / non-sellable offers, which
 * may be discussed for information but never marketed).
 */
export async function loadOfferKnowledgeCandidates(limit = 40): Promise<OfferKnowledge[]> {
  const { data } = await supabaseAdmin
    .from("offers")
    .select(COLUMNS)
    .order("event_date", { ascending: false })
    .limit(limit);
  return ((data as any[]) ?? []).map(toKnowledge);
}

export async function loadOfferKnowledgeById(id: string): Promise<OfferKnowledge | null> {
  const { data } = await supabaseAdmin.from("offers").select(COLUMNS).eq("id", id).maybeSingle();
  return data ? toKnowledge(data) : null;
}

const LEDGER_KEY = "v2_offer_links_sent";
const LAST_OFFER_KEY = "v2_last_offer_id";

export function sentOfferIdsFrom(contact: any): string[] {
  const dyn = (contact?.dynamic_profile_fields ?? {}) as Record<string, any>;
  const raw = dyn[LEDGER_KEY];
  return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
}

export function lastOfferIdFrom(contact: any): string | null {
  const dyn = (contact?.dynamic_profile_fields ?? {}) as Record<string, any>;
  const v = dyn[LAST_OFFER_KEY];
  return typeof v === "string" ? v : null;
}

/** Idempotent: recording the same offer twice never duplicates the ledger. */
export function withOfferLedger(
  dyn: Record<string, any>,
  args: { offerId: string | null; linkSent: boolean },
): Record<string, any> {
  const next = { ...dyn };
  if (args.offerId) next[LAST_OFFER_KEY] = args.offerId;
  if (args.offerId && args.linkSent) {
    const list = Array.isArray(next[LEDGER_KEY]) ? [...next[LEDGER_KEY]] : [];
    if (!list.includes(args.offerId)) list.push(args.offerId);
    next[LEDGER_KEY] = list.slice(-50);
  }
  return next;
}

export { LEDGER_KEY as OFFER_LINK_LEDGER_KEY, LAST_OFFER_KEY as OFFER_LAST_ID_KEY };

/* ------------------------------------------------------------------ */
/* Durable pending product handoff                                     */
/* ------------------------------------------------------------------ */

const PENDING_KEY = "v2_pending_product_handoff";
const GROUNDED_OFFER_KEY = "v2_last_grounded_offer_id";

export function pendingProductHandoffFrom(contact: any): PendingProductHandoff | null {
  const dyn = (contact?.dynamic_profile_fields ?? {}) as Record<string, any>;
  const p = dyn[PENDING_KEY];
  if (!p || typeof p !== "object" || typeof p.question !== "string") return null;
  return {
    offer_id: p.offer_id ?? null,
    offer_title: p.offer_title ?? null,
    question: p.question,
    at: String(p.at ?? ""),
  };
}

export function lastGroundedOfferIdFrom(contact: any): string | null {
  const dyn = (contact?.dynamic_profile_fields ?? {}) as Record<string, any>;
  const v = dyn[GROUNDED_OFFER_KEY];
  return typeof v === "string" ? v : null;
}

/** Set / clear the pending offer and remember the last GROUNDED offer. */
export function withPendingHandoff(
  dyn: Record<string, any>,
  args: { pending?: PendingProductHandoff | null; clear?: boolean; groundedOfferId?: string | null },
): Record<string, any> {
  const next = { ...dyn };
  if (args.clear) delete next[PENDING_KEY];
  else if (args.pending) next[PENDING_KEY] = args.pending;
  if (args.groundedOfferId) next[GROUNDED_OFFER_KEY] = args.groundedOfferId;
  return next;
}

/**
 * Commit the link ledger ONLY after a successful outbound send. A failed send
 * leaves the offer unmarked, so the link stays retryable on the next turn.
 */
export async function commitOfferLinkSent(contactId: string, offerId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("dynamic_profile_fields")
    .eq("id", contactId)
    .maybeSingle();
  const dyn = ((data as any)?.dynamic_profile_fields ?? {}) as Record<string, any>;
  const next = withOfferLedger(dyn, { offerId, linkSent: true });
  await supabaseAdmin.from("contacts").update({ dynamic_profile_fields: next } as any).eq("id", contactId);
}

export { PENDING_KEY as PENDING_PRODUCT_HANDOFF_KEY, GROUNDED_OFFER_KEY as LAST_GROUNDED_OFFER_KEY };