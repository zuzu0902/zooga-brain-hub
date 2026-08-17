/**
 * ACTIVE OFFER LOCK (PURE).
 *
 * The offer a conversation is currently about, persisted on the contact so it
 * survives across text and voice turns. It changes only when the customer
 * explicitly asks about another destination/product, or when the offer stops
 * being sellable.
 */
export const ACTIVE_OFFER_KEY = "active_offer";

export type ActiveOffer = {
  offer_id: string;
  title: string | null;
  set_at: string;
  reason: string;
};

export function activeOfferFrom(contact: any): ActiveOffer | null {
  const dyn = (contact?.dynamic_profile_fields ?? {}) as Record<string, any>;
  const v = dyn[ACTIVE_OFFER_KEY];
  if (!v || typeof v !== "object" || typeof v.offer_id !== "string") return null;
  return {
    offer_id: v.offer_id,
    title: typeof v.title === "string" ? v.title : null,
    set_at: String(v.set_at ?? ""),
    reason: String(v.reason ?? "unknown"),
  };
}

export function withActiveOffer(
  dyn: Record<string, any>,
  args: { offerId: string | null; title?: string | null; reason: string; now?: Date },
): Record<string, any> {
  const next = { ...(dyn ?? {}) };
  if (!args.offerId) {
    delete next[ACTIVE_OFFER_KEY];
    return next;
  }
  const prev = next[ACTIVE_OFFER_KEY];
  if (prev && typeof prev === "object" && prev.offer_id === args.offerId) return next; // idempotent
  next[ACTIVE_OFFER_KEY] = {
    offer_id: args.offerId,
    title: args.title ?? null,
    set_at: (args.now ?? new Date()).toISOString(),
    reason: args.reason,
  } satisfies ActiveOffer;
  return next;
}