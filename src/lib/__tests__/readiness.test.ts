import { describe, expect, it } from "vitest";
import { normalizePhone, splitName } from "@/lib/phone";
import { isOptInMessage, isOptOutMessage } from "@/lib/optout";
import { isOfferSellable, offerBucket, validateOfferDates, validateReactivation } from "@/lib/offer-sellable";
import { LEAD_FIXTURES } from "./fixtures";

const future = new Date(Date.now() + 30 * 864e5).toISOString();
const past = new Date(Date.now() - 30 * 864e5).toISOString();

describe("lead import dry-run (10 synthetic fixtures, no PII)", () => {
  it("normalizes every fixture to the expected E.164 value", () => {
    for (const f of LEAD_FIXTURES) expect(normalizePhone(f.raw_phone), f.label).toBe(f.expect_phone);
  });

  it("dedupes and counts exactly like importLeads does", () => {
    const seen = new Set<string>();
    let imported = 0, duplicates = 0, invalid = 0;
    for (const f of LEAD_FIXTURES) {
      const p = normalizePhone(f.raw_phone);
      if (!p) { invalid++; continue; }
      if (seen.has(p)) { duplicates++; continue; }
      seen.add(p); imported++;
    }
    expect({ imported, duplicates, invalid, total: LEAD_FIXTURES.length })
      .toEqual({ imported: 7, duplicates: 1, invalid: 2, total: 10 });
  });

  it("splits names without inventing values", () => {
    expect(splitName("Fixture One")).toEqual({ first: "Fixture", last: "One" });
    expect(splitName(null)).toEqual({ first: null, last: null });
  });

  it("only consented fixtures are enrollable", () => {
    const enrollable = new Set(
      LEAD_FIXTURES.filter((f) => f.consent).map((f) => normalizePhone(f.raw_phone)).filter(Boolean),
    );
    expect(enrollable.size).toBe(6);
  });
});

describe("opt-out / opt-in detection", () => {
  it("matches standalone stop commands", () => {
    for (const t of ["הסר", "הסירו אותי", "STOP", "unsubscribe", "עצור"]) expect(isOptOutMessage(t), t).toBe(true);
  });
  it("does not trip on normal sentences", () => {
    for (const t of ["אני לא רוצה להסיר את הכובע שלי היום", "רוצה לשאול על הטיולים לחול", ""])
      expect(isOptOutMessage(t), t).toBe(false);
  });
  it("recognizes opt-in", () => {
    expect(isOptInMessage("התחל")).toBe(true);
    expect(isOptInMessage("start")).toBe(true);
    expect(isOptInMessage("מתי מתחיל הטיול לאלבניה")).toBe(false);
  });
});

describe("offer sellability (all six filter paths)", () => {
  it("active + future dates is sellable", () => {
    expect(isOfferSellable({ status: "active", event_date: future, event_end_date: future })).toBe(true);
  });
  it("draft/archived is never sellable", () => {
    expect(isOfferSellable({ status: "draft", event_date: future, event_end_date: future })).toBe(false);
    expect(isOfferSellable({ status: "archived", event_date: future, event_end_date: future })).toBe(false);
  });
  it("null dates are NOT sellable and are flagged for review", () => {
    const o = { status: "active", event_date: null, event_end_date: null };
    expect(isOfferSellable(o)).toBe(false);
    expect(offerBucket(o)).toBe("needs_date_review");
  });
  it("past end date is not sellable", () => {
    const o = { status: "active", event_date: past, event_end_date: past };
    expect(isOfferSellable(o)).toBe(false);
    expect(offerBucket(o)).toBe("past");
  });
  it("validates and guards reactivation", () => {
    expect(validateOfferDates(null, future)).toBeTruthy();
    expect(validateOfferDates(future, future)).toBeNull();
    expect(validateReactivation(past, past)).toBeTruthy();
    expect(validateReactivation(future, future)).toBeNull();
  });
});
