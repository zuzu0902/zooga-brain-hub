/**
 * Reproduces the production defect: a stale manager handoff behaved as a
 * permanent conversational lock, answering every inbound (including
 * "מתחילים מחדש" / "נתחיל שוב" / "ריסט") with the same boilerplate.
 */
import { describe, expect, it } from "vitest";
import {
  ACTIVE_HANDLING_WINDOW_MS,
  assessHumanHandling,
  decideHandoffTurn,
  HANDOFF_ACTIVE_STATUS_TEXT,
} from "@/lib/tamar-v2/handoff-activity";
import { isConversationResetRequest } from "@/lib/tamar-v2/reset";
import { managerResumeBrief } from "@/lib/tamar-pilot/manager-outcome";

const NOW = new Date("2026-09-08T10:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

describe("reset language recognised", () => {
  for (const phrase of ["מתחילים מחדש", "נתחיל מחדש", "נתחיל שוב", "ריסט", "בואי נתחיל שוב"]) {
    it(`treats "${phrase}" as a reset`, () => {
      expect(isConversationResetRequest(phrase)).toBe(true);
    });
  }
  it("does not treat a product question as a reset", () => {
    expect(isConversationResetRequest("מה המחיר של הטיול לבאקו?")).toBe(false);
  });
});

describe("active human handling is narrow and contact-specific", () => {
  it("an untouched open handoff is NOT active handling", () => {
    const a = assessHumanHandling({
      humanOwned: true,
      humanOwnedBy: null,
      humanOwnedAt: hoursAgo(300),
      openHandoffs: [{ status: "open", created_at: hoursAgo(300) }],
      now: NOW,
    });
    expect(a.active).toBe(false);
    expect(a.reason).toBe("stale_untouched_handoff");
  });

  it("an old claimed handoff is NOT active handling", () => {
    const a = assessHumanHandling({
      humanOwned: true,
      openHandoffs: [{ status: "claimed", claimed_at: hoursAgo(72) }],
      now: NOW,
    });
    expect(a.active).toBe(false);
    expect(a.reason).toBe("stale_manager_activity");
  });

  it("a recently claimed handoff IS active handling", () => {
    const a = assessHumanHandling({
      humanOwned: true,
      openHandoffs: [{ status: "claimed", claimed_at: hoursAgo(2) }],
      now: NOW,
    });
    expect(a.active).toBe(true);
    expect(a.ageMs!).toBeLessThan(ACTIVE_HANDLING_WINDOW_MS);
  });

  it("an explicit manual lock taken recently IS active handling", () => {
    const a = assessHumanHandling({
      humanOwned: true,
      humanOwnedBy: "user-1",
      humanOwnedAt: hoursAgo(1),
      openHandoffs: [],
      now: NOW,
    });
    expect(a.active).toBe(true);
    expect(a.reason).toBe("active_manual_lock");
  });
});

describe("turn decision on a frozen thread", () => {
  const stale = assessHumanHandling({
    humanOwned: true,
    openHandoffs: [{ status: "open", created_at: hoursAgo(300) }],
    now: NOW,
  });
  const active = assessHumanHandling({
    humanOwned: true,
    openHandoffs: [{ status: "claimed", claimed_at: hoursAgo(1) }],
    now: NOW,
  });

  it("stale freeze + reset command resumes Tamar", () => {
    const d = decideHandoffTurn({ frozen: true, activity: stale, resetRequested: true, now: NOW });
    expect(d.action).toBe("resume_tamar");
  });

  it("stale freeze + ordinary product question is answered by Tamar", () => {
    const d = decideHandoffTurn({ frozen: true, activity: stale, resetRequested: false, now: NOW });
    expect(d.action).toBe("resume_tamar");
  });

  it("active handling replies with ONE concise status, then stays quiet", () => {
    const first = decideHandoffTurn({ frozen: true, activity: active, resetRequested: false, now: NOW });
    expect(first.action).toBe("status_reply");
    const second = decideHandoffTurn({
      frozen: true,
      activity: active,
      resetRequested: false,
      lastStatusAckAt: hoursAgo(0.1),
      now: NOW,
    });
    expect(second.action).toBe("status_quiet");
    expect(HANDOFF_ACTIVE_STATUS_TEXT.length).toBeGreaterThan(20);
  });

  it("explicit customer re-engagement releases even an active handling", () => {
    const d = decideHandoffTurn({ frozen: true, activity: active, resetRequested: true, now: NOW });
    expect(d.action).toBe("resume_tamar");
    expect(d.reason).toBe("customer_reengagement_reset");
  });

  it("time alone never releases an active manager conversation", () => {
    const d = decideHandoffTurn({
      frozen: true,
      activity: active,
      resetRequested: false,
      lastStatusAckAt: hoursAgo(10),
      now: NOW,
    });
    expect(d.action).toBe("status_reply");
    expect(d.action).not.toBe("resume_tamar");
  });

  it("an unfrozen thread is untouched", () => {
    const none = assessHumanHandling({ humanOwned: false, openHandoffs: [], now: NOW });
    expect(decideHandoffTurn({ frozen: false, activity: none, resetRequested: false, now: NOW }).action).toBe("none");
  });
});

describe("manager resolution returns control with the recorded summary", () => {
  it("builds the resume brief Tamar continues from", () => {
    const brief = managerResumeBrief({
      contacted_at: hoursAgo(5),
      outcome: "resolved",
      manager_summary: "דיברתי עם הלקוח, נרשם לטיול באקו",
    } as any);
    expect(brief).toContain("סיכום נציג");
    expect(brief).toContain("באקו");
  });
});

describe("scope isolation", () => {
  it("the handoff modules never reference groups or broadcasts", async () => {
    const fs = await import("node:fs/promises");
    for (const f of ["src/lib/tamar-v2/handoff-activity.ts", "src/lib/tamar-v2/handoff-activity.server.ts"]) {
      const src = await fs.readFile(f, "utf8");
      expect(/broadcast|group|alex_personal|bridge/i.test(src)).toBe(false);
    }
  });

  it("release keeps history and audit paths intact (no delete calls)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/tamar-v2/handoff-activity.server.ts", "utf8");
    expect(src).not.toContain(".delete(");
    expect(src).toContain("webhook_logs");
  });
});
