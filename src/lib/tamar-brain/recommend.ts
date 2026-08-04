/**
 * TAMAR BRAIN v1 — offer ranking (pure).
 * Input MUST already come from offers_sellable: expired / date-less /
 * non-sellable offers never reach this function.
 */

export type RankedOffer = {
  id: string;
  title: string;
  score: number;
  why_this: string;
  reason_codes: string[];
};

export type RankInput = {
  age?: number | null;
  region?: string | null;
  city?: string | null;
  interests?: string[] | null;
  budget_sensitivity?: string | null;
  preferred_trip_style?: string | null;
  goal_text?: string | null;
};

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase();
}

export function rankOffers(offers: any[], input: RankInput, limit = 3): RankedOffer[] {
  const list = Array.isArray(offers) ? offers : [];
  const interests = (input.interests ?? []).map(norm).filter(Boolean);
  const goal = norm(input.goal_text);

  const scored = list.map((o) => {
    let score = 10; // baseline: it is sellable
    const codes: string[] = ["sellable"];
    const why: string[] = [];

    // Age window
    if (input.age != null) {
      const min = o.target_min_age ?? null;
      const max = o.target_max_age ?? null;
      if ((min == null || input.age >= min) && (max == null || input.age <= max)) {
        score += 20;
        codes.push("age_fit");
        if (min != null || max != null) why.push("מתאים לטווח הגילאים שלך");
      } else {
        score -= 25;
        codes.push("age_mismatch");
      }
    }

    // Region
    const region = norm(input.region || input.city);
    if (region && norm(o.target_region) && norm(o.target_region).includes(region)) {
      score += 10;
      codes.push("region_fit");
      why.push("יוצא מהאזור שלך");
    }

    // Interests / tags
    const tags = [...(o.target_interests ?? []), ...(o.matching_tags ?? [])].map(norm);
    const hits = interests.filter((i) => tags.some((t) => t.includes(i) || i.includes(t)));
    if (hits.length) {
      score += Math.min(30, hits.length * 12);
      codes.push("interest_fit");
      why.push(`קרוב למה שסיפרת שמעניין אותך (${hits.slice(0, 2).join(", ")})`);
    }

    // Stated goal keywords against title/summary
    if (goal) {
      const hay = `${norm(o.title)} ${norm(o.ai_summary)} ${norm(o.description)}`;
      const words = goal.split(/\s+/).filter((w) => w.length > 3);
      const goalHits = words.filter((w) => hay.includes(w));
      if (goalHits.length) {
        score += Math.min(20, goalHits.length * 8);
        codes.push("goal_match");
      }
    }

    // Budget sensitivity vs price transparency
    if (input.budget_sensitivity === "high" && o.pricing_status === "published") {
      score += 6;
      codes.push("price_transparent");
    }

    // Availability: nearer dated trips first (soft)
    const when = o.event_date ? new Date(o.event_date).getTime() : null;
    if (when && Number.isFinite(when)) {
      const days = (when - Date.now()) / 86400000;
      if (days > 0 && days < 120) {
        score += 8;
        codes.push("near_term");
        why.push("יוצא בקרוב");
      }
    }

    return {
      id: o.id,
      title: o.title,
      score,
      why_this: why.length ? why.join(", ") : "מתאים לפרופיל הכללי שלך בקהילה",
      reason_codes: codes,
    } satisfies RankedOffer;
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Should we recommend at all? If nothing scores well we send the site link
 * instead of forcing an irrelevant trip.
 */
export function hasRelevantMatch(ranked: RankedOffer[]): boolean {
  return ranked.length > 0 && (ranked[0]?.score ?? 0) >= 30;
}

export const ZOOGA_SITE_URL = "https://www.zooga.co.il";