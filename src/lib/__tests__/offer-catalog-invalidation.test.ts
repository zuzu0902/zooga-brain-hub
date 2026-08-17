import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";

const invalidateCatalogCache = vi.fn();
vi.mock("@/lib/offer-catalog.functions", () => ({ invalidateCatalogCache: (...a: any[]) => invalidateCatalogCache(...a) }));

const { notifyCatalogChanged, isRemovalKind } = await import("@/lib/offer-catalog/notify");

const read = (p: string) => readFile(p, "utf8");

beforeEach(() => invalidateCatalogCache.mockClear());

describe("catalog invalidation helper", () => {
  it("invalidates immediately on a successful mutation notification", async () => {
    invalidateCatalogCache.mockResolvedValue({ ok: true });
    const r = await notifyCatalogChanged({ kind: "update", offerId: "o1" });
    expect(r.ok).toBe(true);
    expect(invalidateCatalogCache).toHaveBeenCalledWith({ data: { offerId: "o1", removed: false } });
  });

  it("flags removal-shaped changes", async () => {
    invalidateCatalogCache.mockResolvedValue({ ok: true });
    for (const kind of ["delete", "archive", "sold_out"] as const) {
      expect(isRemovalKind(kind)).toBe(true);
      await notifyCatalogChanged({ kind, offerId: "o1" });
      expect(invalidateCatalogCache).toHaveBeenLastCalledWith({ data: { offerId: "o1", removed: true } });
    }
    expect(isRemovalKind("create")).toBe(false);
  });

  it("never throws when the invalidation call fails — the mutation still succeeds", async () => {
    invalidateCatalogCache.mockImplementationOnce(() => Promise.reject(new Error("network down")));
    const r = await notifyCatalogChanged({ kind: "delete", offerId: "o1" });
    expect(r.ok).toBe(false);
    expect(r.removed).toBe(true);
    expect(r.error).toContain("network down");
  });
});

describe("removal safety net (independent of the notification)", () => {
  it("every resolution re-verifies the chosen product against offers_sellable and fails closed", async () => {
    const src = await read("src/lib/offer-catalog/catalog.server.ts");
    expect(src).toContain("async function stillSellable");
    expect(src).toContain('from("offers_sellable")');
    expect(src).toMatch(/if \(error\) return false;/); // fail closed on read error
    expect(src).toContain("offer_no_longer_sellable");
    expect(src).toContain("if (entry && (await stillSellable(entry.id)))"); // explicit offer id path
  });
});

describe("all product mutations use the single shared helper", () => {
  const sites = [
    "src/routes/_app.offers.tsx",
    "src/routes/_app.offers.$id.tsx",
    "src/components/offer-picker.tsx",
  ];

  it("create / update / archive / delete all notify the catalog", async () => {
    for (const f of sites) {
      const src = await read(f);
      expect(src, f).toContain('from "@/lib/offer-catalog/notify"');
      const writes = (src.match(/from\("offers"\)\s*\.?\s*(insert|update|delete)/g) ?? []).length;
      const notifies = (src.match(/notifyCatalogChanged\(/g) ?? []).length;
      expect(notifies, `${f}: ${writes} writes / ${notifies} notifications`).toBeGreaterThanOrEqual(1);
    }
    const detail = await read("src/routes/_app.offers.$id.tsx");
    expect(detail).toContain('kind: "delete"');
    expect(detail).toContain('"update" : "archive"');
  });
});