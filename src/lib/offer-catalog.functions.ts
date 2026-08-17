/**
 * Admin RPCs for the canonical product catalog: cache invalidation after a
 * product write, and a deterministic metadata refresh of every sellable
 * product (no AI call, no customer message involved).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const invalidateCatalogCache = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { invalidateOfferCatalog } = await import("@/lib/offer-catalog/catalog.server");
    invalidateOfferCatalog();
    return { ok: true };
  });

export const refreshCatalogMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { refreshAllSellableCatalogMeta } = await import("@/lib/offer-catalog/catalog.server");
    const refreshed = await refreshAllSellableCatalogMeta();
    return { ok: true, count: refreshed.length, refreshed };
  });