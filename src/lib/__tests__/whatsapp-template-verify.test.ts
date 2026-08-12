import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const TPL = {
  name: "zooga_reengagement_followup",
  status: "APPROVED",
  language: "he",
  components: [{ type: "BODY", text: "היי {{1}}, כאן תמר" }],
};

function mockFetch(pages: any[]) {
  let i = 0;
  return vi.fn(async () => {
    const body = pages[Math.min(i, pages.length - 1)];
    i++;
    return { ok: body.__status !== false, json: async () => body } as any;
  });
}

async function freshModule() {
  vi.resetModules();
  return await import("@/lib/whatsapp-templates.server");
}

describe("Meta template verification", () => {
  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = "x";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "111";
    process.env.WHATSAPP_WABA_ID = "1258000000000625";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("APPROVED he template passes", async () => {
    vi.stubGlobal("fetch", mockFetch([{ data: [TPL] }]));
    const { validateTemplateForLaunch } = await freshModule();
    const gate = await validateTemplateForLaunch("zooga_reengagement_followup", "he");
    expect(gate.ok).toBe(true);
    expect(gate.status).toBe("APPROVED");
    expect(gate.variable_count).toBe(1);
  });

  it("normalizes he vs he_IL both ways", async () => {
    vi.stubGlobal("fetch", mockFetch([{ data: [{ ...TPL, language: "he_IL" }] }]));
    const m = await freshModule();
    expect((await m.validateTemplateForLaunch("zooga_reengagement_followup", "he")).ok).toBe(true);
    expect((await m.validateTemplateForLaunch("zooga_reengagement_followup", "he_IL")).ok).toBe(true);
  });

  it("follows pagination", async () => {
    const first = { data: [{ ...TPL, name: "other" }], paging: { next: "https://graph.facebook.com/next" } };
    vi.stubGlobal("fetch", mockFetch([first, { data: [TPL] }]));
    const { validateTemplateForLaunch } = await freshModule();
    expect((await validateTemplateForLaunch("zooga_reengagement_followup", "he")).ok).toBe(true);
  });

  it("API failure is reported as a lookup failure, not as not-approved", async () => {
    vi.stubGlobal("fetch", mockFetch([{ __status: false, error: { message: "rate limited" } }]));
    const { validateTemplateForLaunch } = await freshModule();
    const gate = await validateTemplateForLaunch("zooga_reengagement_followup", "he");
    expect(gate.ok).toBe(false);
    expect(gate.lookup_failed).toBe(true);
    expect(gate.reason).toContain("zooga_reengagement_followup");
    expect(gate.reason).not.toContain("1258000000000625");
  });

  it("wrong WABA (template absent) blocks with an exact reason", async () => {
    vi.stubGlobal("fetch", mockFetch([{ data: [{ ...TPL, name: "hello_world", language: "en_US" }] }]));
    const { validateTemplateForLaunch } = await freshModule();
    const gate = await validateTemplateForLaunch("zooga_reengagement_followup", "he");
    expect(gate.ok).toBe(false);
    expect(gate.lookup_failed).toBeUndefined();
    expect(gate.reason).toContain("לא נמצאה");
    expect(gate.account).toBe("1258***625");
  });

  it("non-approved status blocks and names the status", async () => {
    vi.stubGlobal("fetch", mockFetch([{ data: [{ ...TPL, status: "PENDING" }] }]));
    const { validateTemplateForLaunch } = await freshModule();
    const gate = await validateTemplateForLaunch("zooga_reengagement_followup", "he");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("PENDING");
  });
});

describe("preview and create share the live verifier", () => {
  it("gateActivation performs the live template check when the 24h window is closed", async () => {
    vi.resetModules();
    process.env.WHATSAPP_ACCESS_TOKEN = "x";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "111";
    process.env.WHATSAPP_WABA_ID = "1258000000000625";
    vi.stubGlobal("fetch", mockFetch([{ data: [TPL] }]));
    const { gateActivation } = await import("@/lib/tamar-activation/activation.server");
    const ctx: any = {
      gateInput: {
        topic: "activity_update",
        instruction: "",
        contact: {
          id: "c1",
          phone: "+972500000000",
          whatsapp_opt_in_status: "verified",
          whatsapp_opt_in_source: "whatsapp_button_reply",
          whatsapp_opt_in_at: "2026-08-12T07:36:38Z",
          consent_marketing: true,
        },
        sessionWindowOpen: false,
        offerSelected: true,
        offerSellable: true,
      },
    };
    const preview = await gateActivation(ctx);
    const create = await gateActivation(ctx);
    expect(preview.allowed).toBe(true);
    expect(preview.transport).toBe("template");
    expect(create).toEqual(preview);
  });
});
