/**
 * CANONICAL PRODUCT MATCHER (PURE, no I/O, no AI).
 *
 * Rules:
 *  1. Destination first. A destination in the message picks the candidate set.
 *  2. Holiday / month / date only REFINE an already-known destination
 *     (from the message or from the locked active offer). A time word alone
 *     never selects a different product.
 *  3. A genuine tie asks one short clarification — never picks a random row.
 */
import {
  DESTINATIONS,
  HOLIDAYS,
  MONTH_WORDS,
  containsTerm,
  tokenize,
  type CatalogEntry,
} from "./normalize";

export type QueryIntent = {
  destinations: string[];
  holidays: string[];
  months: number[];
  /** time signal present but no destination signal */
  timeOnly: boolean;
};

export function parseIntent(message: string): QueryIntent {
  const tokens = tokenize(message);
  const destinations: string[] = [];
  for (const [key, aliases] of Object.entries(DESTINATIONS)) {
    if (aliases.some((a) => containsTerm(tokens, a))) destinations.push(key);
  }
  const holidays: string[] = [];
  for (const [key, aliases] of Object.entries(HOLIDAYS)) {
    if (aliases.some((a) => containsTerm(tokens, a))) holidays.push(key);
  }
  const months: number[] = [];
  for (const [num, words] of Object.entries(MONTH_WORDS)) {
    if (words.some((w) => containsTerm(tokens, w))) months.push(Number(num));
  }
  return {
    destinations,
    holidays,
    months,
    timeOnly: destinations.length === 0 && (holidays.length > 0 || months.length > 0),
  };
}

export type MatchResult = {
  status: "match" | "keep_active" | "ambiguous" | "none";
  offer_id: string | null;
  candidates: string[];
  clarification: string | null;
  reasons: string[];
  intent: QueryIntent;
};

function refine(pool: CatalogEntry[], intent: QueryIntent, reasons: string[]): CatalogEntry[] {
  let out = pool;
  if (intent.holidays.length) {
    const byHoliday = out.filter((e) => e.holidays.some((h) => intent.holidays.includes(h)));
    if (byHoliday.length) {
      reasons.push(`refined_holiday:${intent.holidays.join("|")}`);
      out = byHoliday;
    }
  }
  if (out.length > 1 && intent.months.length) {
    const byMonth = out.filter((e) => e.months.some((m) => intent.months.includes(m)));
    if (byMonth.length) {
      reasons.push(`refined_month:${intent.months.join("|")}`);
      out = byMonth;
    }
  }
  return out;
}

/**
 * @param activeOfferId the locked offer of this conversation (if still sellable)
 */
export function matchOffer(args: {
  message: string;
  catalog: CatalogEntry[];
  activeOfferId?: string | null;
}): MatchResult {
  const intent = parseIntent(args.message);
  const reasons: string[] = [];
  const sellable = (args.catalog ?? []).filter((e) => e.sellable);
  const active = sellable.find((e) => e.id === args.activeOfferId) ?? null;

  // (2) time word alone: refine the active offer only, never switch product.
  if (!intent.destinations.length) {
    if (active) {
      reasons.push(intent.timeOnly ? "time_only_keeps_active" : "no_destination_keeps_active");
      return {
        status: "keep_active",
        offer_id: active.id,
        candidates: [active.id],
        clarification: null,
        reasons,
        intent,
      };
    }
    reasons.push(intent.timeOnly ? "time_only_without_destination" : "no_signal");
    return { status: "none", offer_id: null, candidates: [], clarification: null, reasons, intent };
  }

  // (1) destination first
  let pool = sellable.filter((e) => e.destinations.some((d) => intent.destinations.includes(d)));
  reasons.push(`destination:${intent.destinations.join("|")}`);
  if (!pool.length) {
    reasons.push("destination_not_in_catalog");
    return {
      status: "none",
      offer_id: null,
      candidates: [],
      clarification: null,
      reasons,
      intent,
    };
  }

  pool = refine(pool, intent, reasons);

  if (pool.length === 1) {
    return { status: "match", offer_id: pool[0]!.id, candidates: [pool[0]!.id], clarification: null, reasons, intent };
  }

  // active offer inside the still-tied pool wins (continuity, not randomness)
  if (active && pool.some((e) => e.id === active.id)) {
    reasons.push("tie_resolved_by_active_offer");
    return { status: "match", offer_id: active.id, candidates: pool.map((e) => e.id), clarification: null, reasons, intent };
  }

  reasons.push("ambiguous_tie");
  const names = pool.slice(0, 3).map((e) => e.title);
  return {
    status: "ambiguous",
    offer_id: null,
    candidates: pool.map((e) => e.id),
    clarification: `רק שאדע במדויק על מה לספר — ${names.join(" או ")}?`,
    reasons,
    intent,
  };
}

/**
 * Should the conversation's locked offer be replaced?
 * Only on an explicit different destination, or when it stopped being sellable.
 */
export function shouldReleaseActiveOffer(args: {
  activeEntry: CatalogEntry | null;
  match: MatchResult;
}): { release: boolean; reason: string } {
  if (!args.activeEntry) return { release: true, reason: "no_active_offer" };
  if (!args.activeEntry.sellable) return { release: true, reason: "active_offer_not_sellable" };
  if (args.match.status === "match" && args.match.offer_id && args.match.offer_id !== args.activeEntry.id) {
    return { release: true, reason: "explicit_other_destination" };
  }
  return { release: false, reason: "active_offer_kept" };
}