/**
 * TAMAR V2 — FINAL SEMANTIC RESPONSE GUARD (PURE, no I/O).
 *
 * Runs on the composed response BEFORE send. Every product/offer/link named
 * in the text must be allowed by the selected action and grounded in the
 * chosen offer(s). If the active offer is London and the action is `answer`,
 * any Dubai/Vietnam/catalog leakage is rejected.
 *
 * The guard NEVER repairs by appending text. The caller regenerates once
 * within the SAME selected action, and otherwise falls back to a concise safe
 * answer produced by dropping the offending lines.
 */
import type { ResponseAction } from "./response-orchestrator";

export type GuardCatalogEntry = { id: string; title: string; url?: string | null };

export type GuardResult = {
  ok: boolean;
  /** offer ids whose mention is not allowed by the selected action */
  violations: string[];
  reason_codes: string[];
};

const STOPWORDS = new Set([
  "טיול",
  "טיולים",
  "אירוע",
  "אירועים",
  "חופשה",
  "הטיול",
  "קלאסי",
  "הקלאסי",
  "לבני",
  "פלוס",
  "זוגה",
  "מיוחד",
  "חדש",
]);

/** Strip Hebrew attached prefixes so "לוייטנאם" matches "וייטנאם". */
function stripPrefix(token: string): string {
  return token.replace(/^(ול|וב|ומ|כשה|שה|וה|ל|ב|מ|ה|ו|ש|כ)/, "");
}

function tokens(text: string): string[] {
  return String(text ?? "")
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => stripPrefix(t.trim()))
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/** Distinctive tokens of an offer title (destination-like words). */
export function offerSignals(title: string): string[] {
  return Array.from(new Set(tokens(title)));
}

export function guardResponse(args: {
  text: string;
  action: ResponseAction;
  /** offer ids the selected action is allowed to talk about */
  allowedOfferIds: string[];
  catalog: GuardCatalogEntry[];
}): GuardResult {
  const text = String(args.text ?? "");
  if (!text.trim()) return { ok: false, violations: [], reason_codes: ["guard_empty_response"] };

  // A recommendation action is allowed to name several catalog offers.
  if (args.action === "recommend_products") {
    return { ok: true, violations: [], reason_codes: ["guard_recommend_allowed"] };
  }

  const allowed = new Set(args.allowedOfferIds.filter(Boolean).map(String));
  const bodyTokens = new Set(tokens(text));
  const violations: string[] = [];

  for (const offer of args.catalog) {
    const id = String(offer.id);
    if (allowed.has(id)) continue;
    const url = String(offer.url ?? "");
    const urlLeak = !!url && text.includes(url);
    const signals = offerSignals(offer.title).filter(
      (s) => !args.catalog.some((o) => allowed.has(String(o.id)) && offerSignals(o.title).includes(s)),
    );
    const titleLeak = signals.some((s) => bodyTokens.has(s));
    if (urlLeak || titleLeak) violations.push(id);
  }

  return {
    ok: violations.length === 0,
    violations,
    reason_codes: violations.length ? [`guard_offer_leakage_${violations.length}`] : ["guard_clean"],
  };
}

/**
 * Concise safe answer: drop the offending lines. Removal only — never an
 * appended repair.
 */
export function stripLeakedLines(args: {
  text: string;
  allowedOfferIds: string[];
  catalog: GuardCatalogEntry[];
}): string {
  const allowed = new Set(args.allowedOfferIds.filter(Boolean).map(String));
  const banned = args.catalog.filter((o) => !allowed.has(String(o.id)));
  const bannedSignals = new Set(
    banned.flatMap((o) => offerSignals(o.title)).filter(
      (s) => !args.catalog.some((o) => allowed.has(String(o.id)) && offerSignals(o.title).includes(s)),
    ),
  );
  const bannedUrls = banned.map((o) => String(o.url ?? "")).filter(Boolean);

  const kept = String(args.text ?? "")
    .split("\n")
    .filter((line) => {
      if (bannedUrls.some((u) => line.includes(u))) return false;
      return !tokens(line).some((t) => bannedSignals.has(t));
    })
    .join("\n")
    .trim();
  return kept;
}
