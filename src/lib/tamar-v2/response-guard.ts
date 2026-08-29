/**
 * TAMAR V2 — FINAL SEMANTIC RESPONSE GUARD (PURE, no I/O).
 *
 * Runs on the composed response BEFORE send. It answers exactly one question:
 * does the text talk about an offer the selected action is NOT allowed to
 * talk about?
 *
 * Authorization is built from the SELECTED offers themselves — their
 * canonical title, destination aliases, verified URL and grounded facts. An
 * allowed London answer, including every London fact, is never leakage.
 * Word overlap with another catalog item is not leakage either: a violation
 * needs a verified URL of a banned offer, its full title, or a token that is
 * distinctive to that banned offer alone and absent from the allowed
 * grounding corpus.
 *
 * The guard NEVER repairs by appending text and NEVER deletes lines from a
 * coherent answer. Recovery is: one regeneration inside the same selected
 * action, then a COMPLETE deterministic grounded answer built from the
 * allowed offer facts.
 */
import type { ResponseAction } from "./response-orchestrator";

export type GuardCatalogEntry = {
  id: string;
  title: string;
  url?: string | null;
  /** destination aliases / matching tags of this offer */
  aliases?: string[] | null;
  /** grounded fact text belonging to this offer (values only) */
  facts?: string[] | null;
};

export type GuardResult = {
  ok: boolean;
  /** offer ids whose mention is not allowed by the selected action */
  violations: string[];
  reason_codes: string[];
};

/**
 * Generic Hebrew travel/commerce vocabulary. These words are shared by every
 * catalogue item and can never prove that a specific offer was mentioned.
 */
const STOPWORDS = new Set([
  "טיול",
  "טיולים",
  "אירוע",
  "אירועים",
  "חופשה",
  "הטיול",
  "קלאסי",
  "הקלאסי",
  "לבני",
  "פלוס",
  "זוגה",
  "מיוחד",
  "חדש",
  "חדשה",
  "מלון",
  "מלונות",
  "טיסה",
  "טיסות",
  "לילות",
  "לילה",
  "ימים",
  "מחיר",
  "מחירים",
  "תשלום",
  "יתרה",
  "מקדמה",
  "הרשמה",
  "כולל",
  "כוללת",
  "כלול",
  "ארוחות",
  "ארוחה",
  "חדר",
  "חדרים",
  "יחיד",
  "זוגי",
  "קבוצה",
  "קבוצתי",
  "מדריך",
  "סיור",
  "סיורים",
  "יעד",
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
]);

/** Strip Hebrew attached prefixes so "לוייטנאם" matches "וייטנאם". */
function stripPrefix(token: string): string {
  return token.replace(/^(ול|וב|ומ|כשה|שה|וה|ל|ב|מ|ה|ו|ש|כ)/, "");
}

function tokens(text: string): string[] {
  return String(text ?? "")
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => stripPrefix(t.trim()))
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/** Distinctive tokens of an offer title (destination-like words). */
export function offerSignals(title: string): string[] {
  return Array.from(new Set(tokens(title)));
}

/** Everything the allowed offers legitimately let the answer say. */
export function allowedVocabulary(entries: GuardCatalogEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    for (const t of tokens(e.title)) out.add(t);
    for (const a of e.aliases ?? []) for (const t of tokens(a)) out.add(t);
    for (const f of e.facts ?? []) for (const t of tokens(f)) out.add(t);
  }
  return out;
}

/** Tokens that identify exactly ONE catalog offer (proper-noun-like). */
function distinctiveSignals(entry: GuardCatalogEntry, catalog: GuardCatalogEntry[]): string[] {
  const own = new Set([...offerSignals(entry.title), ...((entry.aliases ?? []).flatMap((a) => tokens(a)))]);
  const others = catalog.filter((o) => String(o.id) !== String(entry.id));
  return Array.from(own).filter(
    (s) => !others.some((o) => offerSignals(o.title).includes(s) || (o.aliases ?? []).some((a) => tokens(a).includes(s))),
  );
}

export function guardResponse(args: {
  text: string;
  action: ResponseAction;
  /** offer ids the selected action is allowed to talk about */
  allowedOfferIds: string[];
  catalog: GuardCatalogEntry[];
}): GuardResult {
  const text = String(args.text ?? "");
  if (!text.trim()) return { ok: false, violations: [], reason_codes: ["guard_empty_response"] };

  // A recommendation action is allowed to name several catalog offers.
  if (args.action === "recommend_products") {
    return { ok: true, violations: [], reason_codes: ["guard_recommend_allowed"] };
  }

  const allowed = new Set(args.allowedOfferIds.filter(Boolean).map(String));
  const allowedEntries = args.catalog.filter((o) => allowed.has(String(o.id)));
  const allowedWords = allowedVocabulary(allowedEntries);
  const allowedUrls = allowedEntries.map((o) => String(o.url ?? "")).filter(Boolean);
  const bodyTokens = new Set(tokens(text));
  const violations: string[] = [];

  for (const offer of args.catalog) {
    const id = String(offer.id);
    if (allowed.has(id)) continue;
    const url = String(offer.url ?? "");
    const urlLeak = !!url && text.includes(url) && !allowedUrls.some((u) => u === url);
    const title = String(offer.title ?? "").trim();
    const titleLeak = title.length >= 4 && text.includes(title);
    const signalLeak = distinctiveSignals(offer, args.catalog)
      .filter((s) => !allowedWords.has(s))
      .some((s) => bodyTokens.has(s));
    if (urlLeak || titleLeak || signalLeak) violations.push(id);
  }

  return {
    ok: violations.length === 0,
    violations,
    reason_codes: violations.length ? [`guard_offer_leakage_${violations.length}`] : ["guard_clean"],
  };
}

/**
 * COMPLETE deterministic grounded answer, built only from the allowed offer.
 * It always starts with an explicit subject (the offer title), so it can
 * never produce a dangling "הוא כולל…" fragment.
 */
export function buildDeterministicOfferAnswer(offer: {
  title?: string | null;
  url?: string | null;
  facts?: Array<{ label: string; value: string }> | null;
}): string | null {
  const title = String(offer.title ?? "").trim();
  if (!title) return null;
  const facts = (offer.facts ?? []).filter((f) => f && String(f.value ?? "").trim()).slice(0, 6);
  const lines = [`לגבי ${title}:`];
  for (const f of facts) lines.push(`• ${f.label}: ${f.value}`);
  if (!facts.length) {
    lines.push("אלה הפרטים שיש לי כרגע. מה בדיוק חשוב לך לדעת עליו?");
  } else {
    lines.push("אם חסר לך פרט נוסף — תגיד/י לי מה בדיוק, ואבדוק.");
  }
  const url = String(offer.url ?? "").trim();
  if (url) lines.push(url);
  return lines.join("\n");
}
