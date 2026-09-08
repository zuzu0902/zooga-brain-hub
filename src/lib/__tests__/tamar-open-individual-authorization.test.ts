/**
 * OPEN INDIVIDUAL CONVERSATIONS — authorization model.
 *
 * Alex authorized Tamar individual conversations beyond the single 7833 test
 * number. Inbound from any individual number may reach Tamar; a real outbound
 * to a non-allowlisted number still requires an authenticated admin's explicit
 * single-contact action. Groups, automated/bulk paths, opt-out and idempotency
 * protections are unchanged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isLiveSendAllowed, isGroupTarget } from "@/lib/tamar-pilot/live-allowlist";
import { evaluateConsentOpening, evaluateCampaignSend } from "@/lib/whatsapp-optin/core";

const ALLOWLISTED = ["+972512277833"];
const OTHER = "+972501234567";
const OPEN = { openIndividualSends: true };

describe("1. a non-7833 individual inbound can reach Tamar", () => {
  it("the runtime flag, not the phone allowlist, decides inbound routing", () => {
    const flags = readFileSync("src/lib/tamar-v2/flags.server.ts", "utf8");
    // allowlist is an always-on list; a miss falls through to the global flag
    expect(flags).toContain('if (!row?.enabled) return { enabled: false, reason: "allowlist_miss" }');
    expect(flags).toContain('return { enabled: !!row?.enabled');
  });

  it("an inbound number outside the allowlist is not rejected by a send gate", () => {
    // inbound processing never calls the live-send gate
    const webhook = readFileSync("src/routes/api/public/webhook/tamar.ts", "utf8");
    expect(webhook).not.toContain("assertLiveSendAllowed");
  });
});

describe("2. a non-7833 outbound needs an explicit authenticated admin action", () => {
  it("blocks a non-allowlisted number when no admin initiated the action", () => {
    expect(isLiveSendAllowed(OTHER, ALLOWLISTED, OPEN).allowed).toBe(false);
    expect(isLiveSendAllowed(OTHER, ALLOWLISTED, OPEN).reason).toBe("allowlist_blocked");
  });

  it("allows it for an admin-initiated single-contact action", () => {
    const d = isLiveSendAllowed(OTHER, ALLOWLISTED, { ...OPEN, adminInitiated: true });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("admin_individual_send");
  });

  it("still fails closed when open individual sending is off", () => {
    expect(isLiveSendAllowed(OTHER, ALLOWLISTED, { adminInitiated: true }).allowed).toBe(false);
    expect(isLiveSendAllowed(OTHER, [], { adminInitiated: true }).reason).toBe("allowlist_empty");
    expect(isLiveSendAllowed("123", ALLOWLISTED, { ...OPEN, adminInitiated: true }).reason).toBe("invalid_phone");
  });

  it("the allowlisted pilot number keeps working unconditionally", () => {
    expect(isLiveSendAllowed("0512277833", ALLOWLISTED).allowed).toBe(true);
  });

  it("automated paths never pass adminInitiated (no bulk send)", () => {
    const pilot = readFileSync("src/lib/tamar-pilot/pilot.server.ts", "utf8");
    // the 48h lifecycle follow-up stays allowlist-only
    expect(pilot).toContain('kind: "pilot_followup" }');
    // only the explicit opener carries the admin flag
    expect(pilot).toContain("adminInitiated: args.adminInitiated === true");
    const fns = readFileSync("src/lib/tamar-pilot.functions.ts", "utf8");
    expect(fns).toContain("adminInitiated: true");
    expect(fns).toContain("assertAdmin(context)");
    const optinFns = readFileSync("src/lib/whatsapp-optin.functions.ts", "utf8");
    expect(optinFns).toContain("assertAdmin(context)");
    expect(optinFns).toContain("adminInitiated: true");
  });
});

describe("3. groups remain excluded", () => {
  it("recognizes and blocks group targets", () => {
    expect(isGroupTarget("120363001234567890@g.us")).toBe(true);
    expect(isGroupTarget("972512277833-1600000000")).toBe(true);
    expect(isGroupTarget(OTHER)).toBe(false);
    const d = isLiveSendAllowed("120363001234567890@g.us", ALLOWLISTED, { ...OPEN, adminInitiated: true });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("group_target_blocked");
  });

  it("no group/broadcast module is part of this authorization path", () => {
    const gate = readFileSync("src/lib/tamar-pilot/live-allowlist.server.ts", "utf8");
    expect(gate).not.toMatch(/broadcast|group_folder|bridge/i);
  });
});

describe("4. consent, opt-out and idempotency protections still block sends", () => {
  const base = {
    phone: OTHER,
    pilot_eligible_at: new Date().toISOString(),
    whatsapp_opt_in_status: "unknown",
    consent_marketing: null,
    opening_status: "not_sent",
  };

  it("an unsolicited CRM contact gets no opener just because the number is open", () => {
    expect(evaluateConsentOpening({ phone: OTHER }).reason).toBe("no_opening_authorization");
  });

  it("opt-out blocks, marketing still requires consent, duplicates are refused", () => {
    expect(evaluateConsentOpening({ ...base, opted_out_at: new Date().toISOString() }).reason).toBe("opted_out");
    expect(evaluateConsentOpening({ ...base, opening_status: "asked" }).reason).toBe("opening_already_sent");
    expect(evaluateCampaignSend(base).allowed).toBe(false);
  });

  it("the opener still claims its slot before the network call", () => {
    const optin = readFileSync("src/lib/whatsapp-optin/optin.server.ts", "utf8");
    expect(optin).toContain('opening_status: "sending"');
    expect(optin).toContain("assertLiveSendAllowed");
  });
});
