import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  broadcastIdempotencyKey,
  clampIntervalSeconds,
  finalBroadcastStatus,
  isBroadcastDue,
} from "@/lib/whatsapp-broadcast/core";

const mocks = vi.hoisted(() => ({
  supabaseAdmin: null as any,
  fetchBridgeStatus: vi.fn(),
  sendGroupMessage: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mocks.supabaseAdmin;
  },
}));

vi.mock("@/lib/zooga-whatsapp-bridge/bridge-client.server", () => ({
  fetchBridgeStatus: (...args: unknown[]) => mocks.fetchBridgeStatus(...args),
  sendGroupMessage: (...args: unknown[]) => mocks.sendGroupMessage(...args),
}));

const { runBroadcastQueue } = await import("@/lib/whatsapp-broadcast/runner.server");

const RUNNER = readFileSync(join(process.cwd(), "src", "lib", "whatsapp-broadcast", "runner.server.ts"), "utf8");

type HarnessTarget = {
  id: string;
  group_id: string;
  whatsapp_chat_id_snapshot: string;
  status: string;
  send_order: number;
  sent_at?: string | null;
  error_text?: string | null;
  external_response?: unknown;
};

function withoutUndefined(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function createRunnerHarness(overrides: { intervalSeconds?: number; targets?: HarnessTarget[] } = {}) {
  const broadcast = {
    id: "broadcast-1",
    connection_id: "conn-1",
    message_text: "שלום",
    media_url: null,
    interval_seconds: overrides.intervalSeconds ?? 6,
    status: "queued",
    scheduled_for: null,
    lease_expires_at: null,
    lease_owner: null,
    last_error: null,
  };
  const targets = overrides.targets ?? [
    { id: "target-1", group_id: "group-1", whatsapp_chat_id_snapshot: "111@g.us", status: "pending", send_order: 1 },
    { id: "target-2", group_id: "group-2", whatsapp_chat_id_snapshot: "222@g.us", status: "pending", send_order: 2 },
  ];
  const targetUpdates: Record<string, unknown>[] = [];

  const client = {
    from(table: string) {
      const builder = {
        table,
        action: "select",
        selected: "",
        patch: {} as Record<string, unknown>,
        filters: [] as Array<[string, unknown]>,
        maxRows: null as number | null,
        select(columns: string) {
          this.action = "select";
          this.selected = columns;
          return this;
        },
        update(patch: Record<string, unknown>) {
          this.action = "update";
          this.patch = patch;
          return this;
        },
        eq(column: string, value: unknown) {
          this.filters.push([column, value]);
          return this;
        },
        in() {
          return this;
        },
        or() {
          return this;
        },
        order() {
          return this;
        },
        limit(n: number) {
          this.maxRows = n;
          return this;
        },
        async maybeSingle() {
          if (table === "whatsapp_connections") {
            return { data: { id: "conn-1", transport: "whatsapp_web_bridge", purpose: "group_broadcast" }, error: null };
          }
          if (table === "whatsapp_broadcasts" && this.action === "update") {
            Object.assign(broadcast, withoutUndefined(this.patch));
            return { data: { id: broadcast.id }, error: null };
          }
          return { data: null, error: null };
        },
        async execute() {
          if (table === "whatsapp_broadcasts" && this.action === "select") {
            return { data: [broadcast], error: null };
          }
          if (table === "whatsapp_broadcasts" && this.action === "update") {
            Object.assign(broadcast, withoutUndefined(this.patch));
            return { data: null, error: null };
          }
          if (table === "whatsapp_broadcast_targets" && this.action === "select") {
            if (this.selected === "status") return { data: targets.map((t) => ({ status: t.status })), error: null };
            return {
              data: targets
                .filter((t) => t.status === "pending" || t.status === "queued")
                .sort((a, b) => a.send_order - b.send_order)
                .slice(0, this.maxRows ?? targets.length),
              error: null,
            };
          }
          if (table === "whatsapp_broadcast_targets" && this.action === "update") {
            targetUpdates.push(this.patch);
            const id = this.filters.find(([column]) => column === "id")?.[1];
            const target = targets.find((t) => t.id === id);
            if (target) Object.assign(target, withoutUndefined(this.patch));
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) {
          return this.execute().then(resolve, reject);
        },
      };
      return builder;
    },
  };

  return { broadcast, client, targets, targetUpdates };
}

beforeEach(() => {
  mocks.fetchBridgeStatus.mockReset();
  mocks.sendGroupMessage.mockReset();
  mocks.fetchBridgeStatus.mockResolvedValue({ connected: true });
});

describe("broadcast runner helpers", () => {
  it("only picks broadcasts whose schedule has passed", () => {
    const now = Date.parse("2026-08-25T05:00:00Z");
    expect(isBroadcastDue({ status: "queued", scheduled_for: "2026-08-25T04:48:00Z" }, now)).toBe(true);
    expect(isBroadcastDue({ status: "queued", scheduled_for: "2026-08-25T06:00:00Z" }, now)).toBe(false);
    expect(isBroadcastDue({ status: "queued", scheduled_for: null }, now)).toBe(true);
    expect(isBroadcastDue({ status: "running", scheduled_for: null }, now)).toBe(true);
  });

  it("never runs completed, cancelled or draft broadcasts", () => {
    for (const status of ["draft", "completed", "completed_with_errors", "cancelled"]) {
      expect(isBroadcastDue({ status, scheduled_for: null })).toBe(false);
    }
  });

  it("uses a stable idempotency key per broadcast+group so a re-run cannot double-send", () => {
    const a = broadcastIdempotencyKey("b1", "g1");
    expect(a).toBe(broadcastIdempotencyKey("b1", "g1"));
    expect(a).not.toBe(broadcastIdempotencyKey("b1", "g2"));
    expect(a).not.toBe(broadcastIdempotencyKey("b2", "g1"));
    expect(a.length).toBeGreaterThan(6);
  });

  it("clamps the pacing interval to the validated range", () => {
    expect(clampIntervalSeconds(30)).toBe(30);
    expect(clampIntervalSeconds(1)).toBe(5);
    expect(clampIntervalSeconds(99999)).toBe(3600);
    expect(clampIntervalSeconds(undefined)).toBe(30);
  });

  it("ends with completed_with_errors when any target failed", () => {
    expect(finalBroadcastStatus({ sent: 5, failed: 0 })).toBe("completed");
    expect(finalBroadcastStatus({ sent: 4, failed: 1 })).toBe("completed_with_errors");
  });
});

describe("broadcast runner safety wiring", () => {
  it("takes a database lease with an expiry (single-flight)", () => {
    expect(RUNNER).toContain("lease_expires_at");
    expect(RUNNER).toContain("lease_owner");
    expect(RUNNER).toContain("LEASE_SECONDS");
  });

  it("bounds work per run", () => {
    expect(RUNNER).toContain("MAX_TARGETS_PER_RUN");
    expect(RUNNER).toContain("deadline");
  });

  it("only processes targets that are not yet sent", () => {
    expect(RUNNER).toContain('.in("status", ["pending", "queued"])');
  });

  it("waits interval_seconds between groups", () => {
    expect(RUNNER).toContain("sleep(interval * 1000)");
  });

  it("enforces the Alex bridge transport and never touches Tamar/Meta", () => {
    expect(RUNNER).toContain("canOwnGroupBroadcast");
    expect(RUNNER).not.toContain("whatsapp-meta");
    expect(RUNNER).not.toContain("meta_cloud_api");
  });

  it("stops the run on a broken session instead of failing every group", () => {
    expect(RUNNER).toContain("bridge_unauthorized");
  });

  it("treats bridge rate limits as retryable run-stopping reasons", () => {
    expect(RUNNER).toContain("min_interval");
    expect(RUNNER).toContain("per_minute_cap");
  });
});

describe("broadcast runner pacing behavior", () => {
  it("does not send the next target unless the full configured interval fits in the run budget", async () => {
    const harness = createRunnerHarness({ intervalSeconds: 6 });
    mocks.supabaseAdmin = harness.client;
    mocks.sendGroupMessage.mockResolvedValue({ ok: true, message_id: "wamid-1", duplicate: false });

    const result = await runBroadcastQueue({ budgetMs: 100, maxTargets: 2 });

    expect(mocks.sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(harness.targets.map((t) => t.status)).toEqual(["sent", "pending"]);
    expect(result.status).toBe("running");
    expect(result.remaining).toBe(1);
  });

  it.each(["min_interval", "per_minute_cap"])(
    "keeps the current target pending when the bridge returns %s",
    async (code) => {
      const harness = createRunnerHarness({ intervalSeconds: 6 });
      mocks.supabaseAdmin = harness.client;
      mocks.sendGroupMessage.mockResolvedValue({ ok: false, code });

      const result = await runBroadcastQueue({ budgetMs: 10_000, maxTargets: 2 });

      expect(mocks.sendGroupMessage).toHaveBeenCalledTimes(1);
      expect(harness.targets.map((t) => t.status)).toEqual(["pending", "pending"]);
      expect(harness.targetUpdates).toHaveLength(0);
      expect(harness.broadcast.status).toBe("queued");
      expect(result).toMatchObject({ ok: false, failed: 0, status: "queued", reason: code });
    },
  );
});

describe("gateway send route gap", () => {
  const CLIENT = readFileSync(
    join(process.cwd(), "src", "lib", "zooga-whatsapp-bridge", "bridge-client.server.ts"),
    "utf8",
  );

  it("maps a missing gateway send route to send_route_unavailable", () => {
    expect(CLIENT).toContain("send_route_unavailable");
    expect(CLIENT).toContain('res.code === "not_found"');
  });

  it("treats it as a run-stopping reason so targets stay pending", () => {
    expect(RUNNER).toContain("STOP_RUN_CODES");
    expect(RUNNER).toContain("send_route_unavailable");
    expect(RUNNER).toContain('stopped\n      ? "queued"');
  });
});
