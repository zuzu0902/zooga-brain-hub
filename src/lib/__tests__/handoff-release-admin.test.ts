/**
 * Admin release of a human handoff: authorization, mandatory reason,
 * immutable audit and idempotency.
 *
 * These tests never touch the real database and never reference the live
 * allowlisted contact.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts: Array<{ table: string; row: any }> = [];
const updates: Array<{ table: string; row: any }> = [];
const state = {
  isAdmin: true as boolean,
  lock: { humanOwned: true, humanOwnedBy: "mgr", humanOwnedAt: "2026-01-01T00:00:00Z", openHandoffs: 1 },
  released: true,
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: async (row: any) => {
        inserts.push({ table, row });
        return { data: null, error: null };
      },
      update: (row: any) => {
        updates.push({ table, row });
        const chain: any = {
          eq: () => chain,
          not: () => chain,
          is: () => chain,
          select: async () => ({ data: [{ id: "h-1" }], error: null }),
          then: (r: any) => Promise.resolve({ data: null, error: null }).then(r),
        };
        return chain;
      },
    }),
    rpc: async () => ({ data: { ok: true }, error: null }),
  },
}));

vi.mock("@/lib/tamar-handoff-core.server", () => ({
  getLockSnapshot: async () => state.lock,
  releaseIfUnheld: async () => ({
    released: state.released,
    contact_id: "c-1",
    resolved_handoffs: 1,
    decision: "forced",
  }),
  handoffChannelHealth: async () => ({ ok: true }),
  notifyManagerForHandoff: async () => ({ ok: true }),
}));

import { performContactRelease } from "@/lib/handoff-release-admin.server";
import { validateReleaseInput } from "@/lib/handoff-release-core";

const CONTACT = "33333333-3333-3333-3333-333333333333";
const ADMIN = "44444444-4444-4444-4444-444444444444";

const ctx = () => ({
  userId: ADMIN,
  supabase: { rpc: async () => ({ data: state.isAdmin, error: null }) },
});

const call = (data: any) =>
  performContactRelease({ request: data, actorId: ADMIN, isAdmin: async () => state.isAdmin });
const validate = (input: any) => validateReleaseInput(input);

const MANAGER_OUTCOME = {
  contacted: true,
  outcome: "resolved",
  summary: "דיברתי עם הלקוח וסיכמנו המשך",
};

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  state.isAdmin = true;
  state.released = true;
  state.lock = { humanOwned: true, humanOwnedBy: "mgr", humanOwnedAt: "2026-01-01T00:00:00Z", openHandoffs: 1 };
});

describe("release input validation", () => {
  it("requires a reason", () => {
    expect(() => validate({ contactId: CONTACT })).toThrow(/reason_required/);
    expect(() => validate({ contactId: CONTACT, reason: "  " })).toThrow(/reason_required/);
  });
  it("requires a valid contact id", () => {
    expect(() => validate({ contactId: "nope", reason: "done" })).toThrow(/invalid_contact_id/);
  });
  it("accepts a valid confirmed request", () => {
    expect(validate({ contactId: CONTACT, reason: "הנציג סיים" })).toEqual({
      contactId: CONTACT,
      resetIntake: false,
      reason: "הנציג סיים",
      managerOutcome: null,
    });
  });
});

describe("release authorization", () => {
  it("refuses a signed-in non-admin", async () => {
    state.isAdmin = false;
    await expect(
      call({ contactId: CONTACT, resetIntake: false, reason: "x-reason", managerOutcome: MANAGER_OUTCOME }),
    ).rejects.toThrow(/forbidden/);
    expect(inserts).toHaveLength(0);
  });
});

describe("release audit and idempotency", () => {
  it("writes an immutable audit record with actor, states and reason", async () => {
    const res = await call({
      contactId: CONTACT,
      resetIntake: false,
      reason: "handled by agent",
      managerOutcome: MANAGER_OUTCOME,
    });
    expect(res.released).toBe(true);
    const audit = inserts.find((i) => i.table === "tamar_admin_audit_log");
    expect(audit).toBeTruthy();
    expect(audit!.row.actor).toBe(ADMIN);
    expect(audit!.row.target_id).toBe(CONTACT);
    expect(audit!.row.before_value.lock.humanOwned).toBe(true);
    expect(audit!.row.after_value.reason).toBe("handled by agent");
    expect(inserts.some((i) => i.table === "zero_loss_audit_log")).toBe(true);
  });

  it("is idempotent: an already-free thread is not released twice", async () => {
    state.lock = { humanOwned: false, humanOwnedBy: null, humanOwnedAt: null, openHandoffs: 0 } as any;
    const res = await call({ contactId: CONTACT, resetIntake: false, reason: "second click" });
    expect(res.already_released).toBe(true);
    expect(res.released).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("never releases automatically — it needs an explicit call", () => {
    expect(inserts).toHaveLength(0);
  });

  it("refuses to release an open handoff without the manager record", async () => {
    await expect(
      call({ contactId: CONTACT, resetIntake: false, reason: "back to tamar" }),
    ).rejects.toThrow(/manager_outcome_required/);
    expect(inserts).toHaveLength(0);
  });

  it("stores the manager contact, outcome and summary on the handoff", async () => {
    await call({
      contactId: CONTACT,
      resetIntake: false,
      reason: "back to tamar",
      managerOutcome: MANAGER_OUTCOME,
    });
    const handoff = updates.find((u) => u.table === "manager_handoffs");
    expect(handoff!.row.outcome).toBe("resolved");
    expect(handoff!.row.manager_summary).toContain("סיכום נציג");
    expect(handoff!.row.contacted_at).toBeTruthy();
  });
});
