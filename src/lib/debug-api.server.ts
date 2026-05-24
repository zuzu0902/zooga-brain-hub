/**
 * INTERNAL READ-ONLY DEBUG API HELPERS
 *
 * These helpers back the /api/debug/* routes. The entire debug surface is:
 *   - TEMPORARY and INTERNAL — not part of any public product contract
 *   - STRICTLY READ-ONLY — GET-only, no writes, no mutations, no side effects
 *   - GATED by the DEBUG_READ_ONLY_TOKEN env var sent via the
 *     `x-debug-token` request header
 *   - SAFE BY DEFAULT — never returns secrets, service-role keys, full PII,
 *     raw message bodies, or auth credentials. Only summaries, counts,
 *     redacted samples, feature flags, and config snapshots.
 *
 * If you add a new endpoint, keep these invariants intact.
 */

export function checkDebugAuth(request: Request): Response | null {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method Not Allowed" }, 405, { Allow: "GET" });
  }
  const expected = process.env.DEBUG_READ_ONLY_TOKEN;
  const provided = request.headers.get("x-debug-token");
  if (!expected || !provided || provided !== expected) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return null;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function redactPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 3) return "***";
  return `***${digits.slice(-2)}`;
}

export function redactEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const m = String(email).match(/^(.)([^@]*)@(.+)$/);
  if (!m) return "***";
  return `${m[1]}***@${m[3]}`;
}

export function redactText(
  text: string | null | undefined,
  max = 40,
): string | null {
  if (!text) return null;
  const s = String(text).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function presence(value: string | null | undefined): {
  present: boolean;
  length: number;
} {
  const v = value ?? "";
  return { present: !!v, length: v.length };
}