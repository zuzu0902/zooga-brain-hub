/**
 * SINGLE SOURCE OF TRUTH for "can this offer be sold / shown to a customer".
 *
 * An offer is sellable when, and only when:
 *   status === 'active'  AND  event_date present  AND  event_end_date present
 *   AND event_end_date >= now
 *
 * The same rule exists in the DB as the `offers_sellable` view (authoritative,
 * evaluated per query — no cron and no screen-open needed for an event to
 * become "past"). This module mirrors it for client-side filtering and
 * validation so both layers can never drift.
 */

export type OfferDateShape = {
  status?: string | null;
  event_date?: string | null;
  event_end_date?: string | null;
};

/** Table/view name to read from whenever an offer may be shown to a customer. */
export const SELLABLE_SOURCE = "offers_sellable" as const;

export function isOfferSellable(o: OfferDateShape | null | undefined, now: Date = new Date()): boolean {
  if (!o) return false;
  if (o.status !== "active") return false;
  if (!o.event_date || !o.event_end_date) return false;
  const end = new Date(o.event_end_date);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() >= now.getTime();
}

export function needsDateReview(o: OfferDateShape | null | undefined): boolean {
  if (!o) return false;
  return !o.event_date || !o.event_end_date;
}

export function isPastOffer(o: OfferDateShape | null | undefined, now: Date = new Date()): boolean {
  if (!o?.event_end_date) return false;
  const end = new Date(o.event_end_date);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < now.getTime();
}

export type OfferBucket = "active" | "needs_date_review" | "past";

export function offerBucket(o: OfferDateShape, now: Date = new Date()): OfferBucket {
  if (needsDateReview(o)) return "needs_date_review";
  if (isPastOffer(o, now)) return "past";
  return "active";
}

/** UI/server-side date validation. Returns an error message or null. */
export function validateOfferDates(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  if (!start) return "תאריך התחלה הוא שדה חובה";
  if (!end) return "תאריך סיום הוא שדה חובה";
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime())) return "תאריך התחלה לא תקין";
  if (Number.isNaN(e.getTime())) return "תאריך סיום לא תקין";
  if (e.getTime() < s.getTime()) return "תאריך הסיום חייב להיות אחרי או שווה לתאריך ההתחלה";
  return null;
}

/** Reactivation guard: an offer may return to 'active' only with future dates. */
export function validateReactivation(
  start: string | null | undefined,
  end: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const base = validateOfferDates(start, end);
  if (base) return base;
  if (new Date(end!).getTime() < now.getTime()) return "לא ניתן להחזיר לפעיל אירוע שתאריך הסיום שלו עבר";
  return null;
}
