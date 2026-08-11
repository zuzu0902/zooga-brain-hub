import { describe, it, expect } from "vitest";
import {
  classifyConsentReply,
  evaluateCampaignSend,
  evaluateConsentOpening,
  isVerifiedOptIn,
  normalizeOptInStatus,
  consentOpeningText,
} from "@/lib/whatsapp-optin/core";

const verified = {
  whatsapp_opt_in_status: "verified",
  whatsapp_opt_in_at: "2026-08-01T00:00:00Z",
  whatsapp_opt_in_source: "import_file",
  phone: "+972500000000",
  opening_status: "not_sent",
  consent_marketing: false,
};

describe("opt-in vs marketing consent separation", () => {
  it("allows the consent opening for a verified contact WITHOUT marketing consent", () => {
    expect(evaluateConsentOpening(verified).allowed).toBe(true);
  });

  it("blocks the consent opening for unknown opt-in", () => {
    const g = evaluateConsentOpening({ ...verified, whatsapp_opt_in_status: "unknown" });
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe("opt_in_unknown");
    expect(g.reason_he).toBeTruthy();
  });

  it("blocks the consent opening for denied opt-in", () => {
    expect(evaluateConsentOpening({ ...verified, whatsapp_opt_in_status: "denied" }).reason).toBe(
      "opt_in_denied",
    );
  });

  it("treats verified without source or date as incomplete", () => {
    expect(isVerifiedOptIn({ ...verified, whatsapp_opt_in_source: null })).toBe(false);
    expect(evaluateConsentOpening({ ...verified, whatsapp_opt_in_at: null }).reason).toBe(
      "opt_in_incomplete",
    );
  });

  it("never re-sends the opening once it was asked (no duplicates, no loops)", () => {
    expect(evaluateConsentOpening({ ...verified, opening_status: "asked" }).reason).toBe(
      "opening_already_sent",
    );
    expect(evaluateConsentOpening({ ...verified, opening_status: "declined" }).reason).toBe(
      "opening_already_sent",
    );
  });

  it("blocks opted-out contacts even when verified", () => {
    expect(evaluateConsentOpening({ ...verified, opted_out_at: "2026-08-02" }).reason).toBe("opted_out");
  });

  it("regular campaigns still require marketing consent", () => {
    expect(evaluateCampaignSend(verified).reason).toBe("no_marketing_consent");
    expect(evaluateCampaignSend({ ...verified, consent_marketing: true }).allowed).toBe(true);
    expect(
      evaluateCampaignSend({ ...verified, consent_marketing: true, opted_out_at: "2026-08-02" }).reason,
    ).toBe("opted_out");
  });

  it("normalizes unexpected statuses to unknown", () => {
    expect(normalizeOptInStatus("bogus")).toBe("unknown");
    expect(normalizeOptInStatus(null)).toBe("unknown");
    expect(normalizeOptInStatus("verified")).toBe("verified");
  });
});

describe("consent reply classification", () => {
  it("accepts yes answers", () => {
    for (const t of ["כן", "בשמחה", "מאשרת", "אוקיי", "yes", "OK"]) {
      expect(classifyConsentReply({ text: t })).toBe("yes");
    }
  });

  it("accepts no answers", () => {
    for (const t of ["לא", "לא תודה", "לא מעוניין", "הסר", "stop"]) {
      expect(classifyConsentReply({ text: t })).toBe("no");
    }
  });

  it("reads button ids", () => {
    expect(classifyConsentReply({ buttonId: "consent_yes" })).toBe("yes");
    expect(classifyConsentReply({ buttonId: "consent_no" })).toBe("no");
  });

  it("does not hijack ordinary sentences", () => {
    expect(classifyConsentReply({ text: "יש לכם טיול לאלבניה בספטמבר?" })).toBeNull();
    expect(classifyConsentReply({ text: "" })).toBeNull();
  });

  it("keeps the approved opening wording", () => {
    const text = consentOpeningText("אורלי");
    expect(text).toContain("אורלי");
    expect(text).toContain("תמר");
    expect(text).toContain("מאשר/ת");
  });
});