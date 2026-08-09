import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { classifyTurnOutcome, isValidNoReplyReason } from "@/lib/zero-loss/turn-outcome";
import { ContactCreateError } from "@/lib/contact-create-error";

const read = (p: string) => readFileSync(p, "utf8");

const CONTACT_INSERT_FILES = [
  "src/lib/tamar-v2/engine.server.ts",
  "src/lib/zero-loss/identity.server.ts",
  "src/lib/onboarding/onboarding.server.ts",
  "src/lib/lead-contacts.server.ts",
  "src/lib/leads.functions.ts",
  "src/lib/tamar-engine.server.ts",
];

describe("contacts.full_name is a GENERATED column", () => {
  for (const file of CONTACT_INSERT_FILES) {
    it(`never inserts full_name into contacts: ${file}`, () => {
      const src = read(file);
      // find every insert payload block and assert it has no full_name key
      const inserts = src.split('.from("contacts")').slice(1);
      for (const chunk of inserts) {
        const head = chunk.slice(0, 900);
        if (!/^\s*\n?\s*\.(insert|upsert)\(/m.test(head.split("\n").slice(0, 3).join("\n"))) continue;
        const payload = head.slice(0, head.indexOf("})") + 2);
        expect(payload).not.toMatch(/\bfull_name\s*:/);
      }
    });
  }

  it("does not swallow contact insert errors in the v2 engine", () => {
    const src = read("src/lib/tamar-v2/engine.server.ts");
    expect(src).toMatch(/const \{ data, error \} = await supabaseAdmin/);
    expect(src).toMatch(/ContactCreateError/);
  });

  it("classified error masks the phone and carries a correlation id", () => {
    const err = new ContactCreateError({ phone: "+972512277833", message: "boom" });
    expect(err.phone_masked).not.toContain("512277");
    expect(err.phone_masked).toMatch(/7833$/);
    expect(err.correlation_id).toBeTruthy();
    expect(String(err.message)).not.toContain("972512277833");
  });
});

describe("processing job success gate", () => {
  it("contact creation failure is never succeeded", () => {
    const o = classifyTurnOutcome({ contactId: null, sends: [], error: "contact_create_failed", attempt: 1 });
    expect(o.success).toBe(false);
    expect(o.retryable).toBe(true);
  });

  it("missing contact on a reply-required turn fails", () => {
    expect(classifyTurnOutcome({ contactId: null, sends: [] }).success).toBe(false);
    expect(classifyTurnOutcome({ contactId: null, sends: [] }).reason).toBe("contact_missing");
  });

  it("sends=[] without a valid reason is a failure", () => {
    const o = classifyTurnOutcome({ contactId: "c1", sends: [] });
    expect(o.success).toBe(false);
    expect(o.reason).toBe("no_outbound_without_reason");
  });

  it("an unknown no-reply reason is not accepted", () => {
    const o = classifyTurnOutcome({ contactId: "c1", sends: [], noReplyReason: "because" });
    expect(o.success).toBe(false);
  });

  for (const reason of ["opt_out_suppressed", "suppressed_human_owned", "duplicate_inbound", "simulate", "silent_by_policy"]) {
    it(`valid no-reply reason succeeds: ${reason}`, () => {
      expect(isValidNoReplyReason(reason)).toBe(true);
      const o = classifyTurnOutcome({ contactId: "c1", sends: [], noReplyReason: reason });
      expect(o.success).toBe(true);
      expect(o.reason).toBe(reason);
    });
  }

  it("a delivered reply succeeds", () => {
    expect(classifyTurnOutcome({ contactId: "c1", sends: [{ ok: true }] }).success).toBe(true);
  });

  it("a failed send is retryable, then quarantined at max attempts", () => {
    expect(classifyTurnOutcome({ contactId: "c1", sends: [{ ok: false }], attempt: 1, maxAttempts: 3 })).toMatchObject({
      success: false,
      retryable: true,
      quarantine: false,
    });
    expect(classifyTurnOutcome({ contactId: "c1", sends: [{ ok: false }], attempt: 3, maxAttempts: 3 })).toMatchObject({
      success: false,
      retryable: false,
      quarantine: true,
    });
  });

  it("retry of an already answered inbound is idempotent (duplicate => success, no resend)", () => {
    const first = classifyTurnOutcome({ contactId: "c1", sends: [{ ok: true }] });
    const retry = classifyTurnOutcome({ contactId: "c1", sends: [], noReplyReason: "duplicate_inbound" });
    expect(first.success && retry.success).toBe(true);
  });
});

describe("worker / processor contracts", () => {
  it("the vault processor refuses to succeed without a contact", () => {
    expect(read("src/lib/zero-loss/processor.server.ts")).toMatch(/contact_resolution_failed: contact_missing/);
  });

  it("the webhook no longer closes every leased job as succeeded", () => {
    const src = read("src/routes/api/public/webhook/tamar.ts");
    expect(src).not.toMatch(/finishJob\(\{ jobId, success: true, attempt: 1 \}\)/);
    expect(src).toMatch(/classifyTurnOutcome/);
  });

  it("identity registry re-links a deleted contact to a fresh one", () => {
    const src = read("src/lib/zero-loss/identity.server.ts");
    // contact_id from the registry is discarded when the contact no longer exists
    expect(src).toMatch(/if \(!alive\) contactId = null;/);
    expect(src).toMatch(/registerIdentity\(e164, contactId, source\)/);
  });
});
