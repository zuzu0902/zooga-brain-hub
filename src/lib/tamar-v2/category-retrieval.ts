/**
 * TAMAR V2 — CANONICAL UNDERSTANDING + RETRIEVAL (PURE, no I/O).
 *
 * Production defect this repairs: the customer said "אני מחפש הרצאות" and the
 * runtime answered with Dubai / Vietnam trips, because "browse intent" was
 * routed to a generic recommendation composer that never filtered the
 * canonical inventory by the category the customer actually named. The
 * follow-up "על מה ההרצאות האלה?" then fell through to a generic intake
 * question.
 *
 * Contract:
 *   1. the CURRENT inbound message decides the category (text or normalized
 *      voice transcript — one path for both)
 *   2. a named category is a HARD retrieval constraint
 *   3. when category metadata is missing, the product's own canonical content
 *      (title / description / summary / tags / itinerary / structured fields)
 *      classifies it for this turn — nothing is invented
 *   4. no match => an explicit no-match answer; never an unrelated fallback
 *   5. the category is persisted as active conversational focus, so
 *      "על מה ההרצאות האלה?" resolves to the SAME set
 */

export const CATEGORY_RETRIEVAL_VERSION = "category.1";

export type ProductCategory =
  | "lecture"
  | "trip"
  | "event"
  | "workshop"
  | "party"
  | "membership"
  | "product";

export const CATEGORY_LABEL_HE: Record<ProductCategory, string> = {
  lecture: "הרצאות",
  trip: "טיולים",
  event: "אירועים",
  workshop: "סדנאות",
  party: "מסיבות",
  membership: "מנויים",
  product: "מוצרים",
};

/** Hebrew variants + inflections and the English equivalents. */
const CATEGORY_TERMS: Record<ProductCategory, RegExp> = {
  lecture: /(הרצא(?:ה|ות|ת|תי)|מרצ(?:ה|ים|ות)|webinar|lecture|talk)/i,
  trip: /(טיול(?:ים|י|ית)?|נסיע(?:ה|ות)|חופש(?:ה|ות)|מסע(?:ות)?|trip|tour|travel)/i,
  event: /(אירוע(?:ים|י)?|מפגש(?:ים|י)?|ערב(?:ים)?\s*(?:חברתי|זוגי|מיוחד)?|event|meetup)/i,
  workshop: /(סדנ(?:ה|אות|ת|אה)|workshop)/i,
  party: /(מסיב(?:ה|ות|ת)|ריקודים|party)/i,
  membership: /(מנוי(?:ים)?|חברות\s*במועדון|מועדון|membership)/i,
  product: /(מוצר(?:ים)?|product)/i,
};

/** Order matters: the most specific category wins a tie. */
const CATEGORY_ORDER: ProductCategory[] = [
  "lecture",
  "workshop",
  "party",
  "membership",
  "trip",
  "event",
  "product",
];

export type CategoryExtraction = {
  category: ProductCategory | null;
  confidence: number;
  matched_terms: string[];
  /** the customer named the category explicitly in THIS message */
  explicit: boolean;
};

/** Extract the product category named in the CURRENT inbound message. */
export function extractCategory(message: string): CategoryExtraction {
  const m = String(message ?? "");
  const matched: Array<{ c: ProductCategory; term: string }> = [];
  for (const c of CATEGORY_ORDER) {
    const hit = CATEGORY_TERMS[c].exec(m);
    if (hit) matched.push({ c, term: hit[0] });
  }
  if (!matched.length) return { category: null, confidence: 0, matched_terms: [], explicit: false };
  const first = matched[0]!;
  // A single unambiguous category term is high confidence; two competing
  // categories in one sentence lower it (the LLM may still explain).
  const confidence = matched.length === 1 ? 0.95 : 0.7;
  return {
    category: first.c,
    confidence,
    matched_terms: matched.map((x) => x.term),
    explicit: true,
  };
}

/** Anaphoric follow-up about a set already presented ("על מה ההרצאות האלה?"). */
const FOLLOWUP_RE = /(האלה|האלו|הללו|עליהם|עליהן|האלו\?|מה\s*יש\s*בהם|על\s*מה)/;

export function isCategoryFollowUp(message: string, focusCategory: ProductCategory | null): boolean {
  if (!focusCategory) return false;
  const m = String(message ?? "");
  if (!FOLLOWUP_RE.test(m)) return false;
  const other = CATEGORY_ORDER.find((c) => c !== focusCategory && CATEGORY_TERMS[c].test(m));
  if (other) return false; // explicit switch, not a follow-up
  return true;
}

/* ------------------------------------------------------------------ */
/* Inventory classification                                            */
/* ------------------------------------------------------------------ */

export type InventoryOffer = {
  id: string;
  title?: string | null;
  offer_url?: string | null;
  category?: string | null;
  description?: string | null;
  ai_summary?: string | null;
  matching_tags?: string[] | null;
  itinerary_summary?: string | null;
  nights?: number | null;
  flights_included?: boolean | null;
  [k: string]: unknown;
};

export type OfferClassification = {
  category: ProductCategory | null;
  /** "metadata" = structured category column, "content" = derived this turn */
  source: "metadata" | "content" | "unknown";
  confidence: number;
};

function contentBlob(o: InventoryOffer): string {
  return [
    o.title,
    o.description,
    o.ai_summary,
    o.itinerary_summary,
    ...((o.matching_tags ?? []) as string[]),
  ]
    .filter(Boolean)
    .join(" \n ");
}

/**
 * Classify one inventory record. The structured category column is trusted
 * first; when it is missing or unrecognised, the product's own canonical
 * content decides. Nothing is invented — no content signal => unknown.
 */
export function classifyOffer(o: InventoryOffer): OfferClassification {
  const meta = String(o.category ?? "").trim();
  if (meta) {
    for (const c of CATEGORY_ORDER) {
      if (CATEGORY_TERMS[c].test(meta) || meta.toLowerCase() === c) {
        return { category: c, source: "metadata", confidence: 0.95 };
      }
    }
  }
  const blob = contentBlob(o);
  for (const c of CATEGORY_ORDER) {
    if (CATEGORY_TERMS[c].test(blob)) return { category: c, source: "content", confidence: 0.75 };
  }
  // Structured travel fields are a real signal for a trip.
  if ((typeof o.nights === "number" && o.nights > 0) || o.flights_included === true) {
    return { category: "trip", source: "content", confidence: 0.6 };
  }
  return { category: null, source: "unknown", confidence: 0 };
}

export type RetrievalResult = {
  category: ProductCategory;
  offers: InventoryOffer[];
  candidate_offer_ids: string[];
  /** at least one match came from content, not from the category column */
  inventory_fallback_used: boolean;
  retrieval_constraints: string[];
  no_match_reason: string | null;
};

/** Hard-constrained retrieval over the canonical inventory. */
export function retrieveByCategory(args: {
  category: ProductCategory;
  offers: InventoryOffer[];
  limit?: number;
  /** restrict to this exact set (a follow-up about a presented set) */
  restrictToIds?: string[] | null;
}): RetrievalResult {
  const limit = Math.max(1, Math.min(6, args.limit ?? 3));
  const constraints = [`category:${args.category}`];
  let pool = args.offers ?? [];
  if (args.restrictToIds?.length) {
    const allow = new Set(args.restrictToIds.map(String));
    pool = pool.filter((o) => allow.has(String(o.id)));
    constraints.push(`restrict_ids:${args.restrictToIds.length}`);
  }
  const scored: Array<{ o: InventoryOffer; k: OfferClassification }> = [];
  for (const o of pool) {
    const k = classifyOffer(o);
    if (k.category === args.category) scored.push({ o, k });
  }
  scored.sort((a, b) => b.k.confidence - a.k.confidence);
  const picked = scored.slice(0, limit);
  return {
    category: args.category,
    offers: picked.map((x) => x.o),
    candidate_offer_ids: picked.map((x) => String(x.o.id)),
    inventory_fallback_used: picked.some((x) => x.k.source === "content"),
    retrieval_constraints: constraints,
    no_match_reason: picked.length
      ? null
      : pool.length
        ? "no_offer_in_category"
        : "empty_inventory",
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic Hebrew composition                                    */
/* ------------------------------------------------------------------ */

export function buildCategoryListText(r: RetrievalResult): string {
  const label = CATEGORY_LABEL_HE[r.category];
  const lines = r.offers.map((o) => {
    const why = o.ai_summary || o.description ? ` — ${String(o.ai_summary ?? o.description).slice(0, 140)}` : "";
    const link = o.offer_url ? `\n${o.offer_url}` : "";
    return `• ${String(o.title ?? "").trim()}${why}${link}`;
  });
  return `אלה ${label} שיש לנו כרגע:\n${lines.join("\n")}\n\nרוצה שאפרט על אחת מהן?`;
}

export function buildCategoryDetailText(r: RetrievalResult): string {
  const label = CATEGORY_LABEL_HE[r.category];
  const lines = r.offers.map((o) => {
    const body = String(o.ai_summary ?? o.description ?? "").trim();
    const link = o.offer_url ? `\n${o.offer_url}` : "";
    return `• ${String(o.title ?? "").trim()}${body ? `: ${body.slice(0, 220)}` : ""}${link}`;
  });
  return `בשמחה — הנה על מה ${label}:\n${lines.join("\n")}\n\nרוצה פרטים על אחת מהן?`;
}

export function buildNoMatchText(category: ProductCategory): string {
  const label = CATEGORY_LABEL_HE[category];
  return `כרגע אין לנו ${label} פעילות בקטלוג. רוצה שאבדוק בשבילך קטגוריה אחרת?`;
}

/* ------------------------------------------------------------------ */
/* Durable category focus (contacts.dynamic_profile_fields)            */
/* ------------------------------------------------------------------ */

export const CATEGORY_FOCUS_KEY = "v2_category_focus" as const;

export type CategoryFocus = {
  category: ProductCategory | null;
  offer_ids: string[];
  source: "explicit_message" | "followup" | "none";
  updated_at: string | null;
};

export const EMPTY_CATEGORY_FOCUS: CategoryFocus = {
  category: null,
  offer_ids: [],
  source: "none",
  updated_at: null,
};

export function readCategoryFocus(dyn: Record<string, any> | null | undefined): CategoryFocus {
  const raw = (dyn ?? {})[CATEGORY_FOCUS_KEY];
  if (!raw || typeof raw !== "object") return { ...EMPTY_CATEGORY_FOCUS };
  const cat = String((raw as any).category ?? "");
  return {
    category: (CATEGORY_ORDER as string[]).includes(cat) ? (cat as ProductCategory) : null,
    offer_ids: Array.isArray((raw as any).offer_ids) ? (raw as any).offer_ids.map(String) : [],
    source: ["explicit_message", "followup"].includes(String((raw as any).source))
      ? ((raw as any).source as CategoryFocus["source"])
      : "none",
    updated_at: (raw as any).updated_at ? String((raw as any).updated_at) : null,
  };
}

export function withCategoryFocus(
  dyn: Record<string, any> | null | undefined,
  focus: CategoryFocus,
): Record<string, any> {
  const out = { ...(dyn ?? {}) };
  if (!focus.category) {
    delete out[CATEGORY_FOCUS_KEY];
    return out;
  }
  out[CATEGORY_FOCUS_KEY] = focus;
  return out;
}

/* ------------------------------------------------------------------ */
/* Turn resolution                                                     */
/* ------------------------------------------------------------------ */

export type CategoryTurn = {
  category: ProductCategory | null;
  confidence: number;
  extraction: CategoryExtraction;
  /** a follow-up answering about the previously presented set */
  followup: boolean;
  restrict_ids: string[] | null;
  reasons: string[];
};

/**
 * Resolve the category constraint for THIS turn from the current message
 * first, and only then from the persisted category focus.
 */
export function resolveCategoryTurn(args: {
  message: string;
  focus: CategoryFocus;
}): CategoryTurn {
  const extraction = extractCategory(args.message);
  if (extraction.category) {
    const switched = !!args.focus.category && args.focus.category !== extraction.category;
    return {
      category: extraction.category,
      confidence: extraction.confidence,
      extraction,
      followup: false,
      restrict_ids: null,
      reasons: switched ? ["category_switch", `category_${extraction.category}`] : [`category_${extraction.category}`],
    };
  }
  if (isCategoryFollowUp(args.message, args.focus.category)) {
    return {
      category: args.focus.category,
      confidence: 0.8,
      extraction,
      followup: true,
      restrict_ids: args.focus.offer_ids.length ? args.focus.offer_ids : null,
      reasons: ["category_followup", `category_${args.focus.category}`],
    };
  }
  return {
    category: null,
    confidence: 0,
    extraction,
    followup: false,
    restrict_ids: null,
    reasons: [],
  };
}
