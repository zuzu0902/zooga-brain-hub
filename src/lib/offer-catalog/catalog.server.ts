/**
 * The ONE place every Tamar engine reads products from: `offers_sellable`,
 * normalized through the pure catalog builder, with a short in-memory cache
 * and explicit invalidation on any product write.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildCatalog, buildCatalogEntry, type CatalogEntry, type OfferRow } from "./normalize";
import { matchOffer, shouldReleaseActiveOffer, type MatchResult } from "./match";
import { activeOfferFrom, withActiveOffer } from "./active-offer";
import { extractConversationFacts, mergeConversationFacts, type ConversationFacts } from "./facts";

const CATALOG_TTL_MS = 60_000;

let cache: { at: number; rows: OfferRow[]; entries: CatalogEntry[] } | null = null;

/** Called after ANY product create/update/delete/archive/sold-out change. */
export function invalidateOfferCatalog(): void {
  cache = null;
}

/**
 * Removal safety net.
 *
 * The cache is invalidated by the products screen after every write, but that
 * call can fail (offline tab, worker restart, another instance). A product
 * that was deleted / marked full / archived must NEVER be offered anyway, so
 * every resolution re-verifies the chosen product against `offers_sellable`
 * before it is returned. One indexed lookup per resolved turn.
 */
async function stillSellable(offerId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("offers_sellable")
    .select("id")
    .eq("id", offerId)
    .maybeSingle();
  if (error) return false; // fail closed: never offer a product we cannot verify
  return !!data;
}

export async function loadCatalog(force = false): Promise<{ rows: OfferRow[]; entries: CatalogEntry[] }> {
  const now = Date.now();
  if (!force && cache && now - cache.at < CATALOG_TTL_MS) return { rows: cache.rows, entries: cache.entries };
  const { data, error } = await supabaseAdmin.from("offers_sellable").select("*").limit(200);
  if (error) throw new Error(`offer_catalog_load_failed: ${error.message}`);
  const rows = ((data as any[]) ?? []) as OfferRow[];
  const entries = buildCatalog(rows);
  cache = { at: now, rows, entries };
  return { rows, entries };
}

export async function catalogEntryFor(offerId: string | null | undefined): Promise<CatalogEntry | null> {
  if (!offerId) return null;
  const { entries } = await loadCatalog();
  return entries.find((e) => e.id === offerId) ?? null;
}

export type CatalogResolution = {
  match: MatchResult;
  /** the offer row every engine should ground on (null = ask / no product) */
  offer: OfferRow | null;
  entry: CatalogEntry | null;
  active_offer_id: string | null;
  changed: boolean;
  reason: string;
};

/**
 * Single resolution used by the live engine, V2 and Lite so all three always
 * choose the SAME product for the same message + contact.
 */
export async function resolveCatalogOffer(args: {
  message: string;
  contact?: any;
  explicitOfferId?: string | null;
}): Promise<CatalogResolution> {
  const { rows, entries } = await loadCatalog();
  const active = activeOfferFrom(args.contact);
  const activeEntry = active ? entries.find((e) => e.id === active.offer_id && e.sellable) ?? null : null;

  if (args.explicitOfferId) {
    const entry = entries.find((e) => e.id === args.explicitOfferId) ?? null;
    if (entry) {
      return {
        match: {
          status: "match",
          offer_id: entry.id,
          candidates: [entry.id],
          clarification: null,
          reasons: ["explicit_offer_id"],
          intent: { destinations: [], holidays: [], months: [], timeOnly: false },
        },
        offer: rows.find((r) => r.id === entry.id) ?? null,
        entry,
        active_offer_id: entry.id,
        changed: entry.id !== activeEntry?.id,
        reason: "explicit_offer_id",
      };
    }
  }

  const match = matchOffer({ message: args.message, catalog: entries, activeOfferId: activeEntry?.id ?? null });
  const release = shouldReleaseActiveOffer({ activeEntry, match });

  const chosenId =
    match.status === "match"
      ? match.offer_id
      : match.status === "keep_active"
        ? activeEntry?.id ?? null
        : release.release
          ? null
          : activeEntry?.id ?? null;

  const entry = chosenId ? entries.find((e) => e.id === chosenId) ?? null : null;
  if (entry && !(await stillSellable(entry.id))) {
    // stale cache entry for a product that is gone / full / archived / expired
    invalidateOfferCatalog();
    return {
      match: { ...match, status: "none", offer_id: null, reasons: [...match.reasons, "offer_no_longer_sellable"] },
      offer: null,
      entry: null,
      active_offer_id: null,
      changed: true,
      reason: "offer_no_longer_sellable",
    };
  }
  return {
    match,
    offer: entry ? rows.find((r) => r.id === entry.id) ?? null : null,
    entry,
    active_offer_id: entry?.id ?? null,
    changed: !!entry && entry.id !== activeEntry?.id,
    reason: release.reason,
  };
}

/** Persist the lock. Idempotent; never touches any other contact field. */
export const CONVERSATION_FACTS_KEY = "conversation_facts";

/**
 * Extract facts from a customer turn (typed text OR voice transcript) and
 * merge them into the contact. Never erases a previously known value.
 */
export async function commitConversationFacts(args: {
  contactId: string | null | undefined;
  text: string;
}): Promise<ConversationFacts | null> {
  if (!args.contactId || !String(args.text ?? "").trim()) return null;
  const next = extractConversationFacts(args.text);
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("dynamic_profile_fields")
    .eq("id", args.contactId)
    .maybeSingle();
  const dyn = ((data as any)?.dynamic_profile_fields ?? {}) as Record<string, any>;
  const merged = mergeConversationFacts(dyn[CONVERSATION_FACTS_KEY] ?? null, next);
  if (JSON.stringify(merged) === JSON.stringify(dyn[CONVERSATION_FACTS_KEY] ?? null)) return merged;
  await supabaseAdmin
    .from("contacts")
    .update({ dynamic_profile_fields: { ...dyn, [CONVERSATION_FACTS_KEY]: merged } } as any)
    .eq("id", args.contactId);
  return merged;
}

export async function commitActiveOffer(args: {
  contactId: string | null | undefined;
  offerId: string | null;
  title?: string | null;
  reason: string;
}): Promise<void> {
  if (!args.contactId || !args.offerId) return;
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("dynamic_profile_fields")
    .eq("id", args.contactId)
    .maybeSingle();
  const dyn = ((data as any)?.dynamic_profile_fields ?? {}) as Record<string, any>;
  if ((dyn as any)?.active_offer?.offer_id === args.offerId) return;
  const next = withActiveOffer(dyn, { offerId: args.offerId, title: args.title ?? null, reason: args.reason });
  await supabaseAdmin.from("contacts").update({ dynamic_profile_fields: next } as any).eq("id", args.contactId);
}

/**
 * Recompute and persist normalized catalog metadata for one offer.
 * Deterministic — no AI call.
 */
export async function refreshOfferCatalogMeta(row: OfferRow): Promise<CatalogEntry> {
  const entry = buildCatalogEntry(row);
  await supabaseAdmin
    .from("offers")
    .update({
      catalog_meta: entry as any,
      catalog_source_hash: entry.source_hash,
      catalog_analyzed_at: entry.analyzed_at,
    } as any)
    .eq("id", row.id);
  invalidateOfferCatalog();
  return entry;
}

/** One-time / on-demand refresh of every currently sellable product. */
export async function refreshAllSellableCatalogMeta(): Promise<Array<{ id: string; title: string; source_hash: string }>> {
  const { rows } = await loadCatalog(true);
  const out: Array<{ id: string; title: string; source_hash: string }> = [];
  for (const row of rows) {
    const entry = await refreshOfferCatalogMeta(row);
    out.push({ id: row.id, title: entry.title, source_hash: entry.source_hash });
  }
  invalidateOfferCatalog();
  return out;
}