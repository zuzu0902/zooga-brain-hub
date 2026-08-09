/**
 * ZERO-LOSS CORE — pure, dependency-free helpers shared by the ingestion
 * runtime, the workers and the tests. No Supabase, no secrets, no I/O.
 */

export type ZlEventKind = "message" | "status" | "unknown";

export type ZlSplitEvent = {
  kind: ZlEventKind;
  event_type: string;
  provider_event_id: string | null;
  phone: string | null;
  raw: unknown;
};

export const QUARANTINE_REASONS = [
  "invalid_phone",
  "unknown_event_shape",
  "contact_resolution_failed",
  "processing_exception",
  "transcription_failed",
  "ai_failed",
  "delivery_mapping_failed",
  "orphaned_message",
] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

/** Normalize a raw MSISDN to E.164. Mirrors whatsapp-meta.server.toE164. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

/** UI/log safe rendering of a phone: only the last 4 digits survive. */
export function maskPhone(raw: string | null | undefined): string | null {
  const e164 = normalizePhone(raw);
  if (!e164) return raw ? "***" : null;
  return "***" + e164.slice(-4);
}

/** Mask any uuid-ish id for display: keep the first 8 chars. */
export function maskId(id: string | null | undefined): string | null {
  if (!id) return null;
  return String(id).slice(0, 8) + "…";
}

/**
 * Split one Meta webhook envelope into individually durable units. Anything
 * we cannot classify still produces an `unknown` unit — it is stored and
 * quarantined, never dropped.
 */
export function splitMetaEvents(payload: any): ZlSplitEvent[] {
  const out: ZlSplitEvent[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (!value || typeof value !== "object") {
        out.push({ kind: "unknown", event_type: "unknown", provider_event_id: null, phone: null, raw: change });
        continue;
      }
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const msg of messages) {
        out.push({
          kind: msg?.id && msg?.from ? "message" : "unknown",
          event_type: `message.${String(msg?.type ?? "unknown")}`,
          provider_event_id: msg?.id ? String(msg.id) : null,
          phone: msg?.from ? String(msg.from) : null,
          raw: { entry_id: entry?.id ?? null, metadata: value?.metadata ?? null, contacts: value?.contacts ?? [], message: msg },
        });
      }
      for (const st of statuses) {
        out.push({
          kind: st?.id ? "status" : "unknown",
          event_type: `status.${String(st?.status ?? "unknown")}`,
          provider_event_id: st?.id ? `status:${String(st.id)}:${String(st?.status ?? "unknown")}` : null,
          phone: st?.recipient_id ? String(st.recipient_id) : null,
          raw: { entry_id: entry?.id ?? null, metadata: value?.metadata ?? null, status: st },
        });
      }
      if (!messages.length && !statuses.length) {
        out.push({
          kind: "unknown",
          event_type: `unknown.${String(change?.field ?? "no_field")}`,
          provider_event_id: null,
          phone: null,
          raw: change,
        });
      }
    }
  }
  if (!entries.length) {
    out.push({ kind: "unknown", event_type: "unknown.envelope", provider_event_id: null, phone: null, raw: payload });
  }
  return out;
}

/**
 * Dedupe key. Provider ids win. Without one we fall back to
 * provider+type+payload hash inside a bounded time bucket, so a genuinely
 * repeated event later is still stored rather than silently swallowed.
 */
export function buildDedupeKey(args: {
  provider: string;
  providerEventId: string | null;
  eventType: string;
  payloadSha256: string;
  receivedAt?: Date;
  bucketSeconds?: number;
}): string {
  const { provider, providerEventId, eventType, payloadSha256 } = args;
  if (providerEventId) return `${provider}:id:${providerEventId}`;
  const bucketSeconds = args.bucketSeconds ?? 3600;
  const at = args.receivedAt ?? new Date();
  const bucket = Math.floor(at.getTime() / 1000 / bucketSeconds);
  return `${provider}:h:${eventType}:${payloadSha256}:${bucket}`;
}

/** Exponential backoff with full jitter, capped. Deterministic when rand given. */
export function backoffSeconds(attempt: number, rand: number = Math.random()): number {
  const base = 15;
  const cap = 3600;
  const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = 1 + (rand - 0.5) * 0.4; // ±20%
  return Math.max(5, Math.round(exp * jitter));
}

export type ReadinessItem = {
  key: string;
  label: string;
  essential: boolean;
  verified: boolean;
  evidence: string;
};

/** Production gate: essential items must all be verified. */
export function computeProductionGate(items: ReadinessItem[]): {
  production_ready: boolean;
  blocking: string[];
  verified_count: number;
  total: number;
} {
  const blocking = items.filter((i) => i.essential && !i.verified).map((i) => i.key);
  return {
    production_ready: blocking.length === 0,
    blocking,
    verified_count: items.filter((i) => i.verified).length,
    total: items.length,
  };
}

/** Classify a thrown error into a durable quarantine reason code. */
export function classifyFailure(err: unknown): QuarantineReason {
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  if (msg.includes("phone")) return "invalid_phone";
  if (msg.includes("transcri")) return "transcription_failed";
  if (msg.includes("contact")) return "contact_resolution_failed";
  if (msg.includes("ai") || msg.includes("model") || msg.includes("gateway")) return "ai_failed";
  return "processing_exception";
}