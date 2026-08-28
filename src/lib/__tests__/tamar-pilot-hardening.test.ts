import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isLiveSendAllowed, samePhone } from "@/lib/tamar-pilot/live-allowlist";
import { evaluateConsentOpening, evaluateCampaignSend, consentAskEvidence, consentResponseEvidence, CONSENT_WORDING_VERSION } from "@/lib/whatsapp-optin/core";

const APPROVED = "+972512277833";

describe("live allowlist (last gate before a real send)", () => {
  it("allows only the approved pilot number, in every phone shape", () => {
    expect(isLiveSendAllowed(APPROVED, [APPROVED]).allowed).toBe(true);
    expect(isLiveSendAllowed("972512277833", [APPROVED]).allowed).toBe(true);
    expect(isLiveSendAllowed("0512277833", [APPROVED]).allowed).toBe(true);
    expect(samePhone("0512277833", APPROVED)).toBe(true);
  });

  it("blocks every other number with an audited reason", () => {
    for (const p of ["+972501234567", "0529876543", "+15558675310"]) {
      const d = isLiveSendAllowed(p, [APPROVED]);
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("allowlist_blocked");
    }
  });

  it("fails closed on an empty allowlist or a broken number", () => {
    expect(isLiveSendAllowed(APPROVED, []).reason).toBe("allowlist_empty");
    expect(isLiveSendAllowed("123", [APPROVED]).reason).toBe("invalid_phone");
  });
});

describe("pilot-file eligibility opens consent only, never marketing", () => {
  const imported = {
    phone: APPROVED,
    pilot_eligible_at: new Date().toISOString(),
    whatsapp_opt_in_status: "unknown",
    consent_marketing: null,
    opening_status: "not_sent",
  };

  it("authorizes exactly the consent request", () => {
    const gate = evaluateConsentOpening(imported);
    expect(gate.allowed).toBe(true);
    expect(gate.basis).toBe("pilot_file_eligibility");
  });

  it("still blocks regular marketing until Yes", () => {
    expect(evaluateCampaignSend(imported).allowed).toBe(false);
    expect(evaluateCampaignSend({ ...imported, consent_marketing: true }).allowed).toBe(true);
  });

  it("accepts a verified opt-in or an inbound-initiated conversation", () => {
    expect(
      evaluateConsentOpening({
        phone: APPROVED,
        whatsapp_opt_in_status: "verified",
        whatsapp_opt_in_source: "web_form",
        whatsapp_opt_in_at: new Date().toISOString(),
      }).basis,
    ).toBe("verified_opt_in");
    expect(evaluateConsentOpening({ phone: APPROVED, last_inbound_at: new Date().toISOString() }).basis).toBe(
      "inbound_initiated",
    );
  });

  it("still rejects opted out, denied, human owned, missing phone and duplicate openings", () => {
    const base = { ...imported };
    expect(evaluateConsentOpening({ ...base, opted_out_at: new Date().toISOString() }).reason).toBe("opted_out");
    expect(evaluateConsentOpening({ ...base, whatsapp_opt_in_status: "denied" }).reason).toBe("opt_in_denied");
    expect(evaluateConsentOpening({ ...base, human_owned: true }).reason).toBe("human_owned");
    expect(evaluateConsentOpening({ ...base, phone: null }).reason).toBe("missing_phone");
    expect(evaluateConsentOpening({ ...base, opening_status: "asked" }).reason).toBe("opening_already_sent");
    expect(evaluateConsentOpening({ phone: APPROVED }).reason).toBe("no_opening_authorization");
  });
});

describe("consent evidence shape", () => {
  it("links the question to the answer", () => {
    const ask = consentAskEvidence({
      transport: "template",
      text: "שלום מירב, אני תמר...",
      providerMessageId: "wamid.ask",
      basis: "pilot_file_eligibility",
      askedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(ask.template).toBe("zooga_opening_consent");
    expect(ask.language).toBe("he");
    expect(ask.wording_version).toBe(CONSENT_WORDING_VERSION);
    const response = consentResponseEvidence({
      answer: "yes",
      buttonId: "consent_yes",
      sourceMessageId: "wamid.reply",
      respondedAt: "2026-01-01T00:05:00.000Z",
    });
    expect(response.provider_message_id).toBe("wamid.reply");
    expect(response.source).toBe("whatsapp_reply");
    expect(response.answer).toBe("yes");
  });
});

describe("pilot control center authorization", () => {
  const src = readFileSync("src/lib/tamar-pilot.functions.ts", "utf8");
  it("requires admin on every entry point, including read and dry run", () => {
    expect(src).toContain('_role: "admin"');
    const handlers = src.split(".handler(").slice(1);
    expect(handlers.length).toBe(5);
    for (const h of handlers) expect(h).toContain("assertAdmin(context)");
  });

  it("enforces the allowlist inside the real send paths", () => {
    expect(readFileSync("src/lib/whatsapp-optin/optin.server.ts", "utf8")).toContain("assertLiveSendAllowed");
    expect(readFileSync("src/lib/tamar-pilot/pilot.server.ts", "utf8")).toContain("assertLiveSendAllowed");
  });
});
