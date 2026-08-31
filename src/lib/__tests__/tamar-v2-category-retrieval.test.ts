/**
 * Canonical understanding + retrieval (category is a HARD constraint).
 *
 * Production defect: "אני מחפש הרצאות" returned Dubai/Vietnam trips and the
 * follow-up "על מה ההרצאות האלה?" returned a generic intake question.
 */
import { describe, expect, it } from "vitest";
import {
  buildCategoryDetailText,
  buildCategoryListText,
  buildNoMatchText,
  classifyOffer,
  extractCategory,
  readCategoryFocus,
  resolveCategoryTurn,
  retrieveByCategory,
  withCategoryFocus,
  type InventoryOffer,
} from "@/lib/tamar-v2/category-retrieval";

const LECTURE_META: InventoryOffer = {
  id: "lec-1",
  title: "הרצאה: זוגיות אחרי 50",
  category: "הרצאה",
  ai_summary: "ערב הרצאה עם פסיכולוגית",
  offer_url: "https://www.zooga.co.il/lecture-50",
};
// metadata missing / wrong — content must still classify it
const LECTURE_CONTENT: InventoryOffer = {
  id: "lec-2",
  title: "ערב עם ד״ר כהן",
  category: null,
  description: "הרצאה מרתקת על תקשורת בין אישית, המרצה ד״ר כהן",
  offer_url: "https://www.zooga.co.il/cohen",
};
const DUBAI: InventoryOffer = {
  id: "trip-dubai",
  title: "טיול לדובאי",
  category: "טיול",
  ai_summary: "5 לילות בדובאי",
  nights: 5,
  offer_url: "https://www.zooga.co.il/dubai",
};
const VIETNAM: InventoryOffer = {
  id: "trip-vietnam",
  title: "וייטנאם",
  category: null,
  description: "מסע בן 12 ימים כולל טיסות ומלונות",
  nights: 12,
  flights_included: true,
  offer_url: "https://www.zooga.co.il/vietnam",
};
const INVENTORY = [DUBAI, LECTURE_META, VIETNAM, LECTURE_CONTENT];

describe("A. category request retrieves only that category", () => {
  it("'אני מחפש הרצאות' returns lectures only, never Dubai/Vietnam", () => {
    const turn = resolveCategoryTurn({ message: "אני מחפש הרצאות", focus: readCategoryFocus({}) });
    expect(turn.category).toBe("lecture");
    const r = retrieveByCategory({ category: "lecture", offers: INVENTORY });
    expect(r.candidate_offer_ids.sort()).toEqual(["lec-1", "lec-2"]);
    const body = buildCategoryListText(r);
    expect(body).not.toContain("דובאי");
    expect(body).not.toContain("וייטנאם");
    expect(body).toContain("הרצאות");
  });
});

describe("B. follow-up resolves to the previously presented set", () => {
  it("'על מה ההרצאות האלה?' answers about the stored lecture ids", () => {
    const dyn = withCategoryFocus(
      {},
      { category: "lecture", offer_ids: ["lec-1", "lec-2"], source: "explicit_message", updated_at: "now" },
    );
    const turn = resolveCategoryTurn({ message: "על מה ההרצאות האלה?", focus: readCategoryFocus(dyn) });
    expect(turn.category).toBe("lecture");
    const r = retrieveByCategory({
      category: turn.category!,
      offers: INVENTORY,
      restrictToIds: turn.restrict_ids,
    });
    expect(r.candidate_offer_ids.sort()).toEqual(["lec-1", "lec-2"]);
    const body = buildCategoryDetailText(r);
    expect(body).toContain("ד״ר כהן");
    expect(body).not.toContain("דובאי");
  });

  it("a bare anaphoric follow-up with no focus resolves to nothing", () => {
    const turn = resolveCategoryTurn({ message: "על מה אלה?", focus: readCategoryFocus({}) });
    expect(turn.category).toBeNull();
  });
});

describe("C. incomplete metadata still retrieved from content", () => {
  it("classifies a lecture from title/description when category is missing", () => {
    const k = classifyOffer(LECTURE_CONTENT);
    expect(k.category).toBe("lecture");
    expect(k.source).toBe("content");
    const r = retrieveByCategory({ category: "lecture", offers: [DUBAI, LECTURE_CONTENT] });
    expect(r.candidate_offer_ids).toEqual(["lec-2"]);
    expect(r.inventory_fallback_used).toBe(true);
  });
});

describe("D. no match is explicit, never an unrelated fallback", () => {
  it("returns a no-match reason and no other offers", () => {
    const r = retrieveByCategory({ category: "lecture", offers: [DUBAI, VIETNAM] });
    expect(r.candidate_offer_ids).toEqual([]);
    expect(r.no_match_reason).toBe("no_offer_in_category");
    const body = buildNoMatchText("lecture");
    expect(body).toContain("אין לנו הרצאות");
    expect(body).not.toContain("דובאי");
    expect(body).not.toContain("וייטנאם");
  });
  it("distinguishes an empty inventory", () => {
    expect(retrieveByCategory({ category: "trip", offers: [] }).no_match_reason).toBe("empty_inventory");
  });
});

describe("E/F. other categories and deterministic switching", () => {
  it("'אני מחפש טיולים' retrieves trips only", () => {
    const turn = resolveCategoryTurn({ message: "אני מחפש טיולים", focus: readCategoryFocus({}) });
    expect(turn.category).toBe("trip");
    const r = retrieveByCategory({ category: "trip", offers: INVENTORY });
    expect(r.candidate_offer_ids.sort()).toEqual(["trip-dubai", "trip-vietnam"]);
  });

  it("an explicit switch from lectures to trips changes focus deterministically", () => {
    const dyn = withCategoryFocus(
      {},
      { category: "lecture", offer_ids: ["lec-1"], source: "explicit_message", updated_at: "now" },
    );
    const turn = resolveCategoryTurn({ message: "ומה עם טיולים?", focus: readCategoryFocus(dyn) });
    expect(turn.category).toBe("trip");
    expect(turn.followup).toBe(false);
    expect(turn.reasons).toContain("category_switch");
  });

  it("covers the remaining Hebrew category families and inflections", () => {
    expect(extractCategory("יש סדנאות?").category).toBe("workshop");
    expect(extractCategory("מתי המסיבה הבאה").category).toBe("party");
    expect(extractCategory("כמה עולה המנוי").category).toBe("membership");
    expect(extractCategory("אילו אירועים יש").category).toBe("event");
    expect(extractCategory("מה שלומך").category).toBeNull();
  });
});

describe("H. voice and text use the same extraction path", () => {
  it("a normalized transcript extracts the same category", () => {
    const text = extractCategory("אני מחפש הרצאות");
    const voice = extractCategory("אני מחפש הרצאות בבקשה");
    expect(voice.category).toBe(text.category);
    expect(voice.confidence).toBeGreaterThan(0.5);
  });
});
