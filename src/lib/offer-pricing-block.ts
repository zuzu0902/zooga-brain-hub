/**
 * Renders the typed pricing_state block for Tamar's runtime prompt.
 * Source of truth: the new structured columns on offers
 * (pricing_status, base_price_per_person, single_supplement, couple_price,
 * price_basis, rooming_policy, included, not_included, itinerary_summary,
 * nights, flights_included).
 *
 * pricing_status controls Tamar's authority to quote:
 *   - published  → quote freely
 *   - partial    → quote what you have, escalate the gap
 *   - on_request → do not quote, route to a human
 *   - unpublished → do not quote
 */
export function buildPricingStateBlock(offer: any): string | null {
  if (!offer) return null;
  const status: string | null = offer.pricing_status ?? null;
  const currency: string = offer.currency || "ILS";
  const base = offer.base_price_per_person ?? null;
  const single = offer.single_supplement ?? null;
  const couple = offer.couple_price ?? null;
  const basis: string | null = offer.price_basis ?? null;
  const rooming: string | null = offer.rooming_policy ?? null;
  const included: string[] = Array.isArray(offer.included) ? offer.included : [];
  const notIncluded: string[] = Array.isArray(offer.not_included) ? offer.not_included : [];
  const nights = offer.nights ?? null;
  const flights = offer.flights_included;
  const itinerary: string | null = offer.itinerary_summary ?? null;

  const lines: string[] = ["## pricing_state"];

  switch (status) {
    case "published": {
      const bits: string[] = [];
      if (base != null) bits.push(`מחיר בסיס: ${base} ${currency} לאדם${basis === "per_person_double" ? " בחדר זוגי" : ""}`);
      if (single != null) bits.push(`תוספת ליחיד בחדר: ${single} ${currency}`);
      if (couple != null) bits.push(`מחיר לזוג: ${couple} ${currency}`);
      lines.push("מצב תמחור: PUBLISHED — מותר לציין את המחיר ישירות בלי להעביר לאדם.");
      if (bits.length) lines.push(bits.join(" • "));
      break;
    }
    case "partial": {
      lines.push("מצב תמחור: PARTIAL — מותר לציין רק את הפריטים שיש למטה. על כל פרט שחסר — אמרי בכנות שתבדקי או תפני לאיש מכירות.");
      if (base != null) lines.push(`מחיר בסיס ידוע: ${base} ${currency}`);
      if (single != null) lines.push(`תוספת ליחיד ידועה: ${single} ${currency}`);
      if (couple != null) lines.push(`מחיר זוג ידוע: ${couple} ${currency}`);
      break;
    }
    case "on_request":
      lines.push("מצב תמחור: ON_REQUEST — המחיר נקבע אישית. אל תנחשי מחיר; הציעי שיחה קצרה עם איש המכירות.");
      break;
    case "unpublished":
    case null:
    case undefined:
    default:
      lines.push("מצב תמחור: UNPUBLISHED — המחיר עדיין לא פורסם במערכת. אל תמציאי מחיר; הסבירי בכנות ותציעי שאיש מכירות יחזור עם פרטים.");
      break;
  }

  if (basis) lines.push(`בסיס תמחור: ${basis}`);
  if (rooming) lines.push(`מדיניות חדרים: ${rooming}`);
  if (nights != null) lines.push(`מספר לילות: ${nights}`);
  if (typeof flights === "boolean") lines.push(`טיסות כלולות: ${flights ? "כן" : "לא"}`);
  if (included.length) lines.push(`כלול במחיר: ${included.join(" • ")}`);
  if (notIncluded.length) lines.push(`לא כלול: ${notIncluded.join(" • ")}`);
  if (itinerary) lines.push(`מסלול בקצרה: ${itinerary}`);

  return lines.join("\n");
}

/**
 * URL gate — reject bare brand homepages as offer pages.
 * Returns an error message string when the URL is too generic to
 * possibly contain offer-specific pricing, or null when the URL is ok.
 */
export function validateOfferUrl(rawUrl: string): string | null {
  try {
    new URL(rawUrl);
  } catch {
    return "קישור לא תקין";
  }
  // NOTE: We intentionally do NOT reject bare-root URLs. Some sites
  // (e.g. zooga.co) keep all offer-specific facts — pricing, single
  // supplement, itinerary — on the root page. The AI extractor is
  // responsible for scoping facts to the current offer row.
  return null;
}