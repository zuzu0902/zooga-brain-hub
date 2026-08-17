/**
 * CANONICAL PRODUCT CATALOG — normalization (PURE, no I/O).
 *
 * Every Tamar engine (live engine, V2, Lite) derives its product knowledge
 * from the same normalized entry built here out of the EXISTING offer fields
 * (title, matching_tags, ai_summary, grounded_facts, faq_bundle,
 * itinerary_summary, extraction_raw, dates). No AI call is ever made per
 * customer message: the entry is deterministic and cheap.
 */

export type OfferRow = {
  id: string;
  title?: string | null;
  offer_url?: string | null;
  status?: string | null;
  category?: string | null;
  event_date?: string | null;
  event_end_date?: string | null;
  matching_tags?: string[] | null;
  ai_summary?: string | null;
  description?: string | null;
  itinerary_summary?: string | null;
  grounded_facts?: Record<string, unknown> | null;
  faq_bundle?: unknown;
  extraction_raw?: unknown;
  target_interests?: string[] | null;
  target_min_age?: number | null;
  target_max_age?: number | null;
  sold_out?: boolean | null;
  archived_at?: string | null;
  capacity_left?: number | null;
};

export type CatalogEntry = {
  id: string;
  title: string;
  url: string | null;
  category: string | null;
  event_date: string | null;
  event_end_date: string | null;
  /** canonical destination keys, e.g. ["vietnam","cambodia"] */
  destinations: string[];
  /** canonical holiday keys, e.g. ["hanukkah"] */
  holidays: string[];
  /** month numbers covered by the event window */
  months: number[];
  difficulty: string | null;
  audience: string[];
  sellable: boolean;
  source_hash: string;
  analyzed_at: string | null;
};

/* ------------------------------------------------------------------ */
/* Hebrew normalization                                                */
/* ------------------------------------------------------------------ */

const PREFIXES = ["ו", "ה", "ב", "ל", "כ", "מ", "ש"];

/** Collapse spelling variants: double-yud, alef, final letters, punctuation. */
export function normHe(input: unknown): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/יי/g, "י")
    .replace(/וו/g, "ו")
    .replace(/א/g, "")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ך/g, "כ")
    .replace(/ף/g, "פ")
    .replace(/ץ/g, "צ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip a single Hebrew clitic prefix (ב/ל/כ/מ/ה/ו/ש) from a word. */
export function stripPrefix(word: string): string {
  if (word.length < 3) return word;
  const first = word[0]!;
  if (PREFIXES.includes(first)) return word.slice(1);
  return word;
}

/** Tokens of a message, each also in its prefix-stripped form. */
export function tokenize(text: unknown): string[] {
  const words = normHe(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (const w of words) {
    out.add(w);
    const s = stripPrefix(w);
    if (s !== w) out.add(s);
  }
  return [...out];
}

/** Does the normalized haystack contain the term (prefix-tolerant)? */
export function containsTerm(haystackTokens: string[], term: string): boolean {
  const t = normHe(term);
  if (!t) return false;
  const parts = t.split(" ");
  if (parts.length === 1) return haystackTokens.includes(t) || haystackTokens.includes(stripPrefix(t));
  return parts.every((p) => haystackTokens.includes(p) || haystackTokens.includes(stripPrefix(p)));
}

/* ------------------------------------------------------------------ */
/* Vocabularies                                                        */
/* ------------------------------------------------------------------ */

export const DESTINATIONS: Record<string, string[]> = {
  vietnam: ["וייטנאם", "ויאטנם", "ויטנאם", "vietnam"],
  cambodia: ["קמבודיה", "cambodia", "אנגקור"],
  dubai: ["דובאי", "dubai", "אבו דאבי", "אמירויות"],
  london: ["לונדון", "london"],
  azerbaijan: ["אזרביגן", "אזרבייג'ן", "באקו", "azerbaijan", "baku"],
  japan: ["יפן", "japan"],
  thailand: ["תאילנד", "טאילנד", "thailand"],
  india: ["הודו", "india"],
  montenegro: ["מונטנגרו", "montenegro"],
  greece: ["יוון", "greece"],
  italy: ["איטליה", "italy"],
  georgia: ["גאורגיה", "גיאורגיה", "georgia"],
  albania: ["אלבניה", "albania"],
  cyprus: ["קפריסין", "cyprus"],
  portugal: ["פורטוגל", "portugal"],
  spain: ["ספרד", "spain"],
  morocco: ["מרוקו", "morocco"],
  israel_jaffa: ["יפו", "jaffa"],
};

export const HOLIDAYS: Record<string, string[]> = {
  hanukkah: ["חנוכה", "hanukkah", "chanukah"],
  sukkot: ["סוכות", "sukkot"],
  pesach: ["פסח", "passover"],
  rosh_hashana: ["ראש השנה", "ראש שנה"],
  yom_kippur: ["יום כיפור", "כיפור"],
  purim: ["פורים", "purim"],
  shavuot: ["שבועות"],
  christmas: ["חג מולד", "חג המולד", "christmas", "סילבסטר"],
};

/** Holiday windows used to DERIVE a holiday from event dates. */
export const HOLIDAY_WINDOWS: Array<{ key: string; from: string; to: string }> = [
  { key: "rosh_hashana", from: "2026-09-11", to: "2026-09-14" },
  { key: "yom_kippur", from: "2026-09-20", to: "2026-09-22" },
  { key: "sukkot", from: "2026-09-25", to: "2026-10-03" },
  { key: "hanukkah", from: "2026-12-04", to: "2026-12-12" },
  { key: "christmas", from: "2026-12-20", to: "2026-12-27" },
  { key: "purim", from: "2027-03-22", to: "2027-03-24" },
  { key: "pesach", from: "2027-04-21", to: "2027-04-28" },
];

export const MONTH_WORDS: Record<number, string[]> = {
  1: ["ינואר", "january"],
  2: ["פברואר", "february"],
  3: ["מרץ", "march"],
  4: ["אפריל", "april"],
  5: ["מאי", "may"],
  6: ["יוני", "june"],
  7: ["יולי", "july"],
  8: ["אוגוסט", "august"],
  9: ["ספטמבר", "september"],
  10: ["אוקטובר", "october"],
  11: ["נובמבר", "november"],
  12: ["דצמבר", "december"],
};

/* ------------------------------------------------------------------ */
/* Entry building                                                      */
/* ------------------------------------------------------------------ */

function textCorpus(o: OfferRow): string[] {
  const parts: unknown[] = [
    o.title,
    (o.matching_tags ?? []).join(" "),
    o.category,
    o.ai_summary,
    o.itinerary_summary,
    o.description,
    JSON.stringify(o.grounded_facts ?? {}),
  ];
  return tokenize(parts.filter(Boolean).join(" "));
}

/** Only title + tags decide the DESTINATION (summary text is too noisy). */
function destinationCorpus(o: OfferRow): string[] {
  return tokenize([o.title, (o.matching_tags ?? []).join(" ")].filter(Boolean).join(" "));
}

function monthsBetween(start: string | null | undefined, end: string | null | undefined): number[] {
  if (!start) return [];
  const s = new Date(start);
  const e = new Date(end ?? start);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return [];
  const out: number[] = [];
  const cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
  const last = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 1));
  while (cur.getTime() <= last.getTime() && out.length < 24) {
    out.push(cur.getUTCMonth() + 1);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return [...new Set(out)];
}

function holidaysFromDates(start?: string | null, end?: string | null): string[] {
  if (!start) return [];
  const s = new Date(start).getTime();
  const e = new Date(end ?? start).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return [];
  const out: string[] = [];
  for (const w of HOLIDAY_WINDOWS) {
    const wf = new Date(`${w.from}T00:00:00Z`).getTime();
    const wt = new Date(`${w.to}T23:59:59Z`).getTime();
    if (s <= wt && e >= wf) out.push(w.key);
  }
  return [...new Set(out)];
}

const DIFFICULTY_RE: Array<[string, RegExp]> = [
  ["easy", /(רמת קושי קלה|קלה|נגיש|ללא הליכות)/],
  ["moderate", /(רמת קושי בינונית|בינונית)/],
  ["hard", /(רמת קושי קשה|מאתגר|טרק)/],
];

const AUDIENCE_TERMS: Array<[string, string[]]> = [
  ["singles", ["סינגלים", "רווקים"]],
  ["couples", ["זוגות", "טיול זוגי"]],
  ["second_chapter", ["פרק ב"]],
  ["60plus", ["60 פלוס", "בני 60"]],
];

/** Stable, cheap content hash of the fields the catalog depends on. */
export function catalogSourceHash(o: OfferRow): string {
  const basis = JSON.stringify([
    o.title ?? "",
    o.status ?? "",
    o.event_date ?? "",
    o.event_end_date ?? "",
    o.matching_tags ?? [],
    o.offer_url ?? "",
    o.ai_summary ?? "",
    o.itinerary_summary ?? "",
  ]);
  let h1 = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h1 ^= basis.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return `c${h1.toString(16)}_${basis.length}`;
}

export function isSellableRow(o: OfferRow, now: Date = new Date()): boolean {
  if (!o?.id) return false;
  if (o.archived_at) return false;
  if (o.sold_out) return false;
  if (typeof o.capacity_left === "number" && o.capacity_left <= 0) return false;
  if (o.status !== "active") return false;
  if (!o.event_date || !o.event_end_date) return false;
  const end = new Date(o.event_end_date).getTime();
  return Number.isFinite(end) && end >= now.getTime();
}

export function buildCatalogEntry(o: OfferRow, now: Date = new Date()): CatalogEntry {
  const destTokens = destinationCorpus(o);
  const allTokens = textCorpus(o);

  const destinations: string[] = [];
  for (const [key, aliases] of Object.entries(DESTINATIONS)) {
    if (aliases.some((a) => containsTerm(destTokens, a))) destinations.push(key);
  }

  const holidays = new Set<string>(holidaysFromDates(o.event_date, o.event_end_date));
  for (const [key, aliases] of Object.entries(HOLIDAYS)) {
    if (aliases.some((a) => containsTerm(destTokens, a))) holidays.add(key);
  }

  const hayRaw = [o.title, (o.matching_tags ?? []).join(" "), o.ai_summary].filter(Boolean).join(" ");
  let difficulty: string | null = null;
  for (const [key, re] of DIFFICULTY_RE) {
    if (re.test(hayRaw)) {
      difficulty = key;
      break;
    }
  }
  const audience: string[] = [];
  for (const [key, terms] of AUDIENCE_TERMS) {
    if (terms.some((t) => containsTerm(allTokens, t))) audience.push(key);
  }

  return {
    id: o.id,
    title: String(o.title ?? ""),
    url: o.offer_url ?? null,
    category: o.category ?? null,
    event_date: o.event_date ?? null,
    event_end_date: o.event_end_date ?? null,
    destinations,
    holidays: [...holidays],
    months: monthsBetween(o.event_date, o.event_end_date),
    difficulty,
    audience,
    sellable: isSellableRow(o, now),
    source_hash: catalogSourceHash(o),
    analyzed_at: new Date().toISOString(),
  };
}

export function buildCatalog(rows: OfferRow[], now: Date = new Date()): CatalogEntry[] {
  return (rows ?? []).map((r) => buildCatalogEntry(r, now));
}