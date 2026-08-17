import { describe, it, expect } from "vitest";
import { buildCatalog, buildCatalogEntry, type OfferRow } from "@/lib/offer-catalog/normalize";
import { matchOffer, parseIntent, shouldReleaseActiveOffer } from "@/lib/offer-catalog/match";
import { extractConversationFacts, mergeConversationFacts } from "@/lib/offer-catalog/facts";
import { activeOfferFrom, withActiveOffer } from "@/lib/offer-catalog/active-offer";

const NOW = new Date("2026-08-17T12:00:00Z");

const VIETNAM_HANUKKAH: OfferRow = {
  id: "b8cd0b94",
  title: "טיול בוטיק לוייטנאם וקמבודיה מחזור 3 - חנוכה 2026",
  status: "active",
  event_date: "2026-12-01T00:00:00Z",
  event_end_date: "2026-12-14T00:00:00Z",
  matching_tags: ["טיול מאורגן", "וייטנאם", "קמבודיה", "חנוכה 2026", "סינגלים", "זוגות בפרק ב'"],
  offer_url: "https://z/x1",
};
const VIETNAM_60PLUS: OfferRow = {
  id: "1afaec91",
  title: "טיול לבני 60+ לוייטנאם",
  status: "active",
  event_date: "2027-01-06T00:00:00Z",
  event_end_date: "2027-01-18T00:00:00Z",
  matching_tags: ["וייטנאם", "בני 60 פלוס", "רמת קושי קלה"],
  offer_url: "https://z/x2",
};
const DUBAI_OCT: OfferRow = {
  id: "dbff14e9",
  title: "דובאי ואבו דאבי 5 ימים של יוקרה ופאר 13-17/10",
  status: "active",
  event_date: "2026-10-13T00:00:00Z",
  event_end_date: "2026-10-17T00:00:00Z",
  matching_tags: ["דובאי", "אבו דאבי", "יוקרה", "אוקטובר"],
  offer_url: "https://z/x3",
};

const CATALOG = buildCatalog([VIETNAM_HANUKKAH, VIETNAM_60PLUS, DUBAI_OCT], NOW);

describe("catalog normalization", () => {
  it("derives destination, holiday and months from existing fields", () => {
    const e = buildCatalogEntry(VIETNAM_HANUKKAH, NOW);
    expect(e.destinations).toContain("vietnam");
    expect(e.destinations).toContain("cambodia");
    expect(e.holidays).toContain("hanukkah");
    expect(e.months).toContain(12);
    expect(e.sellable).toBe(true);
    expect(e.source_hash).toMatch(/^c/);
  });

  it("drops deleted / sold-out / archived / expired products from selection", () => {
    const soldOut = buildCatalogEntry({ ...VIETNAM_HANUKKAH, sold_out: true }, NOW);
    const archived = buildCatalogEntry({ ...VIETNAM_HANUKKAH, archived_at: "2026-08-01" }, NOW);
    const expired = buildCatalogEntry({ ...DUBAI_OCT, event_end_date: "2026-01-01T00:00:00Z" }, NOW);
    const inactive = buildCatalogEntry({ ...DUBAI_OCT, status: "archived" }, NOW);
    for (const e of [soldOut, archived, expired, inactive]) expect(e.sellable).toBe(false);
    const m = matchOffer({ message: "וייטנאם בחנוכה", catalog: [soldOut, ...CATALOG.filter((c) => c.id !== "b8cd0b94")] });
    expect(m.offer_id).not.toBe("b8cd0b94");
  });

  it("changes the source hash when the product is updated (cache invalidation signal)", () => {
    const a = buildCatalogEntry(VIETNAM_HANUKKAH, NOW).source_hash;
    const b = buildCatalogEntry({ ...VIETNAM_HANUKKAH, title: "עודכן" }, NOW).source_hash;
    expect(a).not.toBe(b);
  });
});

describe("deterministic matcher", () => {
  it("normalizes Hebrew prefixes and spelling variants", () => {
    expect(parseIntent("בחנוכה").holidays).toEqual(["hanukkah"]);
    expect(parseIntent("לויאטנם").destinations).toEqual(["vietnam"]);
  });

  it("'וייטנאם בחנוכה' picks the Vietnam-Cambodia Hanukkah trip", () => {
    const m = matchOffer({ message: "אני רוצה וייטנאם בחנוכה", catalog: CATALOG });
    expect(m.status).toBe("match");
    expect(m.offer_id).toBe("b8cd0b94");
  });

  it("'בחנוכה' after Vietnam keeps the locked offer", () => {
    const m = matchOffer({ message: "ומה בחנוכה?", catalog: CATALOG, activeOfferId: "b8cd0b94" });
    expect(m.status).toBe("keep_active");
    expect(m.offer_id).toBe("b8cd0b94");
  });

  it("a complaint mentioning 'אוקטובר' never switches to Dubai", () => {
    const m = matchOffer({
      message: "שלחת לי כבר את הקישור באוקטובר, זה מבלבל",
      catalog: CATALOG,
      activeOfferId: "b8cd0b94",
    });
    expect(m.offer_id).toBe("b8cd0b94");
    expect(m.reasons.join(",")).toContain("time_only_keeps_active");
  });

  it("a voice transcript continues on the active offer", () => {
    const m = matchOffer({
      message: "יש לי כאבי רגליים, אני לא יכולה ללכת הרבה",
      catalog: CATALOG,
      activeOfferId: "b8cd0b94",
    });
    expect(m.offer_id).toBe("b8cd0b94");
  });

  it("a genuine tie asks a clarification instead of picking a row", () => {
    const m = matchOffer({ message: "מעניין אותי וייטנאם", catalog: CATALOG });
    expect(m.status).toBe("ambiguous");
    expect(m.offer_id).toBeNull();
    expect(m.clarification).toContain("רק שאדע");
  });

  it("releases the lock only on an explicit other destination or unsellable offer", () => {
    const active = CATALOG.find((c) => c.id === "b8cd0b94")!;
    const same = matchOffer({ message: "בחנוכה", catalog: CATALOG, activeOfferId: active.id });
    expect(shouldReleaseActiveOffer({ activeEntry: active, match: same }).release).toBe(false);
    const other = matchOffer({ message: "ומה עם דובאי?", catalog: CATALOG, activeOfferId: active.id });
    expect(other.offer_id).toBe("dbff14e9");
    expect(shouldReleaseActiveOffer({ activeEntry: active, match: other }).release).toBe(true);
  });
});

describe("active offer lock", () => {
  it("is idempotent and readable", () => {
    const a = withActiveOffer({}, { offerId: "b8cd0b94", title: "וייטנאם", reason: "match" });
    const b = withActiveOffer(a, { offerId: "b8cd0b94", reason: "match" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(activeOfferFrom({ dynamic_profile_fields: a })?.offer_id).toBe("b8cd0b94");
  });
});

describe("fact extraction", () => {
  it("captures destination, holiday, solo travel and mobility limits", () => {
    const f = extractConversationFacts("אני נוסעת לבד לוייטנאם בחנוכה, יש לי כאבי רגליים");
    expect(f.destination).toBe("vietnam");
    expect(f.holiday).toBe("hanukkah");
    expect(f.travel_party).toBe("solo");
    expect(f.mobility_limit).toBe(true);
  });

  it("merging never erases a previously known fact", () => {
    const first = extractConversationFacts("אני לבד, כאב ברגל");
    const second = extractConversationFacts("מעניין אותי וייטנאם");
    const merged = mergeConversationFacts(first, second);
    expect(merged.mobility_limit).toBe(true);
    expect(merged.travel_party).toBe("solo");
    expect(merged.destination).toBe("vietnam");
  });
});

describe("engine parity", () => {
  it("both engines resolve the same product from the same pure matcher", () => {
    const message = "וייטנאם בחנוכה";
    const live = matchOffer({ message, catalog: CATALOG });
    const lite = matchOffer({ message, catalog: CATALOG });
    expect(live.offer_id).toBe(lite.offer_id);
    expect(live.offer_id).toBe("b8cd0b94");
  });
});