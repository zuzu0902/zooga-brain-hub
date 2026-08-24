/**
 * ZOOGA OS SHADOW TRANSPORT — pure helpers (client-safe).
 *
 * METADATA ONLY. The envelope payload is a closed allow-list: no phone, no
 * phone mask, no message text, no transcripts, no raw Meta payload, no
 * contact/profile data ever leaves this process for the Gateway.
 */

export type ShadowEventKind = "message" | "status" | "unknown";

export type ShadowPayload = {
  kind: ShadowEventKind;
  provider_event_present: boolean;
  duplicate: boolean;
};

export type ShadowEnvelopeInput = {
  eventId: string;
  correlationId?: string | null;
  eventType?: string | null;
  occurredAt?: string | null;
  kind: ShadowEventKind;
  providerEventPresent: boolean;
  duplicate: boolean;
};

export type ShadowEnvelope = {
  event_id: string;
  correlation_id: string | null;
  source: "meta";
  event_type: string;
  occurred_at: string;
  payload: ShadowPayload;
};

const KINDS: ShadowEventKind[] = ["message", "status", "unknown"];

function asKind(v: unknown): ShadowEventKind {
  return KINDS.includes(v as ShadowEventKind) ? (v as ShadowEventKind) : "unknown";
}

function asIsoDate(v: unknown, fallback: string): string {
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
  }
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    const numeric = /^\d+$/.test(s) ? Number(s) : NaN;
    const d = Number.isFinite(numeric) ? new Date(numeric > 1e12 ? numeric : numeric * 1000) : new Date(s);
    return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
  }
  return fallback;
}

/** Strict allow-list projection of one inbound unit into a shadow envelope. */
export function buildShadowEnvelope(input: ShadowEnvelopeInput, now = new Date().toISOString()): ShadowEnvelope {
  const eventType = typeof input.eventType === "string" ? input.eventType.trim().slice(0, 64) : "";
  return {
    event_id: String(input.eventId).slice(0, 200),
    correlation_id: input.correlationId ? String(input.correlationId).slice(0, 64) : null,
    source: "meta",
    event_type: eventType || "unknown",
    occurred_at: asIsoDate(input.occurredAt, now),
    payload: {
      kind: asKind(input.kind),
      provider_event_present: !!input.providerEventPresent,
      duplicate: !!input.duplicate,
    },
  };
}

export type ShadowMetrics = {
  queued: number;
  retry: number;
  leased: number;
  delivered: number;
  dead: number;
  oldest_queued_age_seconds: number | null;
};

export const EMPTY_SHADOW_METRICS: ShadowMetrics = {
  queued: 0,
  retry: 0,
  leased: 0,
  delivered: 0,
  dead: 0,
  oldest_queued_age_seconds: null,
};

function count(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Allow-list projection of Supabase-side counters. Never carries row data. */
export function sanitizeShadowMetrics(raw: unknown): ShadowMetrics {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_SHADOW_METRICS };
  const r = raw as Record<string, unknown>;
  const age = r["oldest_queued_age_seconds"];
  const ageNum = typeof age === "number" ? age : Number(age);
  return {
    queued: count(r["queued"]),
    retry: count(r["retry"]),
    leased: count(r["leased"]),
    delivered: count(r["delivered"]),
    dead: count(r["dead"]),
    oldest_queued_age_seconds: Number.isFinite(ageNum) && ageNum >= 0 ? Math.floor(ageNum) : null,
  };
}

export type ShadowDeliveryErrorCode =
  | "config_unavailable"
  | "timeout"
  | "network_error"
  | "upstream_error"
  | "unexpected_status";

/** Only these short codes are ever persisted or surfaced — never response bodies. */
export function deliveryErrorCode(status: number | null, aborted: boolean): ShadowDeliveryErrorCode {
  if (aborted) return "timeout";
  if (status === null) return "network_error";
  if (status >= 500) return "upstream_error";
  return "unexpected_status";
}
