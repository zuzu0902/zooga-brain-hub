/**
 * ONE helper every product mutation in the UI calls, so the canonical catalog
 * refreshes immediately instead of waiting for the cache TTL.
 *
 * Removal-shaped changes (delete / sold out / archive / expire) are safe even
 * when this call fails: the server re-verifies the chosen product against
 * `offers_sellable` on every resolution, so a removed product can never be
 * offered. The notification is a latency optimization, never the guarantee.
 */
import { invalidateCatalogCache } from "@/lib/offer-catalog.functions";

export type CatalogChangeKind = "create" | "update" | "delete" | "archive" | "sold_out";

export const REMOVAL_KINDS: CatalogChangeKind[] = ["delete", "archive", "sold_out"];

export function isRemovalKind(kind: CatalogChangeKind): boolean {
  return REMOVAL_KINDS.includes(kind);
}

export async function notifyCatalogChanged(args: {
  kind: CatalogChangeKind;
  offerId?: string | null;
}): Promise<{ ok: boolean; removed: boolean; error?: string }> {
  const removed = isRemovalKind(args.kind);
  try {
    await invalidateCatalogCache({ data: { offerId: args.offerId ?? null, removed } });
    return { ok: true, removed };
  } catch (e: any) {
    // Never block or fail the product mutation on a cache notification.
    return { ok: false, removed, error: String(e?.message ?? e) };
  }
}