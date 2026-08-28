/**
 * TAMAR V2 — active-offer continuity (pure rules).
 *
 * Production sequence (phone ending 7833): the London classic trip was the
 * active offer, yet a balance/total follow-up produced an offer clarification
 * listing London plus two Vietnam trips, and an explicit correction did not
 * recover. These rules make that impossible.
 */
import { describe, expect, it } from "vitest";
import {
  applyActiveOfferContinuity,
  explicitOfferMention,
  isCorrectivePhrase,
  isReferentialFollowUp,
} from "@/lib/tamar-v2/active-offer-continuity";
import type { OfferKnowledge, OfferResolution } from "@/lib/tamar-v2/offer-knowledge";

const LONDON_ID = "872132b7-b8e2-4265-8f1e-a1011a3b2f7b";

const offer = (id: string, title: string): OfferKnowledge =>
  ({
    id,
    title,
    offer_url: `https://www.zooga.co.il/${id}`,
    category: "trip",
    status: "active",
    matching_tags: [],
    grounded_facts: {},
    faq_bundle: [],
    included: [],
    not_included: [],
  }) as unknown as OfferKnowledge;

const london = offer(LONDON_ID, "הטיול הקלאסי - לונדון");
const vietnam1 = offer("vn-1", "טיול לוייטנאם");
const vietnam2 = offer("vn-2", "טיול לוייטנאם לבני 60 פלוס");
const offers = [london, vietnam1, vietnam2];

const ambiguous: OfferResolution = {
  offer: null,
  candidates: offers,
  ambiguous: true,
  clarification: "רק שאדע במדויק על מה לספר — הטיול הקלאסי - לונדון או טיול לוייטנאם?",
  confidence: 40,
  reason: "ambiguous",
};

describe("a valid active offer answers referential follow-ups", () => {
  it("balance / total question never triggers clarification or other candidates", () => {
    const d = applyActiveOfferContinuity({
      message: "ומה יתרת התשלום? מה הסכום הכולל של הטיול? כמה עולה לי כל הטיול.",
      activeOffer: london,
      offers,
      resolution: ambiguous,
    });
    expect(d.action).toBe("keep_active");
    expect(d.resolution.ambiguous).toBe(false);
    expect(d.resolution.clarification).toBeNull();
    expect(d.resolution.offer?.id).toBe(LONDON_ID);
    expect(JSON.stringify(d.resolution)).not.toContain("וייטנאם");
  });

  it("recognises the referential vocabulary of the production turn", () => {
    expect(isReferentialFollowUp("ומה יתרת התשלום?")).toBe(true);
    expect(isReferentialFollowUp("מה הסכום הכולל של הטיול?")).toBe(true);
    expect(isReferentialFollowUp("יש נגישות לכיסא גלגלים?")).toBe(true);
    expect(isReferentialFollowUp("שלח לי את הקישור להרשמה")).toBe(true);
  });
});

describe("corrective recovery", () => {
  it("'הייתי איתך בשיחה של הטיול ללונדון' recovers London and acknowledges", () => {
    const d = applyActiveOfferContinuity({
      message: "הייתי איתך בשיחה של הטיול ללונדון, על זה אני שואל",
      activeOffer: null,
      offers,
      resolution: ambiguous,
    });
    expect(isCorrectivePhrase("הייתי איתך בשיחה של הטיול ללונדון")).toBe(true);
    expect(d.action).toBe("recover_active");
    expect(d.resolution.offer?.id).toBe(LONDON_ID);
    expect(d.acknowledgement).toContain("לונדון");
    expect(String(d.acknowledgement)).not.toContain("וייטנאם");
  });

  it("a corrective phrase without a named offer keeps the active offer", () => {
    const d = applyActiveOfferContinuity({
      message: "דיברנו על זה קודם",
      activeOffer: london,
      offers,
      resolution: ambiguous,
    });
    expect(d.action).toBe("recover_active");
    expect(d.resolution.offer?.id).toBe(LONDON_ID);
  });
});

describe("explicit topic switch still works", () => {
  it("naming a real other destination replaces the active offer", () => {
    const d = applyActiveOfferContinuity({
      message: "בעצם מעניין אותי טיול לוייטנאם לבני 60 פלוס",
      activeOffer: london,
      offers,
      resolution: ambiguous,
    });
    expect(d.action).toBe("switch_active");
    expect(d.resolution.offer?.id).toBe("vn-2");
    expect(d.resolution.reason).toBe("exact");
  });

  it("asking for other options releases the active offer to normal search", () => {
    const d = applyActiveOfferContinuity({
      message: "מה עוד יש?",
      activeOffer: london,
      offers,
      resolution: ambiguous,
    });
    expect(d.action).toBe("no_active_offer");
    expect(d.resolution).toBe(ambiguous);
  });

  it("clarification candidates are allowed only without a valid active offer", () => {
    const d = applyActiveOfferContinuity({
      message: "כמה עולה הטיול?",
      activeOffer: null,
      offers,
      resolution: ambiguous,
    });
    expect(d.action).toBe("no_active_offer");
    expect(d.resolution.ambiguous).toBe(true);
  });

  it("a genuine tie is not treated as an explicit mention", () => {
    expect(explicitOfferMention("טיול לוייטנאם", [vietnam1, offer("vn-3", "טיול לוייטנאם")])).toBeNull();
  });
});
