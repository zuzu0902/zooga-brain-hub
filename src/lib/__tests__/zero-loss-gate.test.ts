/**
 * Gate + scheduler + webhook-ack tests. No network, no WhatsApp, no DB.
 */
import { describe, expect, it, vi } from "vitest";
import { computeProductionGate, type ReadinessItem } from "@/lib/zero-loss/core";

const item = (key: string, verified: boolean, core: boolean): ReadinessItem => ({
  key,
  label: key,
  essential: true,
  core,
  verified,
  evidence: "",
});

/** The exact shipped shape: 7 core controls + 4 operational proofs. */
const shippedItems = (over: Record<string, boolean> = {}): ReadinessItem[] =>
  [
    ["vault", true],
    ["idempotency", true],
    ["retry_worker", true],
    ["quarantine", true],
    ["identity_registry", true],
    ["delete_guard", true],
    ["alerts", true],
  ]
    .map(([k]) => item(String(k), over[String(k)] ?? true, true))
    .concat(
      ["reconciliation_scheduler", "pitr_backup", "load_test", "restore_drill"].map((k) =>
        item(k, over[k] ?? false, false),
      ),
    );

describe("production gate: nothing but 11/11 is READY", () => {
  it("7/11 with all core controls green is still NOT READY", () => {
    const gate = computeProductionGate(shippedItems());
    expect(gate.production_ready).toBe(false);
    expect(gate.verified_count).toBe(7);
    expect(gate.total).toBe(11);
  });

  it("reports core controls separately as 7/7", () => {
    const gate = computeProductionGate(shippedItems());
    expect(gate.core_verified).toBe(7);
    expect(gate.core_total).toBe(7);
  });

  it("lists every unverified item as blocking, including the non-core proofs", () => {
    const gate = computeProductionGate(shippedItems());
    expect(gate.blocking).toEqual([
      "reconciliation_scheduler",
      "pitr_backup",
      "load_test",
      "restore_drill",
    ]);
  });

  it("a verified scheduler alone does not flip the headline", () => {
    const gate = computeProductionGate(shippedItems({ reconciliation_scheduler: true }));
    expect(gate.production_ready).toBe(false);
    expect(gate.verified_count).toBe(8);
  });

  it("PITR/load-test/restore-drill are blocking, never advisory", () => {
    for (const key of ["pitr_backup", "load_test", "restore_drill"]) {
      const items = shippedItems({ reconciliation_scheduler: true, pitr_backup: true, load_test: true, restore_drill: true });
      const one = items.map((i) => (i.key === key ? { ...i, verified: false } : i));
      expect(computeProductionGate(one).production_ready).toBe(false);
      expect(computeProductionGate(one).blocking).toEqual([key]);
    }
  });

  it("is READY only when all 11 are verified", () => {
    const all = shippedItems({
      reconciliation_scheduler: true,
      pitr_backup: true,
      load_test: true,
      restore_drill: true,
    });
    const gate = computeProductionGate(all);
    expect(gate.production_ready).toBe(true);
    expect(gate.verified_count).toBe(11);
  });

  it("a failing core control blocks too", () => {
    const gate = computeProductionGate(shippedItems({ vault: false }));
    expect(gate.blocking[0]).toBe("vault");
    expect(gate.core_verified).toBe(6);
  });
});

/** Scheduler readiness rule mirrored from getZeroLossOverview. */
function schedulerVerified(run: { trigger_source: string; started_at: string } | null, now = Date.now()): boolean {
  if (!run) return false;
  if (run.trigger_source !== "cron") return false;
  return now - new Date(run.started_at).getTime() <= 15 * 60_000;
}

describe("scheduler readiness", () => {
  const now = Date.UTC(2026, 7, 9, 12, 0, 0);
  it("NOT SCHEDULED with no run at all", () => {
    expect(schedulerVerified(null, now)).toBe(false);
  });
  it("NOT SCHEDULED when only manual runs exist", () => {
    expect(schedulerVerified({ trigger_source: "manual", started_at: new Date(now).toISOString() }, now)).toBe(false);
  });
  it("NOT SCHEDULED when the last cron run is stale", () => {
    expect(
      schedulerVerified({ trigger_source: "cron", started_at: new Date(now - 60 * 60_000).toISOString() }, now),
    ).toBe(false);
  });
  it("VERIFIED on a fresh cron run", () => {
    expect(
      schedulerVerified({ trigger_source: "cron", started_at: new Date(now - 4 * 60_000).toISOString() }, now),
    ).toBe(true);
  });
});

// ---- Webhook must answer 5xx when the vault insert fails BEFORE ack -------
const ingestEvent = vi.fn();
vi.mock("@/lib/zero-loss/vault.server", () => ({
  ingestEvent: (...a: any[]) => ingestEvent(...a),
  leaseJobForVault: async () => null,
  finishJob: async () => {},
  quarantineEvent: async () => {},
  sha256: () => "h",
  phoneHash: () => null,
  auditZeroLoss: async () => {},
  PROVIDER: "meta_whatsapp",
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({}) }),
    }),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/lib/zero-loss/identity.server", () => ({ registerIdentity: async () => null }));

async function postWebhook(body: unknown) {
  process.env.META_APP_SECRET = "test_secret";
  const { createHmac } = await import("crypto");
  const raw = JSON.stringify(body);
  const sig = "sha256=" + createHmac("sha256", "test_secret").update(raw, "utf8").digest("hex");
  const mod = await import("@/routes/api/public/webhook/tamar");
  const handler = (mod.Route as any).options.server.handlers.POST;
  return handler({
    request: new Request("https://x/api/public/webhook/tamar", {
      method: "POST",
      headers: { "x-hub-signature-256": sig, "content-type": "application/json" },
      body: raw,
    }),
  });
}

const envelope = {
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "pn1" },
            contacts: [{ wa_id: "972501234567", profile: { name: "t" } }],
            messages: [{ id: "wamid.GATE", from: "972501234567", type: "text", text: { body: "היי" } }],
          },
        },
      ],
    },
  ],
};

describe("webhook durability gate (src/routes/api/public/webhook/tamar.ts)", () => {
  it("returns 503 and does NOT ack when the durable vault insert fails", async () => {
    ingestEvent.mockImplementation(async () => {
      throw new Error("vault_unavailable: connection refused");
    });
    const res = await postWebhook(envelope);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("vault_unavailable");
  });

  it("acks 200 for an envelope with no messages once the vault commit succeeded", async () => {
    ingestEvent.mockImplementation(async () => ({ vault_id: "v1", correlation_id: "c1", duplicate: false }));
    const res = await postWebhook({ entry: [{ changes: [{ field: "x", value: { foo: 1 } }] }] });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});