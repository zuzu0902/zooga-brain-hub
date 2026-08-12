import { describe, expect, it } from "vitest";
import { verifiedWhatsAppConsent } from "@/lib/whatsapp-optin/consent-resolver";
import { evaluateActivation } from "@/lib/tamar-activation/core";

const evidence = (over: any = {}) => ({
  id: "vault:1",
  at: "2026-08-12T07:36:38.000Z",
  buttonId: "consent_yes",
  buttonTitle: "כן",
  text: null,
  repliesToConsentQuestion: true,
  questionStored: true,
  source: "whatsapp_button_reply",
  ...over,
});

describe("verifiedWhatsAppConsent", () => {
  it("accepts complete normalized fields", () => {
    const r = verifiedWhatsAppConsent({
      contact: {
        whatsapp_opt_in_status: "verified",
        whatsapp_opt_in_source: "web_form",
        whatsapp_opt_in_at: "2026-08-01T10:00:00.000Z",
      },
    });
    expect(r.verified).toBe(true);
    expect(r.source).toBe("web_form");
  });

  it("derives from an explicit yes button reply and flags backfill", () => {
    const r = verifiedWhatsAppConsent({ contact: { whatsapp_opt_in_status: "unknown" }, evidence: evidence() });
    expect(r.verified).toBe(true);
    expect(r.at).toBe("2026-08-12T07:36:38.000Z");
    expect(r.evidence_id).toBe("vault:1");
    expect(r.needs_backfill).toBe(true);
  });

  it("does not treat a generic inbound message as consent", () => {
    const r = verifiedWhatsAppConsent({
      contact: { whatsapp_opt_in_status: "unknown" },
      evidence: evidence({ buttonId: null, buttonTitle: null, text: "הי תמר" }),
    });
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("consent_evidence_missing");
  });

  it("blocks when the source is missing", () => {
    const r = verifiedWhatsAppConsent({
      contact: { consent_marketing: true, consent_date: "2026-08-12T07:36:43.000Z" },
    });
    expect(r.verified).toBe(false);
    expect(r.missing).toContain("מקור הסכמה");
  });

  it("blocks when the timestamp is missing", () => {
    const r = verifiedWhatsAppConsent({
      contact: { consent_marketing: true, consent_source: "whatsapp_button" },
    });
    expect(r.verified).toBe(false);
    expect(r.missing).toContain("מועד הסכמה");
  });

  it("opt-out wins over any evidence", () => {
    const r = verifiedWhatsAppConsent({
      contact: { opted_out_at: "2026-08-10T00:00:00.000Z", whatsapp_opt_in_status: "verified", whatsapp_opt_in_source: "web_form", whatsapp_opt_in_at: "2026-08-01T00:00:00.000Z" },
      evidence: evidence(),
    });
    expect(r.status).toBe("denied");
    expect(r.verified).toBe(false);
  });

  it("normalizes the legacy CRM consent record (Meirav shape)", () => {
    const r = verifiedWhatsAppConsent({
      contact: {
        whatsapp_opt_in_status: "unknown",
        consent_marketing: true,
        consent_source: "whatsapp_button",
        consent_date: "2026-08-12T07:36:43.276Z",
      },
    });
    expect(r.verified).toBe(true);
    expect(r.needs_backfill).toBe(true);
  });
});

describe("activation gate uses the same resolver", () => {
  const base = {
    topic: "intake_continue",
    instruction: "לשאול איך הולך ולהמשיך אינטייק",
    sessionWindowOpen: true,
    templateApproved: true,
  } as any;

  it("passes with legacy consent, identical for preview and create", () => {
    const contact = {
      phone: "+972526703322",
      whatsapp_opt_in_status: "unknown",
      consent_marketing: true,
      consent_source: "whatsapp_button",
      consent_date: "2026-08-12T07:36:43.276Z",
    };
    const a = evaluateActivation({ ...base, contact });
    const b = evaluateActivation({ ...base, contact });
    expect(a.allowed).toBe(true);
    expect(a.consent?.source).toBe("whatsapp_button");
    expect(b).toEqual(a);
  });

  it("blocks with the explicit no-evidence reason", () => {
    const g = evaluateActivation({ ...base, contact: { phone: "+972500000000" } });
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe("consent_evidence_missing");
    expect(g.reason_he).toContain("לא נמצאה ראיית הסכמה מפורשת");
  });
});
