import { describe, it, expect, vi } from "vitest";
const fn = vi.fn();
vi.mock("@/lib/offer-catalog.functions", () => ({ invalidateCatalogCache: (...a: any[]) => fn(...a) }));
const { notifyCatalogChanged } = await import("@/lib/offer-catalog/notify");
describe("dbg", () => {
  it("fail path", async () => {
    fn.mockImplementation(async () => { throw new Error("boom"); });
    const r = await notifyCatalogChanged({ kind: "delete" });
    console.log("RESULT", JSON.stringify(r));
    expect(r.ok).toBe(false);
  });
});
