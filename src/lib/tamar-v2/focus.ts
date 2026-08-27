/**
 * TAMAR V2 — authoritative active conversational focus (PURE, no I/O).
 *
 * ONE pointer decides what "הטיול", "הטיול עצמו", "מה המחיר" and
 * "אפשר להביא חברה" are about. It lives on the canonical contact record
 * (dynamic_profile_fields.v2_focus) — no parallel store.
 *
 * Focus may change ONLY when:
 *   1. the user explicitly names another offer/topic  (explicit_mention)
 *   2. a referential phrase is successfully resolved  (resolved_reference)
 *   3. the user explicitly resets the conversation     (reset -> cleared)
 *
 * Retrieving, ranking or displaying additional recommendations must NEVER
 * move the focus: that is exactly the production defect where a Baku answer
 * drifted into a Vietnam/60+ pointer.
 */

export const FOCUS_KEY = "v2_focus" as const;

export type FocusProvenance = "explicit_mention" | "resolved_reference" | "reset" | "none";

export type ActiveFocus = {
  topic: string | null;
  offer_id: string | null;
  provenance: FocusProvenance;
  updated_at: string | null;
};

export const EMPTY_FOCUS: ActiveFocus = {
  topic: null,
  offer_id: null,
  provenance: "none",
  updated_at: null,
};

export function readFocus(dyn: Record<string, any> | null | undefined): ActiveFocus {
  const raw = (dyn ?? {})[FOCUS_KEY];
  if (!raw || typeof raw !== "object") return { ...EMPTY_FOCUS };
  const provenance = String((raw as any).provenance ?? "none");
  return {
    topic: (raw as any).topic ? String((raw as any).topic).slice(0, 120) : null,
    offer_id: (raw as any).offer_id ? String((raw as any).offer_id) : null,
    provenance: (["explicit_mention", "resolved_reference", "reset", "none"] as string[]).includes(provenance)
      ? (provenance as FocusProvenance)
      : "none",
    updated_at: (raw as any).updated_at ? String((raw as any).updated_at) : null,
  };
}

/** Resolution reasons that represent a REAL user signal about which offer. */
const EXPLICIT_REASONS = new Set(["exact", "alias"]);
const REFERENCE_REASONS = new Set(["context"]);

export function nextFocus(args: {
  current: ActiveFocus;
  resetRequested?: boolean;
  /** the offer the turn actually grounded on, if any */
  resolvedOfferId?: string | null;
  resolvedTitle?: string | null;
  /** resolveOffer().reason */
  resolutionReason?: string | null;
  /** true only when this turn really was about a product */
  productAsked?: boolean;
  now?: string;
}): { focus: ActiveFocus; changed: boolean } {
  const at = args.now ?? new Date().toISOString();
  if (args.resetRequested) {
    const cleared: ActiveFocus = { topic: null, offer_id: null, provenance: "reset", updated_at: at };
    return { focus: cleared, changed: args.current.offer_id !== null || args.current.topic !== null };
  }

  const reason = String(args.resolutionReason ?? "none");
  const offerId = args.resolvedOfferId ? String(args.resolvedOfferId) : null;
  if (!args.productAsked || !offerId) return { focus: args.current, changed: false };

  // A carried-forward context resolution that lands on the SAME offer is not
  // a change — it is the focus doing its job.
  if (offerId === args.current.offer_id) {
    return {
      focus: { ...args.current, topic: args.resolvedTitle ?? args.current.topic, updated_at: at },
      changed: false,
    };
  }

  if (EXPLICIT_REASONS.has(reason)) {
    return {
      focus: { topic: args.resolvedTitle ?? null, offer_id: offerId, provenance: "explicit_mention", updated_at: at },
      changed: true,
    };
  }
  if (REFERENCE_REASONS.has(reason) && !args.current.offer_id) {
    // A reference can only ESTABLISH focus, never override an existing one.
    return {
      focus: { topic: args.resolvedTitle ?? null, offer_id: offerId, provenance: "resolved_reference", updated_at: at },
      changed: true,
    };
  }
  return { focus: args.current, changed: false };
}

/** Merge the focus back into a dynamic_profile_fields object (new object). */
export function withFocus(dyn: Record<string, any> | null | undefined, focus: ActiveFocus): Record<string, any> {
  const out = { ...(dyn ?? {}) };
  if (!focus.offer_id && !focus.topic && focus.provenance !== "reset") {
    delete out[FOCUS_KEY];
    return out;
  }
  out[FOCUS_KEY] = focus;
  return out;
}
