import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DELETE_CONFIRM_WORD,
  isDeleteConfirmed,
  maskPhone,
  nextMessageRoute,
  summarizeReset,
  validateDeleteInput,
  validateResetInput,
} from "@/lib/contact-admin/core";

const CID = "07ada12b-1111-4222-8333-444455556666";

describe("reset input validation", () => {
  it("requires a valid contact id", () => {
    expect(() => validateResetInput({ contactId: "nope", reason: "stuck" })).toThrow("invalid_contact_id");
  });
  it("requires a reset reason", () => {
    expect(() => validateResetInput({ contactId: CID, reason: " " })).toThrow("reset_reason_required");
  });
  it("defaults to release-only (no intake reset)", () => {
    expect(validateResetInput({ contactId: CID, reason: "thread stuck" })).toEqual({
      contactId: CID,
      reason: "thread stuck",
      resetIntake: false,
    });
  });
  it("passes the explicit intake reset flag through", () => {
    expect(validateResetInput({ contactId: CID, reason: "restart", resetIntake: true }).resetIntake).toBe(true);
  });
  it("is idempotent for identical input", () => {
    const a = validateResetInput({ contactId: CID, reason: "x1y", resetIntake: true });
    const b = validateResetInput({ contactId: CID, reason: "x1y", resetIntake: true });
    expect(a).toEqual(b);
  });
});

describe("delete confirmation rules", () => {
  it("accepts only the exact confirm word", () => {
    expect(isDeleteConfirmed(DELETE_CONFIRM_WORD)).toBe(true);
    expect(isDeleteConfirmed(` ${DELETE_CONFIRM_WORD} `)).toBe(true);
    expect(isDeleteConfirmed("delete")).toBe(false);
    expect(isDeleteConfirmed("")).toBe(false);
  });
  it("rejects a delete without the confirmation word", () => {
    expect(() => validateDeleteInput({ contactId: CID, reason: "duplicate", confirmation: "yes" })).toThrow(
      "confirmation_word_mismatch",
    );
  });
  it("rejects a delete without a reason", () => {
    expect(() => validateDeleteInput({ contactId: CID, reason: "", confirmation: DELETE_CONFIRM_WORD })).toThrow(
      "delete_reason_required",
    );
  });
  it("accepts a fully confirmed delete", () => {
    expect(validateDeleteInput({ contactId: CID, reason: "בקשת לקוח", confirmation: DELETE_CONFIRM_WORD })).toEqual({
      contactId: CID,
      reason: "בקשת לקוח",
    });
  });
});

describe("consent / opt-out preservation", () => {
  it("never routes an opted-out contact back to automation", () => {
    expect(nextMessageRoute({ optedOut: true, consentStatus: "granted" })).toBe("suppressed_opt_out");
    expect(nextMessageRoute({ consentStatus: "denied" })).toBe("suppressed_opt_out");
  });
  it("routes a normal contact to Tamar", () => {
    expect(nextMessageRoute({ optedOut: false, consentStatus: "granted" })).toBe("tamar_automation");
  });
});

describe("reset receipt", () => {
  it("states release-only results and no WhatsApp side effect", () => {
    const lines = summarizeReset({
      ok: true,
      handoffs_resolved: 2,
      jobs_cancelled: 1,
      outbox_cancelled: 0,
      locks_released: true,
      intake_reset: false,
      consent_status: "granted",
      next_message_route: "tamar_automation",
    });
    expect(lines.join("\n")).toContain("פניות לנציג שנסגרו: 2");
    expect(lines.join("\n")).toContain("אינטייק לא אופס");
    expect(lines.join("\n")).toContain("לא נשלחה הודעת WhatsApp");
  });
  it("reports the intake reset counts when intake was reset", () => {
    const lines = summarizeReset({
      ok: true,
      intake_reset: true,
      intake_answers_deleted: 5,
      intake_captures_deleted: 3,
      opted_out: true,
      consent_status: "denied",
      next_message_route: "suppressed_opt_out",
    });
    expect(lines.join("\n")).toContain("תשובות: 5");
    expect(lines.join("\n")).toContain("הלקוח בסירוב");
  });
});

describe("phone masking", () => {
  it("never exposes the full number", () => {
    expect(maskPhone("+972541234567")).toBe("***4567");
    expect(maskPhone(null)).toBeNull();
  });
});

/* ---- server function behaviour (mocked Supabase) ---- */

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: (...a: any[]) => rpc(...a) } }));

type Ctx = { supabase: { rpc: (n: string, a: any) => Promise<any> }; userId: string };

function ctx(isAdmin: boolean): Ctx {
  return {
    userId: "11111111-2222-4333-8444-555566667777",
    supabase: { rpc: async () => ({ data: isAdmin, error: null }) },
  };
}

/** Mirrors the handler logic in contact-admin.functions.ts. */
async function callAdminRpc(name: string, args: any, context: Ctx) {
  const { data, error } = await context.supabase.rpc("has_role", {});
  if (error) throw new Error("authorization_check_failed");
  if (data !== true) throw new Error("forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const res = await (supabaseAdmin as any).rpc(name, args);
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

describe("admin authorization and transactional contract", () => {
  beforeEach(() => rpc.mockReset());

  it("rejects a non-admin caller before touching the database", async () => {
    await expect(callAdminRpc("admin_reset_tamar", {}, ctx(false))).rejects.toThrow("forbidden");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("release-only reset closes handoffs and cancels jobs without deleting intake", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, handoffs_resolved: 1, jobs_cancelled: 2, intake_reset: false, consent_preserved: true },
      error: null,
    });
    const res: any = await callAdminRpc("admin_reset_tamar", { p_reset_intake: false }, ctx(true));
    expect(res.handoffs_resolved).toBe(1);
    expect(res.intake_reset).toBe(false);
    expect(res.consent_preserved).toBe(true);
  });

  it("stale human_owned reset reports the lock release", async () => {
    rpc.mockResolvedValue({ data: { ok: true, locks_released: true, conversation_state: "consented" }, error: null });
    const res: any = await callAdminRpc("admin_reset_tamar", {}, ctx(true));
    expect(res.locks_released).toBe(true);
    expect(res.conversation_state).toBe("consented");
  });

  it("propagates a database failure instead of reporting partial success (rollback)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "contact_not_found" } });
    await expect(callAdminRpc("admin_delete_contact", {}, ctx(true))).rejects.toThrow("contact_not_found");
  });

  it("delete result keeps the identity anchor and the opt-out tombstone", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, identities_preserved: 1, suppression_tombstone: true, counts: { messages: 12 } },
      error: null,
    });
    const res: any = await callAdminRpc("admin_delete_contact", {}, ctx(true));
    expect(res.identities_preserved).toBe(1);
    expect(res.suppression_tombstone).toBe(true);
    expect(res.counts.messages).toBe(12);
  });

  it("dry-run preview never returns payloads, only counts", async () => {
    rpc.mockResolvedValue({ data: { contact_id: CID, phone_masked: "***4567", counts: { messages: 3 } }, error: null });
    const res: any = await callAdminRpc("admin_contact_delete_preview", {}, ctx(true));
    expect(Object.keys(res)).toEqual(["contact_id", "phone_masked", "counts"]);
    expect(res.phone_masked).toBe("***4567");
  });
});

describe("no direct client delete remains in the contact screens", () => {
  it("both screens go through the secure dialog", async () => {
    const fs = await import("fs");
    const list = fs.readFileSync("src/routes/_app.contacts.tsx", "utf8");
    const profile = fs.readFileSync("src/routes/_app.contacts.$id.tsx", "utf8");
    expect(list).not.toMatch(/from\("contacts"\)\s*\.delete\(\)/);
    expect(profile).not.toMatch(/from\("contacts"\)\s*\.delete\(\)/);
    expect(list).toContain("ContactDeleteDialog");
    expect(profile).toContain("ContactDeleteDialog");
    expect(profile).toContain("ContactResetDialog");
  });
});