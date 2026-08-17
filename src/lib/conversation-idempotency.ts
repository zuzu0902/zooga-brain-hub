/**
 * ONE OWNER, ONE REPLY (PURE).
 *
 * Every inbound is processed once per route, and only ONE route owns the
 * outbound send for a given provider message. Keys are deterministic so the
 * same inbound always produces the same dedupe key on every route.
 */
export type Route = "live" | "lite" | "manual";

/** Per-route processing key: each route may process an inbound exactly once. */
export function inboundProcessKey(providerMessageId: string, route: Route): string {
  return `${route}:${providerMessageId}`;
}

/** Deterministic outbound dedupe key — identical input, identical key. */
export function outboundKey(args: {
  providerMessageId: string;
  kind: string;
  suffix?: string | null;
  correlationId?: string | null;
}): string {
  return [args.providerMessageId, args.kind, args.suffix ?? "", args.correlationId ?? ""]
    .filter(Boolean)
    .join(":");
}

/**
 * Exactly one sender owner. Lite may only own the send when it runs live and
 * the kill switch is off; otherwise the legacy engine keeps ownership.
 */
export function senderOwner(args: { liteMode: "shadow" | "live"; killSwitch: boolean }): Route {
  return args.liteMode === "live" && !args.killSwitch ? "lite" : "live";
}

export function maySend(route: Route, args: { liteMode: "shadow" | "live"; killSwitch: boolean }): boolean {
  return senderOwner(args) === route;
}

/**
 * A route processes an inbound once, regardless of whether another route
 * already answered it. Shadow analysis must never be skipped because the live
 * engine replied first.
 */
export function shouldProcessInbound(args: {
  providerMessageId: string;
  route: Route;
  processedKeys: Iterable<string>;
}): boolean {
  const key = inboundProcessKey(args.providerMessageId, args.route);
  for (const k of args.processedKeys) if (k === key) return false;
  return true;
}