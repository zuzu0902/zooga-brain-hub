/**
 * OUTBOUND GROUNDING GUARD (PURE).
 *
 * Two product rules of the pilot journey are enforced here, at the last
 * moment before an envelope is sent:
 *   1. "Perks" are a FUTURE benefit — Tamar may not promise or describe a
 *      specific perk until it is configured as a real, grounded offer.
 *   2. Every link Tamar sends must be a verified link that came from the
 *      grounded product/offer record. Nothing else may be sent.
 */
export type GroundingContext = {
  /** verified URLs from the grounded offer/product records */
  allowedUrls: string[];
  /** perk names that exist as real, configured offers */
  groundedPerks?: string[];
};

export type GroundingResult = { text: string; violations: string[] };

const URL_RE = /https?:\/\/[^\s<>()"'\u0590-\u05FF]+/g;
const PERK_RE = /(הטבה|הטבות|קופון|מתנה|הנחה מיוחדת|הנחת חבר|perk|voucher)/i;

function canonicalUrl(url: string): string {
  return String(url ?? "")
    .trim()
    .replace(/[.,;:)]+$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function isVerifiedLink(url: string, allowedUrls: string[]): boolean {
  const target = canonicalUrl(url);
  if (!target) return false;
  return allowedUrls.some((a) => canonicalUrl(a) === target);
}

/** Split into sentences while keeping Hebrew punctuation readable. */
function sentences(text: string): string[] {
  return String(text ?? "")
    .split(/(?<=[.!?\n])\s+/)
    .filter((s) => s.trim().length > 0);
}

/**
 * Remove unverified links and ungrounded perk promises. Never rewrites the
 * rest of the message — a grounded, on-topic answer passes through untouched.
 */
export function sanitizeGrounding(text: string, ctx: GroundingContext): GroundingResult {
  const violations: string[] = [];
  const grounded = (ctx.groundedPerks ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean);

  const kept = sentences(text).filter((sentence) => {
    const urls = sentence.match(URL_RE) ?? [];
    const badUrl = urls.find((u) => !isVerifiedLink(u, ctx.allowedUrls));
    if (badUrl) {
      violations.push("unverified_link");
      return false;
    }
    if (PERK_RE.test(sentence)) {
      const isGrounded = grounded.some((p) => sentence.toLowerCase().includes(p));
      if (!isGrounded) {
        violations.push("ungrounded_perk");
        return false;
      }
    }
    return true;
  });

  const out = kept.join(" ").replace(/\s+/g, " ").trim();
  return { text: out, violations };
}

/** True when nothing survived sanitation and the caller must not send. */
export function groundingBlocked(result: GroundingResult): boolean {
  return result.violations.length > 0 && result.text.length === 0;
}
