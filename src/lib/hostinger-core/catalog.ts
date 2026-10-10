/** Browser-safe catalog helpers: Tamar eligibility, filters, form validation. */
import { CoreApiError, type CoreCatalogInput, type CatalogLifecycle, type CoreCatalogSuggestion } from "./client";

export type CatalogFilter = "all" | "active" | "draft" | "archived" | "needs_link" | "past_date";

export function lifecycleOf(item: Record<string, any>): CatalogLifecycle {
  const s = String(item.lifecycle_status ?? item.status ?? "draft");
  return s === "active" || s === "archived" ? s : "draft";
}
export function isHttpsUrl(v: unknown): boolean {
  if (typeof v !== "string" || !v.trim()) return false;
  try { return new URL(v.trim()).protocol === "https:"; } catch { return false; }
}
function endOf(item: Record<string, any>): Date | null {
  const raw = item.event_end_date || item.event_date;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
export function isPast(item: Record<string, any>, now = new Date()): boolean {
  const d = endOf(item);
  return !!d && d.getTime() < now.getTime();
}

export type Eligibility = { ready: boolean; reasons: string[] };
export function tamarEligibility(item: Record<string, any>, now = new Date()): Eligibility {
  const reasons: string[] = [];
  if (lifecycleOf(item) !== "active") reasons.push("הפריט אינו פעיל");
  if (item.sellable !== true) reasons.push("לא מסומן כזמין למכירה");
  if (!isHttpsUrl(item.url)) reasons.push("חסר קישור HTTPS תקין");
  if (!endOf(item)) reasons.push("חסר תאריך ידוע");
  else if (isPast(item, now)) reasons.push("התאריך עבר");
  return { ready: reasons.length === 0, reasons };
}

export function matchesFilter(item: Record<string, any>, f: CatalogFilter, now = new Date()): boolean {
  switch (f) {
    case "all": return true;
    case "active": case "draft": case "archived": return lifecycleOf(item) === f;
    case "needs_link": return !isHttpsUrl(item.url);
    case "past_date": return isPast(item, now);
  }
}

export type CatalogForm = {
  title: string; category: string; lifecycle_status: CatalogLifecycle; url: string; description: string; event_knowledge: string;
  event_date: string; event_end_date: string; price: string; currency: string; sellable: boolean;
};
export function emptyForm(): CatalogForm {
  return { title: "", category: "", lifecycle_status: "draft", url: "", description: "", event_knowledge: "", event_date: "", event_end_date: "", price: "", currency: "ILS", sellable: false };
}
const toLocal = (v: unknown) => { if (!v) return ""; const d = new Date(String(v)); return isNaN(d.getTime()) ? "" : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export function formFromItem(i: Record<string, any>): CatalogForm {
  return { title: i.title ?? "", category: i.category ?? "", lifecycle_status: lifecycleOf(i), url: i.url ?? "", description: i.description ?? "", event_knowledge: typeof i.event_knowledge === "string" ? i.event_knowledge : "",
    event_date: toLocal(i.event_date), event_end_date: toLocal(i.event_end_date), price: typeof i.price === "number" ? String(i.price) : "", currency: i.currency || "ILS", sellable: i.sellable === true };
}

/** Preserve any existing ISO currency instead of replacing it with a default. */
export function catalogCurrencyOptions(current: string): { code: string; label: string }[] {
  const options = [
    { code: "ILS", label: "₪ (ILS)" },
    { code: "EUR", label: "אירו (EUR)" },
    { code: "USD", label: "דולר אמריקאי (USD)" },
  ];
  if (current && !options.some(option => option.code === current)) options.push({ code: current, label: current });
  return options;
}

/** Validate and convert a form into a Core request body. Returns errors (Hebrew) or body. */
export function formToInput(f: CatalogForm): { errors: string[]; body?: CoreCatalogInput & { title: string } } {
  const errors: string[] = [];
  const title = f.title.trim();
  if (!title) errors.push("יש להזין שם");
  const url = f.url.trim();
  if (url && !isHttpsUrl(url)) errors.push("הקישור חייב להתחיל ב-https://");
  let price: number | null = null;
  if (f.price.trim()) { price = Number(f.price); if (!Number.isFinite(price) || price < 0) errors.push("מחיר חייב להיות מספר אי-שלילי"); }
  const currency = f.currency.trim().toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) errors.push("מטבע חייב להיות קוד בן 3 אותיות");
  const iso = (v: string) => (v ? new Date(v).toISOString() : null);
  const start = iso(f.event_date), end = iso(f.event_end_date);
  if (start && end && end < start) errors.push("תאריך סיום לפני תאריך התחלה");
  if (errors.length) return { errors };
  return { errors, body: { title, category: f.category.trim() || null, lifecycle_status: f.lifecycle_status, url: url || null,
    description: f.description.trim() || null, event_knowledge: f.event_knowledge.trim() || null, event_date: start, event_end_date: end, price, currency: currency || null, sellable: f.sellable } };
}

/** Fill only empty form fields from a Core learn suggestion. Never overwrites operator input. */
export function applyCatalogSuggestion(f: CatalogForm, s: CoreCatalogSuggestion): { form: CatalogForm; filled: number } {
  let filled = 0;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const fill = (cur: string, v: string) => (!cur.trim() && v ? (filled++, v) : cur);
  const price = typeof s.price === "number" && Number.isFinite(s.price) && s.price >= 0 ? String(s.price) : "";
  const cur = str(s.currency).toUpperCase();
  const form: CatalogForm = { ...f,
    title: fill(f.title, str(s.title)), category: fill(f.category, str(s.category)), description: fill(f.description, str(s.description)),
    event_knowledge: fill(f.event_knowledge, str(s.event_knowledge)),
    event_date: fill(f.event_date, toLocal(s.event_date)), event_end_date: fill(f.event_end_date, toLocal(s.event_end_date)),
    price: fill(f.price, price),
    currency: !f.price.trim() && price && /^[A-Z]{3}$/.test(cur) ? cur : f.currency,
  };
  return { form, filled };
}

/** Core URL-learning failure codes → concise Hebrew operator feedback. */
const LEARN_ERROR_MESSAGES: Record<string, string> = {
  invalid_url: "הקישור אינו כתובת תקינה — הזינו קישור https מלא",
  unsafe_url: "הקישור אינו מאושר לניתוח — Core חסם אותו",
  page_fetch_failed: "לא ניתן לפתוח את הדף — בדקו שהקישור פעיל וציבורי",
  unsupported_content_type: "סוג תוכן זה אינו נתמך לניתוח — Core קורא דפי HTML בלבד",
  page_too_large: "הדף גדול מכדי לנתחו — נסו קישor לעמוד קצר יותר",
  page_timeout: "ניתוח הדף נמשך יותר מדי זמן — נסו שוב",
  too_many_redirects: "הקישור עובר יותר מדי הפניות — הזינו קישור ישיר לעמוד",
  event_learning_failed: "המידע לא נלמד מהדף — מלאו את הפרטים ידנית",
};

/** Hebrew message for a Core learn failure; Core's own code wins over the status fallback. */
export function catalogLearnErrorText(e: unknown): string {
  if (!(e instanceof CoreApiError)) return "הניתוח נכשל, נסו שוב";
  const known = LEARN_ERROR_MESSAGES[e.code];
  if (known) return known;
  if (e.status === 401 || e.status === 403) return "אין הרשאה לניתוח הקישור";
  if (e.status === 404) return "שירות הלמידה עדיין לא זמין ב-Core";
  if (e.status === 400 || e.status === 422) return "Core דחה את הקישור — בדקו שהוא https ציבורי";
  return "הניתוח ב-Core נכשל, נסו שוב";
}
