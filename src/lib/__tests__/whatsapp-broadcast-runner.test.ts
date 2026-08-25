import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  broadcastIdempotencyKey,
  clampIntervalSeconds,
  finalBroadcastStatus,
  isBroadcastDue,
} from "@/lib/whatsapp-broadcast/core";

const RUNNER = readFileSync(join(process.cwd(), "src", "lib", "whatsapp-broadcast", "runner.server.ts"), "utf8");

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
