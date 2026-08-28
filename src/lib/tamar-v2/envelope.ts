import { sanitizeGrounding } from "@/lib/tamar-pilot/grounding";
/**
 * TAMAR BRAIN V2 — outbound envelope policy (PURE, no I/O).
 *
 * Rules enforced here, at the send boundary:
 *   1. Exactly ONE outbound WhatsApp envelope per inbound message by default.
 *   2. Every segment is signature-deduplicated against the same turn AND
 *      against recent history — not only `messages[0]`.
 *   3. A message may only be split when it exceeds the hard WhatsApp text
 *      limit; each split part is independently deduplicated.
 */
import { questionSignature, semanticallyEquivalent } from "@/lib/conversation-guard/core";
import type { OutboundMessage } from "./types";

/** WhatsApp hard body limit (4096); we stay comfortably below it. */
export const MAX_BODY = 3800;

export function segmentSignature(m: OutboundMessage): string {
  return questionSignature(m.body);
}

/**
 * Drop segments that repeat something already in this turn or already sent
 * recently. Returns the kept list plus the dropped signatures (audit).
 */
export function dedupeSegments(
  messages: OutboundMessage[],
  recentSignatures: string[] = [],
): { kept: OutboundMessage[]; dropped: Array<{ signature: string; reason: string }> } {
  const kept: OutboundMessage[] = [];
  const seen: string[] = [];
  const dropped: Array<{ signature: string; reason: string }> = [];
  for (const m of messages) {
    const body = String(m.body ?? "").trim();
    if (!body) continue;
    const sig = segmentSignature(m);
    if (seen.some((s) => s === sig || semanticallyEquivalent(s, sig))) {
      dropped.push({ signature: sig, reason: "same_turn_duplicate" });
      continue;
    }
    if (recentSignatures.some((s) => s === sig || semanticallyEquivalent(s, sig))) {
      dropped.push({ signature: sig, reason: "recent_history_duplicate" });
      continue;
    }
    seen.push(sig);
    kept.push(m);
  }
  return { kept, dropped };
}

function splitBody(body: string, limit = MAX_BODY): string[] {
  if (body.length <= limit) return [body];
  const parts: string[] = [];
  let rest = body;
  while (rest.length > limit) {
    const cut = rest.lastIndexOf("\n", limit);
    const at = cut > limit * 0.5 ? cut : limit;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Collapse the decision segments into ONE envelope.
 *
 * - all-text        -> one text message
 * - text + one interactive -> the text is merged into the interactive body,
 *                             so the question still travels with its answer
 * - >1 interactive  -> the FIRST interactive wins, the rest is merged as text
 *   (WhatsApp cannot deliver two interactive payloads in one envelope)
 */
export function toSingleEnvelope(messages: OutboundMessage[], limit = MAX_BODY): OutboundMessage[] {
  const list = messages.filter((m) => String(m.body ?? "").trim());
  if (list.length <= 1) return list;

  const interactive = list.find((m) => m.kind !== "text") as Extract<OutboundMessage, { kind: "buttons" | "list" }> | undefined;
  const bodies = list.map((m) => String(m.body).trim());
  const merged = bodies.join("\n\n");

  if (interactive) {
    // the interactive body must be LAST so the buttons refer to it
    const others = list.filter((m) => m !== interactive).map((m) => String(m.body).trim());
    const body = [...others, String(interactive.body).trim()].join("\n\n");
    if (body.length <= limit) return [{ ...interactive, body }];
    // too long: keep the interactive intact, prepend the rest as text parts
    return [
      ...splitBody(others.join("\n\n"), limit).map((b) => ({ kind: "text", body: b }) as OutboundMessage),
      interactive,
    ];
  }

  return splitBody(merged, limit).map((b) => ({ kind: "text", body: b }) as OutboundMessage);
}

/**
 * Final outbound plan: dedupe -> single envelope -> dedupe again (a split
 * can only ever produce distinct parts, but the invariant is cheap to keep).
 */
export function planOutbound(args: {
  messages: OutboundMessage[];
  recentSignatures?: string[];
  /** hard exception: an explicitly documented multi-send action */
  allowMultiple?: boolean;
  /** verified links + grounded perks; when given, ungrounded content is stripped */
  grounding?: { allowedUrls: string[]; groundedPerks?: string[] };
}): { messages: OutboundMessage[]; dropped: Array<{ signature: string; reason: string }> } {
  const first = dedupeSegments(args.messages, args.recentSignatures ?? []);
  const base = args.allowMultiple ? first.kept : toSingleEnvelope(first.kept);
  const second = args.allowMultiple ? { kept: base, dropped: [] as Array<{ signature: string; reason: string }> } : dedupeSegments(base, []);
  const dropped = [...first.dropped, ...second.dropped];
  if (!args.grounding) return { messages: second.kept, dropped };

  // Last-moment product guard: never send an unverified link, never promise a
  // perk that is not a real configured offer.
  const kept: OutboundMessage[] = [];
  for (const m of second.kept) {
    if (m.kind !== "text") {
      kept.push(m);
      continue;
    }
    const res = sanitizeGrounding(String((m as any).body ?? ""), args.grounding);
    if (!res.violations.length) {
      kept.push(m);
      continue;
    }
    if (res.text) kept.push({ ...(m as any), body: res.text });
    dropped.push({ signature: segmentSignature(m), reason: `grounding:${res.violations.join("|")}` });
  }
  return { messages: kept, dropped };
}

