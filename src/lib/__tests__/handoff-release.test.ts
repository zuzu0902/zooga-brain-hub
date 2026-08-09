import { describe, it, expect } from "vitest";
import { decideAutoRelease, hasManualHumanLock, describeLockHolder } from "@/lib/handoff-release-core";

const base = { humanOwned: true, humanOwnedBy: null as string | null, humanOwnedAt: null as string | null, openHandoffs: 0 };

describe("handoff auto-release rules", () => {
  it("resolving the only handoff releases the thread back to Tamar", () => {
    expect(decideAutoRelease({ ...base, openHandoffs: 0 })).toEqual({ release: true, reason: "released" });
  });

  it("another open handoff blocks the release", () => {
    expect(decideAutoRelease({ ...base, openHandoffs: 1 })).toEqual({
      release: false,
      reason: "other_open_handoffs",
    });
  });

  it("an explicit manual human lock blocks the release", () => {
    const snap = { ...base, humanOwnedBy: "user-1", humanOwnedAt: "2026-08-09T10:00:00Z" };
    expect(hasManualHumanLock(snap)).toBe(true);
    expect(decideAutoRelease(snap)).toEqual({ release: false, reason: "manual_human_lock" });
  });

  it("a handoff freeze is not a manual lock", () => {
    expect(hasManualHumanLock({ humanOwned: true, humanOwnedBy: null })).toBe(false);
  });

  it("retry is idempotent: an already released thread is a no-op success path", () => {
    expect(decideAutoRelease({ ...base, humanOwned: false })).toEqual({
      release: false,
      reason: "already_automation_owned",
    });
  });

  it("the explicit admin action forces past every hold", () => {
    const held = { ...base, humanOwnedBy: "user-1", openHandoffs: 2 };
    expect(decideAutoRelease(held, { force: true })).toEqual({ release: true, reason: "forced_release" });
  });

  it("production case: frozen contact with a stale resolved handoff is releasable", () => {
    // contact 07ada12b — human_owned, zero open handoffs, no manual lock
    expect(decideAutoRelease({ ...base, openHandoffs: 0, humanOwnedBy: null }).release).toBe(true);
  });

  it("lock holder description never leaks identifiers", () => {
    expect(describeLockHolder({ humanOwnedBy: "user-1", openHandoffs: 0 })).not.toContain("user-1");
    expect(describeLockHolder({ humanOwnedBy: null, openHandoffs: 2 })).toBe("פנייה פתוחה לנציג");
    expect(describeLockHolder({ humanOwnedBy: null, openHandoffs: 0 })).toBe("אין נעילה");
  });
});
