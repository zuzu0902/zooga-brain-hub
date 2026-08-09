import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  backoffSeconds,
  buildDedupeKey,
  classifyFailure,
  computeProductionGate,
  maskId,
  maskPhone,
  normalizePhone,
  splitMetaEvents,
  type ReadinessItem,
} from "@/lib/zero-loss/core";

const msgEnvelope = (id: string, from = "972501234567") => ({
  entry: [
    {
      id: "entry1",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "pn1" },
            contacts: [{ wa_id: from, profile: { name: "בדיקה" } }],
            messages: [{ id, from, type: "text", text: { body: "היי" } }],
          },
        },
      ],
    },
  ],
});

describe("zero-loss: event splitting", () => {
  it("splits a message envelope into a durable unit with the wamid", () => {
    const events = splitMetaEvents(msgEnvelope("wamid.A"));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("message");
    expect(events[0].provider_event_id).toBe("wamid.A");
    expect(events[0].phone).toBe("972501234567");
  });

  it("splits status callbacks with a distinct provider event id per status", () => {
    const events = splitMetaEvents({
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.B", status: "delivered", recipient_id: "97250" }] } }] }],
    });
    expect(events[0].kind).toBe("status");
    expect(events[0].provider_event_id).toBe("status:wamid.B:delivered");
  });

  it("never drops an unknown shape — it becomes an unknown unit", () => {
    const events = splitMetaEvents({ entry: [{ changes: [{ field: "account_update", value: { foo: 1 } }] }] });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("unknown");
  });

  it("stores even a completely empty envelope", () => {
    expect(splitMetaEvents({}).map((e) => e.kind)).toEqual(["unknown"]);
  });

  it("splits audio and interactive messages", () => {
    const audio = splitMetaEvents({
      entry: [{ changes: [{ value: { messages: [{ id: "w1", from: "9725", type: "audio", audio: { id: "m1" } }] } }] }],
    });
    expect(audio[0].event_type).toBe("message.audio");
    const interactive = splitMetaEvents({
      entry: [{ changes: [{ value: { messages: [{ id: "w2", from: "9725", type: "interactive" }] } }] }],
    });
    expect(interactive[0].event_type).toBe("message.interactive");
  });
});

describe("zero-loss: idempotency", () => {
  it("gives the same dedupe key for a redelivered webhook", () => {
    const [a] = splitMetaEvents(msgEnvelope("wamid.A"));
    const [b] = splitMetaEvents(msgEnvelope("wamid.A"));
    const key = (e: any) =>
      buildDedupeKey({ provider: "meta_whatsapp", providerEventId: e.provider_event_id, eventType: e.event_type, payloadSha256: "h" });
    expect(key(a)).toBe(key(b));
  });

  it("keeps distinct keys for distinct message ids", () => {
    const k1 = buildDedupeKey({ provider: "m", providerEventId: "a", eventType: "t", payloadSha256: "h" });
    const k2 = buildDedupeKey({ provider: "m", providerEventId: "b", eventType: "t", payloadSha256: "h" });
    expect(k1).not.toBe(k2);
  });

  it("falls back to hash + time bucket when the provider gives no id", () => {
    const at = new Date("2026-08-09T10:00:00Z");
    const k1 = buildDedupeKey({ provider: "m", providerEventId: null, eventType: "t", payloadSha256: "h", receivedAt: at });
    const k2 = buildDedupeKey({ provider: "m", providerEventId: null, eventType: "t", payloadSha256: "h", receivedAt: at });
    const later = buildDedupeKey({
      provider: "m",
      providerEventId: null,
      eventType: "t",
      payloadSha256: "h",
      receivedAt: new Date("2026-08-09T14:00:00Z"),
    });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(later);
  });
});

describe("zero-loss: retry policy", () => {
  it("grows exponentially and stays capped", () => {
    expect(backoffSeconds(1, 0.5)).toBe(15);
    expect(backoffSeconds(3, 0.5)).toBe(60);
    expect(backoffSeconds(20, 0.5)).toBeLessThanOrEqual(3600);
  });
  it("applies jitter within ±20%", () => {
    expect(backoffSeconds(3, 0)).toBeLessThan(60);
    expect(backoffSeconds(3, 1)).toBeGreaterThan(60);
  });
  it("never returns less than the floor", () => {
    expect(backoffSeconds(0, 0)).toBeGreaterThanOrEqual(5);
  });
});

describe("zero-loss: privacy", () => {
  it("masks phones to the last 4 digits", () => {
    expect(maskPhone("972501234567")).toBe("***4567");
    expect(maskPhone(null)).toBeNull();
  });
  it("masks ids", () => {
    expect(maskId("0123456789abcdef")).toBe("01234567…");
  });
  it("normalizes to E.164 and rejects junk", () => {
    expect(normalizePhone("972-50-123-4567")).toBe("+972501234567");
    expect(normalizePhone("12")).toBeNull();
  });
});

describe("zero-loss: failure classification", () => {
  it("maps failures onto durable reason codes", () => {
    expect(classifyFailure(new Error("invalid_phone: bad"))).toBe("invalid_phone");
    expect(classifyFailure(new Error("contact_resolution_failed"))).toBe("contact_resolution_failed");
    expect(classifyFailure(new Error("transcription blew up"))).toBe("transcription_failed");
    expect(classifyFailure(new Error("model gateway 500"))).toBe("ai_failed");
    expect(classifyFailure(new Error("boom"))).toBe("processing_exception");
  });
});

describe("zero-loss: production gate", () => {
  const items = (over: Partial<ReadinessItem>[] = []): ReadinessItem[] => [
    { key: "vault", label: "v", essential: true, verified: true, evidence: "" },
    { key: "pitr", label: "p", essential: false, verified: false, evidence: "" },
    ...(over as ReadinessItem[]),
  ];
  it("is ready when every essential item is verified", () => {
    expect(computeProductionGate(items()).production_ready).toBe(true);
  });
  it("is blocked by any unverified essential item", () => {
    const gate = computeProductionGate(items([{ key: "worker", label: "w", essential: true, verified: false, evidence: "" }]));
    expect(gate.production_ready).toBe(false);
    expect(gate.blocking).toContain("worker");
  });
});

// ---- Ingestion contract with a mocked Supabase admin client ---------------
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: any[]) => rpc(...args),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      update: () => ({ eq: async () => ({ data: null }) }),
      insert: async () => ({ data: null, error: null }),
    }),
  },
}));

describe("zero-loss: durable ingest contract", () => {
  beforeEach(() => rpc.mockReset());

  it("throws (=> caller answers 5xx) when the vault is unavailable", async () => {
    const { ingestEvent } = await import("@/lib/zero-loss/vault.server");
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const [ev] = splitMetaEvents(msgEnvelope("wamid.X"));
    await expect(ingestEvent(ev)).rejects.toThrow(/vault_unavailable/);
  });

  it("reports a duplicate instead of a new row for a redelivered event", async () => {
    const { ingestEvent } = await import("@/lib/zero-loss/vault.server");
    rpc.mockResolvedValue({ data: [{ vault_id: "v1", correlation_id: "c1", duplicate: true }], error: null });
    const [ev] = splitMetaEvents(msgEnvelope("wamid.Y"));
    const res = await ingestEvent(ev);
    expect(res.duplicate).toBe(true);
    expect(res.vault_id).toBe("v1");
  });

  it("persists the raw event before anything else and carries a correlation id", async () => {
    const { ingestEvent } = await import("@/lib/zero-loss/vault.server");
    rpc.mockResolvedValue({ data: [{ vault_id: "v2", correlation_id: "c2", duplicate: false }], error: null });
    const [ev] = splitMetaEvents(msgEnvelope("wamid.Z"));
    const res = await ingestEvent(ev);
    expect(rpc).toHaveBeenCalledWith("zl_ingest_event", expect.objectContaining({ p_provider_event_id: "wamid.Z" }));
    const payload = rpc.mock.calls[0][1];
    expect(payload.p_normalized_phone).toBe("+972501234567");
    expect(payload.p_payload_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.correlation_id).toBe("c2");
  });

  it("concurrent duplicate webhooks collapse to one stored event", async () => {
    const { ingestEvent } = await import("@/lib/zero-loss/vault.server");
    let first = true;
    rpc.mockImplementation(async () => {
      const dup = !first;
      first = false;
      return { data: [{ vault_id: "v3", correlation_id: "c3", duplicate: dup }], error: null };
    });
    const [ev] = splitMetaEvents(msgEnvelope("wamid.C"));
    const [a, b] = await Promise.all([ingestEvent(ev), ingestEvent(ev)]);
    expect([a.duplicate, b.duplicate].filter(Boolean)).toHaveLength(1);
    expect(a.vault_id).toBe(b.vault_id);
  });
});

describe("zero-loss: outbound idempotency key", () => {
  it("is stable for the same inbound + body and differs otherwise", async () => {
    const { buildIdempotencyKey } = await import("@/lib/zero-loss/outbox.server");
    const base = { phone: "972501234567", text: "שלום", kind: "reply", vaultEventId: "v1" };
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base }));
    expect(buildIdempotencyKey(base)).not.toBe(buildIdempotencyKey({ ...base, text: "אחר" }));
    expect(buildIdempotencyKey(base)).not.toBe(buildIdempotencyKey({ ...base, vaultEventId: "v2" }));
  });
});