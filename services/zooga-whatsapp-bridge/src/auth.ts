/** Constant-time bearer authentication for every endpoint except /health. */
import { timingSafeEqual } from "node:crypto";

export function extractBearer(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match || !match[1]) return null;
  return match[1];
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // still burn a comparison to keep timing flat
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function isAuthorized(header: string | undefined | null, apiKey: string): boolean {
  const token = extractBearer(header);
  if (!token || !apiKey) return false;
  return safeEqual(token, apiKey);
}
