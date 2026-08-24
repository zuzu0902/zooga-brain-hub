/**
 * Server-side media fetch with strict limits.
 * Batch scope: images only (documented in README). Nothing is written to disk.
 */

export const ALLOWED_MEDIA_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

export type MediaFetchResult =
  | { ok: true; buffer: Buffer; mimeType: string }
  | { ok: false; code: string; status: number };

export async function fetchMedia(
  url: string,
  limits: { maxBytes: number; timeoutMs: number },
  fetchImpl: typeof fetch = fetch,
): Promise<MediaFetchResult> {
  if (!/^https:\/\//i.test(url)) return { ok: false, code: "media_url_must_be_https", status: 400 };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    const res = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: ALLOWED_MEDIA_MIME.join(",") },
    });
    if (!res.ok) return { ok: false, code: "media_fetch_failed", status: 400 };

    const mimeType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!(ALLOWED_MEDIA_MIME as readonly string[]).includes(mimeType)) {
      return { ok: false, code: "media_mime_not_allowed", status: 415 };
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > limits.maxBytes) {
      return { ok: false, code: "media_too_large", status: 413 };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0) return { ok: false, code: "media_empty", status: 400 };
    if (buffer.byteLength > limits.maxBytes) return { ok: false, code: "media_too_large", status: 413 };
    return { ok: true, buffer, mimeType };
  } catch {
    return { ok: false, code: "media_fetch_failed", status: 400 };
  } finally {
    clearTimeout(timer);
  }
}
