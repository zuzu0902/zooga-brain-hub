import { describe, it, expect } from "vitest";
import { normalizeContact } from "@/lib/hostinger-core/client";
import { contactDisplayName, contactMatchesSearch, compareContactNames } from "@/lib/hostinger-core/contact-search";

const kobi = normalizeContact({
  id: "2e794c2a-0c85-4b6f-bbe8-f909e6f65816",
  identity: { phone: "972512277533", first_name: "Kobi" },
  profile: {}, lifecycle: { status: "active" },
});

describe("contacts list search/display (Kobi fixture)", () => {
  it("displays first_name without translation", () => {
    expect(contactDisplayName(kobi)).toBe("Kobi");
    expect(contactDisplayName({ first_name: "A", last_name: "B" })).toBe("A B");
    expect(contactDisplayName({ full_name: "Full", first_name: "X" })).toBe("Full");
  });
  it("matches local and international phone forms", () => {
    for (const q of ["0512277533", "051-227-7533", "+972512277533", "972512277533"])
      expect(contactMatchesSearch(kobi, q), q).toBe(true);
  });
  it("keeps partial number and text search", () => {
    expect(contactMatchesSearch(kobi, "7533")).toBe(true);
    expect(contactMatchesSearch(kobi, "051-22")).toBe(true);
    expect(contactMatchesSearch(kobi, "kobi")).toBe(true);
    expect(contactMatchesSearch(kobi, "0539999999")).toBe(false);
    expect(contactMatchesSearch(kobi, "dana")).toBe(false);
  });
  it("is active lifecycle and visible with no search", () => {
    expect(kobi.status).toBe("active");
    expect(contactMatchesSearch(kobi, "")).toBe(true);
  });
  it("sorts by combined name", () => {
    const list = [kobi, { full_name: "Avi" }].sort(compareContactNames);
    expect(contactDisplayName(list[0])).toBe("Avi");
  });
});
