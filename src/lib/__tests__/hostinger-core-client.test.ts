import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { createCoreClient, toCorePatch, listAll, HOSTINGER_CORE_BASE_URL } from "@/lib/hostinger-core/client";
import { buildDashboard } from "@/lib/hostinger-core/dashboard";

function mockFetch(body: any, status = 200) {
  return vi.fn(async (_u: any, _i?: any) => new Response(JSON.stringify(body), { status }));
}

describe("hostinger core client", () => {
  it("sends the session bearer fetched at request time", async () => {
    const f = mockFetch({ items: [{ id: "a" }], next_cursor: null });
    let n = 0;
    const c = createCoreClient({ getToken: async () => `tok${++n}`, fetcher: f as any });
    await c.listContacts({ limit: 5 });
    await c.listContacts({ limit: 5 });
    expect(f.mock.calls[0][0]).toBe(`${HOSTINGER_CORE_BASE_URL}/v1/admin/contacts?limit=5`);
    expect((f.mock.calls[0][1] as any).headers.Authorization).toBe("Bearer tok1");
    expect((f.mock.calls[1][1] as any).headers.Authorization).toBe("Bearer tok2");
  });
  it("refuses to call without a session", async () => {
    const f = mockFetch({});
    const c = createCoreClient({ getToken: async () => null, fetcher: f as any });
    await expect(c.overview()).rejects.toMatchObject({ status: 401 });
    expect(f).not.toHaveBeenCalled();
  });
  it("PATCHes contacts with profile/lifecycle split", async () => {
    const f = mockFetch({ contact: { id: "x" } });
    const c = createCoreClient({ getToken: async () => "t", fetcher: f as any });
    await c.patchContact("x", toCorePatch({ status: "VIP", city: "חיפה" }));
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe(`${HOSTINGER_CORE_BASE_URL}/v1/admin/contacts/x`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ profile: { city: "חיפה" }, lifecycle: { status: "VIP" } });
  });
  it("surfaces errors with status", async () => {
    const c = createCoreClient({ getToken: async () => "t", fetcher: mockFetch({ error: "nope" }, 404) as any });
    await expect(c.getContact("z")).rejects.toMatchObject({ status: 404, code: "nope" });
  });
  it("paginates catalog via cursor", async () => {
    const pages = [{ items: [{ id: "1" }], next_cursor: "c2" }, { items: [{ id: "2" }], next_cursor: null }];
    const f = vi.fn(async () => new Response(JSON.stringify(pages.shift())));
    const c = createCoreClient({ getToken: async () => "t", fetcher: f as any });
    const all = await listAll((p) => c.listCatalog(p));
    expect(all.map((x) => x.id)).toEqual(["1", "2"]);
    expect((f.mock.calls[1] as any)[0]).toContain("cursor=c2");
  });
  it("builds dashboard from contacts", () => {
    const d = buildDashboard({}, [{ status: "VIP", interests: ["trips"], engagement_score: 5 }]);
    expect(d.total).toBe(1);
    expect(d.counts.VIP).toBe(1);
  });
});

import { normalizeContact, normalizeCatalogItem, normalizePage } from "@/lib/hostinger-core/client";

describe("verified Core response shapes", () => {
  const contactRow = {
    id: "c1",
    identity: { full_name: "דנה", phone: "972500000000" },
    profile: { city: "חיפה", interests: ["trips"] },
    lifecycle: { status: "interested", engagement_score: 7 },
    consent_state: { whatsapp_consent: true },
    source_created_at: "2026-01-01T00:00:00Z",
    source_updated_at: "2026-01-02T00:00:00Z",
  };
  const catalogRow = {
    id: "k1", title: "סדנה", category: "workshop", lifecycle_status: "active",
    commercial: { price: 100, currency: "ILS" }, verified_facts: { location: "תל אביב" },
  };
  const client = (body: any) => createCoreClient({ getToken: async () => "t", fetcher: mockFetch(body) as any });

  it("normalizePage reads body.rows", () => {
    expect(normalizePage({ ok: true, rows: [{ id: "a" }], next_cursor: "n" }, "contacts"))
      .toEqual({ items: [{ id: "a" }], next_cursor: "n" });
  });
  it("flattens contacts from list responses, keeping raw nested objects", async () => {
    const p = await client({ ok: true, rows: [contactRow], next_cursor: null }).listContacts();
    const c = p.items[0];
    expect(c).toMatchObject({ id: "c1", full_name: "דנה", city: "חיפה", status: "interested", whatsapp_consent: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" });
    expect(c.identity).toEqual(contactRow.identity);
    expect(c.lifecycle).toEqual(contactRow.lifecycle);
  });
  it("flattens contact detail and patch responses", async () => {
    expect((await client({ ok: true, contact: contactRow }).getContact("c1")).full_name).toBe("דנה");
    expect((await client({ ok: true, contact: contactRow }).patchContact("c1", {})).status).toBe("interested");
  });
  it("keeps explicit created_at over source_created_at", () => {
    expect(normalizeContact({ ...contactRow, profile: { created_at: "x" } }).created_at).toBe("x");
  });
  it("flattens catalog items and maps lifecycle_status to status", async () => {
    const p = await client({ ok: true, rows: [catalogRow], next_cursor: null }).listCatalog();
    expect(p.items[0]).toMatchObject({ id: "k1", title: "סדנה", status: "active", price: 100, currency: "ILS", location: "תל אביב" });
    expect(normalizeCatalogItem(catalogRow).commercial).toEqual(catalogRow.commercial);
  });
  it("dashboard consumes overview.counts and flattened contacts", () => {
    const d = buildDashboard({ ok: true, tenant: "zooga", counts: { contacts: 42, catalog: 5, open_handoffs: 1 } }, [normalizeContact(contactRow)]);
    expect(d.total).toBe(42);
    expect(d.catalogTotal).toBe(5);
    expect(d.openHandoffs).toBe(1);
    expect(d.counts.interested).toBe(1);
    expect(d.topInterests[0]).toEqual(["trips", 1]);
  });
});
