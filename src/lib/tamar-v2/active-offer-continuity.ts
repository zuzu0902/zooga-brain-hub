/**
 * TAMAR V2 — ACTIVE OFFER CONTINUITY (PURE, no I/O).
 *
 * Production defect this repairs (phone ending 7833, London classic trip):
 * the context snapshot held a valid active offer, yet a referential follow-up
 * ("ומה יתרת התשלום? מה הסכום הכולל?") was answered with an offer
 * clarification listing London plus two unrelated Vietnam trips — and even an
 * explicit correction ("הייתי איתך בשיחה של הטיול ללונדון") did not recover.
 *
 * Rules:
 *   1. A valid active offer answers every referential follow-up.
 *   2. No broad search / clarification while a valid active offer exists,
 *      unless the customer explicitly asks for something else.
 *   3. An explicit destination/product in the CURRENT inbound anchors or
 *      switches the active offer deterministically.
 *   4. A corrective phrase ("דיברנו על לונדון") recovers that offer and
 *      acknowledges briefly.
 *   5. Clarification candidates only when there is NO valid active offer.
 */
import { scoreOffer, type OfferKnowledge, type OfferResolution } from "./offer-knowledge";

/** Referential follow-up: price, balance, total, dates, link, inclusions… */
const REFERENTIAL_FOLLOWUP_RE =
  /(הטיול|הטיסה|האירוע|הסדנה|ההצעה|זה|זו|זאת|אותו|אותה|עליו|עליה|מחיר|עולה|עלות|יתרה|יתרת|תשלום|לשלם|מקדמה|סכום|סה"?כ|סך\s*הכל|הכולל|תארי[ךכ]|מתי|יוצא|חוזר|קישור|לינק|להירשם|הרשמה|כלול|כולל|לא\s*כלול|נגיש|כיסא\s*גלגלים|מלון|חדר|טיסות)/i;

/** "דיברנו על…", "הייתי איתך בשיחה של…", "אמרתי לך על…" */
const CORRECTIVE_RE =
  /(דיברנו|שוחחנו|היינו\s+בשיחה|הייתי\s+איתך|אמרתי\s+ל[ךכ]|התכוונתי|מדברים\s+על|מדברת\s+על|מדבר\s+על)/i;

/** The customer explicitly wants something ELSE than the active offer. */
const EXPLICIT_OTHER_RE =
  /(משהו\s+אחר|יעד\s+אחר|טיול\s+אחר|אופציה\s+אחרת|הצעות\s+אחרות|מה\s+עוד\s+יש|אפשרויות\s+אחרות|תראי\s+לי\s+עוד|לא\s+מעניין\s+אותי\s+ה?טיול\s+הזה)/i;

export type ContinuityAction = "keep_active" | "switch_active" | "recover_active" | "no_active_offer";

export type ContinuityDecision = {
  action: ContinuityAction;
  reason: string;
  /** short Hebrew acknowledgement to prefix, only on a corrective recovery */
  acknowledgement: string | null;
  resolution: OfferResolution;
};

/** Strongest UNAMBIGUOUS explicit match from the current inbound only.
 *  Threshold 4 catches a named destination inside a title ("לונדון"),
 *  while a tie (two equally scored offers) is never treated as explicit. */
export function explicitOfferMention(
  message: string,
  offers: OfferKnowledge[],
): OfferKnowledge | null {
  const scored = offers
    .map((o) => ({ o, s: scoreOffer(message, o) }))
    .filter((x) => x.s >= 4)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  if (scored[1] && scored[1].s === scored[0]!.s) return null; // genuine tie
  return scored[0]!.o;
}

export function isReferentialFollowUp(message: string | null | undefined): boolean {
  return REFERENTIAL_FOLLOWUP_RE.test(String(message ?? ""));
}

export function isCorrectivePhrase(message: string | null | undefined): boolean {
  return CORRECTIVE_RE.test(String(message ?? ""));
}

export function wantsDifferentOffer(message: string | null | undefined): boolean {
  return EXPLICIT_OTHER_RE.test(String(message ?? ""));
}

function anchored(offer: OfferKnowledge, reason: OfferResolution["reason"], confidence: number): OfferResolution {
  return { offer, candidates: [offer], ambiguous: false, clarification: null, confidence, reason };
}

/**
 * Decide the offer for THIS turn given the authoritative active offer.
 * `resolution` is the existing (search-based) resolution and is only used
 * when there is no valid active offer and no explicit mention.
 */
export function applyActiveOfferContinuity(args: {
  message: string;
  /** authoritative active offer from the context snapshot / focus, if valid */
  activeOffer: OfferKnowledge | null;
  offers: OfferKnowledge[];
  resolution: OfferResolution;
}): ContinuityDecision {
  const { message, activeOffer, offers, resolution } = args;
  const explicit = explicitOfferMention(message, offers);
  const corrective = isCorrectivePhrase(message);

  if (explicit) {
    if (!activeOffer || explicit.id !== activeOffer.id) {
      return {
        action: corrective ? "recover_active" : "switch_active",
        reason: corrective ? "corrective_explicit_mention" : "explicit_offer_mention",
        acknowledgement: corrective ? `בטח, אנחנו מדברים על ${explicit.title}.` : null,
        resolution: anchored(explicit, "exact", 95),
      };
    }
    return {
      action: "keep_active",
      reason: "explicit_mention_matches_active",
      acknowledgement: corrective ? `בטח, אנחנו מדברים על ${activeOffer.title}.` : null,
      resolution: anchored(activeOffer, "exact", 95),
    };
  }

  if (activeOffer) {
    if (wantsDifferentOffer(message)) {
      return { action: "no_active_offer", reason: "customer_asked_for_other_options", acknowledgement: null, resolution };
    }
    if (corrective) {
      return {
        action: "recover_active",
        reason: "corrective_without_named_offer",
        acknowledgement: `בטח, אנחנו מדברים על ${activeOffer.title}.`,
        resolution: anchored(activeOffer, "context", 90),
      };
    }
    if (isReferentialFollowUp(message) || resolution.ambiguous || !resolution.offer) {
      return {
        action: "keep_active",
        reason: "referential_followup_on_active_offer",
        acknowledgement: null,
        resolution: anchored(activeOffer, "context", 88),
      };
    }
    return {
      action: "keep_active",
      reason: "active_offer_carried",
      acknowledgement: null,
      resolution: anchored(activeOffer, "context", 80),
    };
  }

  return { action: "no_active_offer", reason: "no_valid_active_offer", acknowledgement: null, resolution };
}
