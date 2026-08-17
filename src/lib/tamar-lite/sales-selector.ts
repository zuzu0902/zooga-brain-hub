/**
 * TAMAR LITE — pure sales selector. Filters + ranks existing offers.
 * Never sends, never writes. Sellability reuses the single source of truth
 * in `@/lib/offer-sellable` (mirror of the `offers_sellable` view).
 */
import { isOfferSellable } from "@/lib/offer-sellable";

export type LiteOffer = {
  id: string;
  title?: string | null;
  status?: string | null;
  event_date?: string | null;
  event_end_date?: string | null;
  landing_page_url?: string | null;
  purchase_url?: string | null;
  sold_out?: boolean | null;
  capacity_left?: number | null;
  archived_at?: string | null;
  category?: string | null;
  region?: string | null;
  is_abroad?: boolean | null;
  tags?: string[] | null;
};

export type LiteBuyerProfile = {
  interests: string[];
  region: string | null;
  prefers_abroad: boolean | null;
  style: string | null;
  /** offer ids already presented to this contact */
  previously_offered: string[];
  /** a genuinely new reason allows re-offering (e.g. new date, new interest) */
  new_reason_offer_ids?: string[];
};

export type LiteCandidate = {
  offer_id: string;
  score: number;
  match_facts: string[];
};

function hasLink(o: LiteOffer): boolean {
  return !!(o.landing_page_url || o.purchase_url);
}

export function isLitePurchasable(o: LiteOffer, now: Date = new Date()): boolean {
  if (!o?.id) return false;
  if (o.archived_at) return false;
  if (o.sold_out) return false;
  if (typeof o.capacity_left === "number" && o.capacity_left <= 0) return false;
  if (!hasLink(o)) return false;
  return isOfferSellable(o, now);
}

export function selectLiteOffers(
  offers: LiteOffer[],
  profile: LiteBuyerProfile,
  now: Date = new Date(),
): LiteCandidate[] {
  const repeatAllowed = new Set(profile.new_reason_offer_ids ?? []);
  const seen = new Set(profile.previously_offered ?? []);
  const candidates: LiteCandidate[] = [];

  for (const o of offers ?? []) {
    if (!isLitePurchasable(o, now)) continue;
    if (seen.has(o.id) && !repeatAllowed.has(o.id)) continue;

    const facts: string[] = [];
    let score = 1;
    const tags = (o.tags ?? []).map((t) => String(t).toLowerCase());
    for (const interest of profile.interests ?? []) {
      const i = String(interest).toLowerCase();
      if (!i) continue;
      if (tags.includes(i) || String(o.category ?? "").toLowerCase() === i) {
        score += 3;
        facts.push(`interest:${interest}`);
      }
    }
    if (profile.prefers_abroad !== null && profile.prefers_abroad !== undefined) {
      if (!!o.is_abroad === profile.prefers_abroad) {
        score += 2;
        facts.push(profile.prefers_abroad ? "abroad" : "domestic");
      }
    }
    if (profile.region && o.region && String(o.region) === String(profile.region)) {
      score += 2;
      facts.push(`region:${profile.region}`);
    }
    if (profile.style && tags.includes(String(profile.style).toLowerCase())) {
      score += 1;
      facts.push(`style:${profile.style}`);
    }
    if (repeatAllowed.has(o.id)) facts.push("new_reason");
    // sooner events first among equal scores
    candidates.push({ offer_id: o.id, score, match_facts: facts });
  }

  const startTime = (id: string) => {
    const o = offers.find((x) => x.id === id);
    const t = o?.event_date ? new Date(o.event_date).getTime() : Number.MAX_SAFE_INTEGER;
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };

  return candidates
    .sort((a, b) => b.score - a.score || startTime(a.offer_id) - startTime(b.offer_id))
    .slice(0, 3);
}