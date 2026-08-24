import { describe, it, expect } from "vitest";
import {
  buildShadowEnvelope,
  sanitizeShadowMetrics,
  deliveryErrorCode,
  EMPTY_SHADOW_METRICS,
} from "@/lib/zooga-gateway/shadow";

const NOW = "2026-08-24T08:00:00.000Z";

describe("shadow envelope allow-list", () => {
  it("emits metadata only and drops any PII-bearing input", () => {
    const env = buildShadowEnvelope(
      {
        eventId: "wamid.ABC",
        correlationId: "corr-1",
        eventType: "messages",
        occurredAt: "1756022400",
        kind: "message",
        providerEventPresent: true,
        duplicate: false,
        // extra fields are structurally impossible, but assert the projection anyway
        ...({ phone: "+972501234567", text: "שלום", raw: { foo: 1 }, full_name: "מירב" } as any),
      } as any,
      NOW,
    );
    expect(Object.keys(env).sort()).toEqual([
      "correlation_id",
      "event_id",
      "event_type",
      "occurred_at",
      "payload",
      "source",
    ]);
    expect(Object.keys(env.payload).sort()).toEqual(["duplicate", "kind", "provider_event_present"]);
    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain("972501234567");
    expect(serialized).not.toContain("שלום");
    expect(serialized).not.toContain("מירב");
    expect(serialized).not.toContain("raw");
    expect(env.payload).toEqual({ kind: "message", provider_event_present: true, duplicate: false });
  });

  it("normalizes unknown kinds, missing type and missing timestamp safely", () => {
    const env = buildShadowEnvelope(
      { eventId: "v-1", kind: "weird" as any, providerEventPresent: false, duplicate: true },
      NOW,
    );
    expect(env.payload.kind).toBe("unknown");
    expect(env.event_type).toBe("unknown");
    expect(env.occurred_at).toBe(NOW);
    expect(env.correlation_id).toBeNull();
    expect(env.source).toBe("meta");
  });

  it("is deterministic for the same event id (idempotency key stability)", () => {
    const a = buildShadowEnvelope({ eventId: "x", kind: "status", providerEventPresent: true, duplicate: false }, NOW);
    const b = buildShadowEnvelope({ eventId: "x", kind: "status", providerEventPresent: true, duplicate: false }, NOW);
    expect(a).toEqual(b);
  });
});

describe("shadow metrics sanitizer", () => {
  it("projects only counters and drops arbitrary fields", () => {
    const m = sanitizeShadowMetrics({
      queued: 3,
      retry: "2",
      leased: 1,
      delivered: 10,
      dead: 0,
      oldest_queued_age_seconds: 42.7,
      bearer_token: "secret",
      rows: [{ phone: "+9725" }],
    });
    expect(m).toEqual({
      queued: 3,
      retry: 2,
      leased: 1,
      delivered: 10,
      dead: 0,
      oldest_queued_age_seconds: 42,
    });
    expect(JSON.stringify(m)).not.toContain("secret");
  });

  it("falls back to zeros on garbage input", () => {
    expect(sanitizeShadowMetrics(null)).toEqual(EMPTY_SHADOW_METRICS);
    expect(sanitizeShadowMetrics("nope")).toEqual(EMPTY_SHADOW_METRICS);
    expect(sanitizeShadowMetrics({ queued: -5 }).queued).toBe(0);
  });
});

describe("delivery error codes", () => {
  it("maps aborts, network failures and upstream statuses to short codes", () => {
    expect(deliveryErrorCode(null, true)).toBe("timeout");
    expect(deliveryErrorCode(null, false)).toBe("network_error");
    expect(deliveryErrorCode(503, false)).toBe("upstream_error");
    expect(deliveryErrorCode(200, false)).toBe("unexpected_status");
    expect(deliveryErrorCode(401, false)).toBe("unexpected_status");
  });
});
