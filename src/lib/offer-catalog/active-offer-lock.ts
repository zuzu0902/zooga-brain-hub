/**
 * ACTIVE OFFER LOCK RULES (PURE).
 *
 * The locked offer survives follow-ups and complaints. It changes ONLY on an
 * explicit new destination/time intent with a confident catalog match, or when
 * the offer stops being sellable. A complaint that merely MENTIONS a product
 * or a month ("למה שלחת לי אוקטובר") can never switch the lock.
 * No confident match => ask one clarification, never guess.
 */
import type { MatchResult } from "./match";
import type { ActiveOffer } from "./active-offer";

export type LockDecision = {
  offer_id: string | null;
  action: "keep" | "set" | "release" | "clarify" | "none";
  reason: string;
  clarification: string | null;
};

const COMPLAINT_RE =
  /(למה\s*שלחת|למה\s*שלחתם|לא\s*ביקשתי|טעות|לא\s*רלוונטי|מעצבן|לא\s*מתאים|תפסיק(י|ו)?|כבר\s*אמרתי|why\s*did\s*you\s*send)/i;

export function isComplaint(text: string | null | undefined): boolean {
  return COMPLAINT_RE.test(String(text ?? ""));
}

export function resolveActiveOfferLock(args: {
  active: ActiveOffer | null;
  match: MatchResult;
  message: string;
  /** ids currently sellable in the canonical catalog */
  sellableOfferIds: string[];
}): LockDecision {
  const { active, match } = args;
  const sellable = new Set(args.sellableOfferIds ?? []);
  const complaint = isComplaint(args.message);

  // fail closed: a locked offer that is no longer sellable is dropped
  if (active && !sellable.has(active.offer_id)) {
    return { offer_id: null, action: "release", reason: "active_offer_not_sellable", clarification: null };
  }

  if (complaint) {
    return active
      ? { offer_id: active.offer_id, action: "keep", reason: "complaint_never_switches_lock", clarification: null }
      : { offer_id: null, action: "none", reason: "complaint_without_active_offer", clarification: null };
  }

  if (match.status === "match" && match.offer_id && sellable.has(match.offer_id)) {
    if (active && active.offer_id === match.offer_id) {
      return { offer_id: active.offer_id, action: "keep", reason: "same_offer", clarification: null };
    }
    // an explicit destination is required to switch an existing lock
    if (active && !match.intent.destinations.length) {
      return { offer_id: active.offer_id, action: "keep", reason: "no_explicit_destination", clarification: null };
    }
    return {
      offer_id: match.offer_id,
      action: "set",
      reason: active ? "explicit_topic_shift" : "first_confident_match",
      clarification: null,
    };
  }

  if (match.status === "ambiguous") {
    return {
      offer_id: active?.offer_id ?? null,
      action: "clarify",
      reason: "ambiguous_match",
      clarification: match.clarification,
    };
  }

  if (active) {
    return { offer_id: active.offer_id, action: "keep", reason: "kept_across_turn", clarification: null };
  }
  return { offer_id: null, action: "none", reason: "no_match_no_active", clarification: null };
}