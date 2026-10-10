import { describe, it, expect } from "vitest";
import { createCoreClient, normalizeCatalogItem } from "@/lib/hostinger-core/client";
import { tamarEligibility, matchesFilter, formToInput, emptyForm } from "@/lib/hostinger-core/catalog";

const now = new Date("2026-10-10T00:00:00Z");
const ok = { lifecycle_status: "active", sellable: true, url: "https://x.co/a", event_date: "2026-12-01T00:00:00Z" };

describe("core catalog client", () => {
  it("POST and PATCH shape with bearer, unwraps item", async () => {
    const calls: any[] = [];
    const c = createCoreClient({ baseUrl: "https://core", getToken: async () => "tok",
      fetcher: (async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true, item: { id: "1", title: "T", commercial: { price: 5 }, lifecycle_status: "active" }, code: "created" }), { status: 200 }); }) as any });
    const a = await c.createCatalogItem({ title: "T", price: 5 });
    expect(calls[0].url).toBe("https://core/v1/admin/catalog");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0].init.body)).toEqual({ title: "T", price: 5 });
    expect(a.price).toBe(5); expect(a.status).toBe("active");
    await c.patchCatalogItem("a/b", { lifecycle_status: "archived" });
    expect(calls[1].url).toBe("https://core/v1/admin/catalog/a%2Fb");
    expect(calls[1].init.method).toBe("PATCH");
  });
});

describe("normalizeCatalogItem precedence", () => {
  it("legacy imported record: offer_url + catalog_meta surface as canonical url/date/sellable", () => {
    const commercial = {
      offer_url: "https://legacy.co/offer",
      price: 120,
      currency: "ILS",
      event_date: "2027-03-01T00:00:00Z",
      event_end_date: "2027-03-05T00:00:00Z",
    };
    const verified_facts = {
      catalog_meta: { url: "https://legacy.co/offer", sellable: true, event_date: "2027-03-01T00:00:00Z" },
    };
    const item = normalizeCatalogItem({
      id: "imp1",
      title: "Legacy item",
      lifecycle_status: "active",
      commercial,
      verified_facts,
    });
    expect(item.url).toBe("https://legacy.co/offer");
    expect(item.event_date).toBe("2027-03-01T00:00:00Z");
    expect(item.event_end_date).toBe("2027-03-05T00:00:00Z");
    expect(item.sellable).toBe(true);
    expect(item.title).toBe("Legacy item");
    expect(item.price).toBe(120);
    expect(item.currency).toBe("ILS");
    expect(item.commercial).toBe(commercial);
    expect(item.verified_facts).toBe(verified_facts);
    expect(tamarEligibility(item, now).ready).toBe(true);
    expect(matchesFilter(item, "active", now)).toBe(true);
  });

  it("Core-created record with commercial.url still works, commercial wins precedence", () => {
    const item = normalizeCatalogItem({
      id: "c1",
      title: "Core item",
      lifecycle_status: "active",
      commercial: {
        url: "https://core.co/item",
        offer_url: "https://old.co/offer",
        sellable: true,
        event_date: "2027-01-01T00:00:00Z",
      },
      verified_facts: { catalog_meta: { url: "https://meta.co/x", sellable: false } },
    });
    expect(item.url).toBe("https://core.co/item");
    expect(item.sellable).toBe(true);
    expect(item.event_date).toBe("2027-01-01T00:00:00Z");
    expect(tamarEligibility(item, now).ready).toBe(true);
  });
});

describe("eligibility & filters", () => {
  it("ready only when all conditions hold", () => {
    expect(tamarEligibility(ok, now).ready).toBe(true);
    expect(tamarEligibility({ ...ok, url: "http://x.co" }, now).reasons).toContain("חסר קישור HTTPS תקין");
    expect(tamarEligibility({ ...ok, event_date: null }, now).reasons).toContain("חסר תאריך ידוע");
    expect(tamarEligibility({ ...ok, event_end_date: "2026-01-01" }, now).reasons).toContain("התאריך עבר");
    expect(tamarEligibility({ ...ok, sellable: false }, now).ready).toBe(false);
    expect(tamarEligibility({ ...ok, lifecycle_status: "draft" }, now).ready).toBe(false);
  });
  it("filters", () => {
    expect(matchesFilter(ok, "active", now)).toBe(true);
    expect(matchesFilter({ url: "" }, "needs_link", now)).toBe(true);
    expect(matchesFilter({ event_date: "2025-01-01" }, "past_date", now)).toBe(true);
    expect(matchesFilter({ status: "archived" }, "archived", now)).toBe(true);
  });
  it("form validation", () => {
    expect(formToInput(emptyForm()).errors.length).toBeGreaterThan(0);
    expect(formToInput({ ...emptyForm(), title: "x", url: "http://a" }).errors).toContain("הקישור חייב להתחיל ב-https://");
    expect(formToInput({ ...emptyForm(), title: "x", price: "-1" }).errors.length).toBe(1);
    expect(formToInput({ ...emptyForm(), title: " x ", price: "10", currency: "usd" }).body).toMatchObject({ title: "x", price: 10, currency: "USD" });
  });
});
