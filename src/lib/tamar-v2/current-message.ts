/**
 * TAMAR V2 — LAST-INBOUND AUTHORITY (PURE, no I/O).
 *
 * The current inbound message (text, or the successfully transcribed and
 * normalized voice transcript) is the ONLY source of intent for the turn.
 * Prior turns remain bounded context and active-offer facts — they may never
 * supply the question being answered.
 *
 * Production evidence: a voice question about price + itinerary was answered
 * with the "travelling alone" policy taken from an older turn.
 */

export type CurrentMessageSource = "text" | "voice_transcript";

export type CurrentMessage = {
  /** the exact text the turn must reason about */
  text: string;
  /** verbatim inbound before normalization (audit) */
  raw: string;
  source: CurrentMessageSource;
  /** provider message id — idempotency + audit only, never intent */
  id: string | null;
};

/** Resolve the single authoritative message for this turn. */
export function resolveCurrentMessage(args: {
  rawText: string;
  normalizedText?: string | null;
  source?: string | null;
  inboundMessageId?: string | null;
}): CurrentMessage {
  const raw = String(args.rawText ?? "").trim();
  const normalized = String(args.normalizedText ?? "").trim();
  const isVoice = String(args.source ?? "").includes("voice");
  return {
    text: normalized || raw,
    raw,
    source: isVoice ? "voice_transcript" : "text",
    id: args.inboundMessageId ?? null,
  };
}

const PRICE_RE = /(כמה\s*עולה|מחיר|עלות|כמה\s*זה|תשלום|לשלם)/;
const ROUTE_RE = /(מסלול|תוכנית\s*הטיול|לו״ז|לוז|איטינררי|יעדים|תכנית)/;
const LINK_RE = /(קישור|לינק|https?:\/\/|להירשם|הרשמה)/;

/**
 * Does the CURRENT message itself ask for price / itinerary / link?
 * Such a turn may never be answered with a topic carried from an older turn.
 */
export function currentProductAsk(message: string): {
  price: boolean;
  route: boolean;
  link: boolean;
  any: boolean;
} {
  const m = String(message ?? "");
  const price = PRICE_RE.test(m);
  const route = ROUTE_RE.test(m);
  const link = LINK_RE.test(m);
  return { price, route, link, any: price || route || link };
}
