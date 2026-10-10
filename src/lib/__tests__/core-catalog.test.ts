import { describe, it, expect } from "vitest";
import { createCoreClient, normalizeCatalogItem, CoreApiError } from "@/lib/hostinger-core/client";
import { tamarEligibility, matchesFilter, formToInput, emptyForm, formFromItem, catalogCurrencyOptions, catalogLearnErrorText } from "@/lib/hostinger-core/catalog";

const now = new Date("2026-10-10T00:00:00Z");
const ok = { lifecycle_status: "active", sellable: true, url: "https://x.co/a", event_date: "2026-12-01T00:00:00Z" };

describe("core catalog client", () => {
  it("POST and PATCH shape with bearer, unwraps item", async () => {
    const calls: any[] = [];
    const c = createCoreClient({ baseUrl: "https://core", getToken: async () => "tok",
       fetcher: (async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true, item: { id: "1", title: "T", commercial: { price: 5, event_knowledge: "מידע עובדתי" }, lifecycle_status: "active" }, code: "created" }), { status: 200 }); }) as any });
    const a = await c.createCatalogItem({ title: "T", price: 5, event_knowledge: "מידע עובדתי", currency: "EUR" });
    expect(calls[0].url).toBe("https://core/v1/admin/catalog");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0].init.body)).toEqual({ title: "T", price: 5, event_knowledge: "מידע עובדתי", currency: "EUR" });
    expect(a.event_knowledge).toBe("מידע עובדתי");
    expect(a.price).toBe(5); expect(a.status).toBe("active");
    await c.patchCatalogItem("a/b", { lifecycle_status: "archived", event_knowledge: null, currency: "GBP" });
    expect(calls[1].url).toBe("https://core/v1/admin/catalog/a%2Fb");
    expect(calls[1].init.method).toBe("PATCH");
    expect(JSON.parse(calls[1].init.body)).toEqual({ lifecycle_status: "archived", event_knowledge: null, currency: "GBP" });
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
  it("round trips factual knowledge and clears it explicitly without generating content", () => {
    const knowledge = "קהל יעד: מבוגרים\nמיקום: חיפה\nאין להבטיח החזר ללא בדיקה";
    const form = formFromItem(normalizeCatalogItem({ id: "k", title: "אירוע", verified_facts: { catalog_meta: { event_knowledge: knowledge } } }));
    expect(form.event_knowledge).toBe(knowledge);
    expect(formToInput(form).body?.event_knowledge).toBe(knowledge);
    expect(formToInput({ ...form, event_knowledge: "  " }).body?.event_knowledge).toBeNull();
    expect(formFromItem({ title: "ישן" }).event_knowledge).toBe("");
    expect(emptyForm().event_knowledge).toBe("");
  });
  it("reads knowledge across Core storage shapes with commercial precedence", () => {
    expect(normalizeCatalogItem({ id: "k", event_knowledge: "top", commercial: { event_knowledge: "commercial" }, verified_facts: { catalog_meta: { event_knowledge: "meta" } } }).event_knowledge).toBe("commercial");
    expect(normalizeCatalogItem({ id: "k", event_knowledge: "top" }).event_knowledge).toBe("top");
    expect(normalizeCatalogItem({ id: "k", verified_facts: { event_knowledge: "verified" } }).event_knowledge).toBe("verified");
  });
  it("offers full ISO currencies and preserves other existing currencies", () => {
    expect(catalogCurrencyOptions("ILS").map(option => option.code)).toEqual(["ILS", "EUR", "USD"]);
    const form = formFromItem({ title: "ישן", currency: "GBP" });
    expect(catalogCurrencyOptions(form.currency).at(-1)).toEqual({ code: "GBP", label: "GBP" });
    expect(formToInput(form).body?.currency).toBe("GBP");
    for (const currency of ["ILS", "EUR", "USD"]) expect(formToInput({ ...form, currency }).body?.currency).toBe(currency);
  });
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

import { applyCatalogSuggestion } from "@/lib/hostinger-core/catalog";
import { readFileSync } from "node:fs";
describe("catalog learn from URL (Core only)", () => {
  it("POSTs exact Core path with session bearer and returns suggestion", async () => {
    const calls: any[] = [];
    const c = createCoreClient({ baseUrl: "https://core", getToken: async () => "tok",
      fetcher: (async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify({ source: { url: "https://e.co" }, suggestion: { title: "אירוע" }, model_status: "ok" })); }) as any });
    const r = await c.learnCatalogFromUrl("https://e.co");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://core/v1/admin/catalog/learn");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0].init.body)).toEqual({ url: "https://e.co" });
    expect(r).toEqual({ source: { url: "https://e.co" }, suggestion: { title: "אירוע" }, model_status: "ok" });
  });
  it("fills only empty fields", () => {
    const { form, filled } = applyCatalogSuggestion({ ...emptyForm(), title: "שלי" }, { title: "אחר", category: "סדנה", price: 50, currency: "EUR" });
    expect(form.title).toBe("שלי"); expect(form.category).toBe("סדנה"); expect(form.price).toBe("50"); expect(form.currency).toBe("EUR"); expect(filled).toBe(2);
  });
  it("keeps the Core failure code and shows its Hebrew message", async () => {
    for (const [code, status] of [["invalid_url", 400], ["unsafe_url", 400], ["page_fetch_failed", 502], ["unsupported_content_type", 415], ["page_too_large", 413], ["page_timeout", 504], ["too_many_redirects", 508], ["event_learning_failed", 500], ["brand_new_code", 400]] as const) {
      const c = createCoreClient({ baseUrl: "https://core", getToken: async () => "tok",
        fetcher: (async () => new Response(JSON.stringify({ ok: false, code }), { status })) as any });
      const err = await c.learnCatalogFromUrl("https://e.co").then(() => null, (e: any) => e);
      expect(err).toBeInstanceOf(CoreApiError);
      expect(err.code).toBe(code);
      expect(err.message).toContain(code);
      const text = catalogLearnErrorText(err);
      expect(text).not.toContain(code);
      expect(text).toMatch(/[\u0590-\u05FF]/);
      if (code === "brand_new_code") expect(text).toBe("Core דחה את הקישור — בדקו שהוא https ציבורי");
    }
  });
  it("reports a Core learn failure even when the HTTP status is 200", async () => {
    const c = createCoreClient({ baseUrl: "https://core", getToken: async () => "tok",
      fetcher: (async () => new Response(JSON.stringify({ ok: false, code: "page_timeout" }))) as any });
    const err = await c.learnCatalogFromUrl("https://e.co").then(() => null, (e: any) => e);
    expect(err).toBeInstanceOf(CoreApiError);
    expect(err.code).toBe("page_timeout");
    expect(catalogLearnErrorText(err)).toBe("ניתוח הדף נמשך יותר מדי זמן — נסו שוב");
  });
  it("maps every documented learn code to Hebrew with a generic fallback", () => {
    const codes = ["invalid_url", "unsafe_url", "page_fetch_failed", "unsupported_content_type", "page_too_large", "page_timeout", "too_many_redirects", "event_learning_failed"];
    const seen = new Set<string>();
    for (const code of codes) {
      const text = catalogLearnErrorText(new CoreApiError(500, code));
      expect(text).toMatch(/[\u0590-\u05FF]/);
      expect(text).not.toBe("הניתוח ב-Core נכשל, נסו שוב");
      seen.add(text);
    }
    expect(seen.size).toBe(codes.length);
    expect(catalogLearnErrorText(new CoreApiError(500, "mystery"))).toBe("הניתוח ב-Core נכשל, נסו שוב");
    expect(catalogLearnErrorText(new Error("boom"))).toBe("הניתוח נכשל, נסו שוב");
  });
  it("active catalog path has no external fetch, Firecrawl or AI gateway", () => {
    for (const p of ["src/routes/_app.catalog.tsx", "src/lib/hostinger-core/catalog.ts", "src/lib/hostinger-core/client.ts"]) {
      const src = readFileSync(p, "utf8");
      expect(src).not.toMatch(/firecrawl|ai\.gateway|catalog-extract|extractEventFromUrl|useServerFn/i);
    }
    expect(readFileSync("src/routes/_app.catalog.tsx", "utf8")).toMatch(/catalogLearnErrorText/);
  });
});
