import { describe, it, expect } from "vitest";
import {
  autofillParams,
  buildTemplateComponents,
  diffTemplatesForSync,
  eligibleTemplates,
  parseMetaTemplate,
  renderTemplatePreview,
  sameLanguage,
  templateBlockReason,
  templateSelectionSignature,
  validateTemplateParams,
  type TemplateRecord,
} from "@/lib/whatsapp-templates/schema";
import { evaluateActivation, type ActivationGateInput } from "@/lib/tamar-activation/core";

const META_TPL = {
  id: "1234",
  name: "zooga_reengagement_followup",
  language: "he",
  status: "APPROVED",
  category: "MARKETING",
  components: [
    { type: "HEADER", format: "TEXT", text: "זוגה" },
    { type: "BODY", text: "היי {{1}}, כאן תמר. רוצה שאשלח פרטים?", example: { body_text: [["דנה"]] } },
    { type: "FOOTER", text: "אפשר להשיב STOP" },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "כן" }] },
  ],
};

function record(over: Partial<TemplateRecord> = {}): TemplateRecord {
  return {
    ...parseMetaTemplate(META_TPL),
    id: "t1",
    purpose: "activity_update",
    topics: ["activity_update"],
    is_default: true,
    requires_active_offer: true,
    allowed_offer_categories: [],
    variable_mappings: { "1": "first_name" },
    variable_defaults: {},
    is_available: true,
    last_checked_at: "2026-08-12T10:00:00.000Z",
    sync_error: null,
    ...over,
  };
}

describe("Meta template parsing and sync", () => {
  it("parses body, header, footer, buttons and variables", () => {
    const p = parseMetaTemplate(META_TPL);
    expect(p.meta_template_id).toBe("1234");
    expect(p.category).toBe("MARKETING");
    expect(p.variable_count).toBe(1);
    expect(p.variable_schema[0]).toMatchObject({ index: 1, example: "דנה" });
    expect(p.buttons[0]!.text).toBe("כן");
    expect(p.footer_text).toBe("אפשר להשיב STOP");
  });

  it("normalizes he vs he_IL", () => {
    expect(sameLanguage("he", "he_IL")).toBe(true);
    expect(sameLanguage("he", "en_US")).toBe(false);
  });

  it("soft-disables stored templates Meta no longer returns", () => {
    const plan = diffTemplatesForSync(
      [
        { id: "a", name: "zooga_reengagement_followup", language: "he", is_available: true },
        { id: "b", name: "gone_template", language: "he", is_available: true },
      ],
      [parseMetaTemplate(META_TPL)],
    );
    expect(plan.upserts).toHaveLength(1);
    expect(plan.softDisable.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("template eligibility", () => {
  it("approved + mapped + sellable offer is usable", () => {
    expect(templateBlockReason(record(), { topic: "activity_update", offerSellable: true })).toBeNull();
  });
  it("pending / rejected are blocked", () => {
    for (const status of ["PENDING", "REJECTED", "PAUSED", "DISABLED"]) {
      const r = templateBlockReason(record({ status }), { topic: "activity_update", offerSellable: true });
      expect(r).toContain(status);
    }
  });
  it("wrong language is blocked", () => {
    expect(
      templateBlockReason(record(), { topic: "activity_update", offerSellable: true, language: "en_US" }),
    ).toContain("שפה");
  });
  it("removed from the WABA is blocked", () => {
    expect(
      templateBlockReason(record({ is_available: false }), { topic: "activity_update", offerSellable: true }),
    ).toContain("אינה קיימת");
  });
  it("consent template is reserved", () => {
    const consent = record({ name: "zooga_opening_consent", purpose: "consent_opening", topics: [] });
    expect(templateBlockReason(consent, { topic: "activity_update", offerSellable: true })).toContain("הסכמה");
    expect(templateBlockReason(consent, { topic: "activity_update", consentOpening: true, offerSellable: true })).toBeNull();
  });
  it("requires_active_offer without a sellable offer is blocked", () => {
    expect(templateBlockReason(record(), { topic: "activity_update", offerSellable: false })).toContain("פעילות פעילה");
  });
  it("unmapped topic is blocked and filtered out of the dropdown", () => {
    expect(eligibleTemplates([record()], { topic: "community_intro", offerSellable: true })).toHaveLength(0);
    expect(eligibleTemplates([record()], { topic: "activity_update", offerSellable: true })).toHaveLength(1);
  });
});

describe("parameters", () => {
  it("auto-fills the first name and renders the exact preview", () => {
    const p = autofillParams(record(), { firstName: "מירב לוי" });
    expect(p).toEqual(["מירב"]);
    expect(renderTemplatePreview(record(), p)).toContain("היי מירב");
    expect(buildTemplateComponents(p)).toEqual([
      { type: "body", parameters: [{ type: "text", text: "מירב" }] },
    ]);
  });
  it("falls back respectfully when no name is known", () => {
    expect(autofillParams(record(), {})).toEqual(["חבר/ה יקר/ה"]);
  });
  it("blocks missing and extra parameters", () => {
    expect(validateTemplateParams(record(), []).reason_he).toContain("{{1}}");
    expect(validateTemplateParams(record(), ["a", "b"]).reason_he).toContain("1 משתנים");
    expect(validateTemplateParams(record(), ["a"]).ok).toBe(true);
  });
  it("selection or parameter change invalidates the preview signature", () => {
    const a = templateSelectionSignature({ templateId: "t1", topic: "activity_update", offerId: "o", params: ["x"] });
    const b = templateSelectionSignature({ templateId: "t1", topic: "activity_update", offerId: "o", params: ["y"] });
    expect(a).not.toBe(b);
  });
});

function gateInput(over: Partial<ActivationGateInput> = {}): ActivationGateInput {
  return {
    topic: "activity_update",
    instruction: "לחדש קשר בעדינות",
    contact: {
      id: "c1",
      phone: "+972500000000",
      consent_marketing: true,
      whatsapp_opt_in_status: "granted",
      whatsapp_opt_in_at: "2026-08-01T00:00:00.000Z",
      whatsapp_opt_in_source: "whatsapp_button_reply",
    },
    sessionWindowOpen: false,
    offerSelected: true,
    offerSellable: true,
    selectedTemplate: {
      id: "t1",
      name: "zooga_reengagement_followup",
      language: "he",
      status: "APPROVED",
      category: "MARKETING",
      blockReasonHe: null,
      paramsValid: true,
      paramsReasonHe: null,
      liveApproved: true,
      liveReasonHe: null,
    },
    ...over,
  };
}

describe("activation gate with a picked template", () => {
  it("sends through the template outside the window", () => {
    const g = evaluateActivation(gateInput());
    expect(g.allowed).toBe(true);
    expect(g.transport).toBe("template");
  });
  it("blocks when Meta is not APPROVED at send time", () => {
    const g = evaluateActivation(
      gateInput({
        selectedTemplate: { ...gateInput().selectedTemplate!, liveApproved: false, liveReasonHe: "בסטטוס PENDING" },
      }),
    );
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe("template_not_approved");
  });
  it("blocks a MARKETING template without marketing consent", () => {
    const g = evaluateActivation(
      gateInput({ contact: { ...gateInput().contact!, consent_marketing: false } }),
    );
    expect(g.allowed).toBe(false);
  });
  it("blocks invalid parameters", () => {
    const g = evaluateActivation(
      gateInput({ selectedTemplate: { ...gateInput().selectedTemplate!, paramsValid: false, paramsReasonHe: "חסר {{1}}" } }),
    );
    expect(g.reason).toBe("template_params_invalid");
  });
  it("never uses the reserved consent template for a follow-up", () => {
    const g = evaluateActivation(
      gateInput({ selectedTemplate: { ...gateInput().selectedTemplate!, name: "zooga_opening_consent" } }),
    );
    expect(g.reason).toBe("reserved_template");
  });
  it("an opted-out contact is always blocked", () => {
    const g = evaluateActivation(
      gateInput({ contact: { ...gateInput().contact!, opted_out_at: "2026-08-05T00:00:00.000Z" } }),
    );
    expect(g.allowed).toBe(false);
  });
  it("blocks with an exact reason when the window is closed and no template is picked", () => {
    const g = evaluateActivation(gateInput({ topic: "community_intro", selectedTemplate: null }));
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe("no_service_window_no_template");
    expect(g.reason_he).toContain("תבנית מאושרת");
  });
  it("free text is allowed while the window is open", () => {
    const g = evaluateActivation(gateInput({ sessionWindowOpen: true }));
    expect(g.transport).toBe("session");
  });
});