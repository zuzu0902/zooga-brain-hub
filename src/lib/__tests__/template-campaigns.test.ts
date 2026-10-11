import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { createCoreClient, CoreApiError } from "@/lib/hostinger-core/client";
import { buildRecipients, draftBlockers, normalizeIlMobile, renderTemplatePreview, canLaunch, giftLaunchBlocked, isPending, deliveryLabel, CAMPAIGN_ERROR_TEXT } from "@/lib/hostinger-core/template-campaigns";

const mk = (body: any, status = 200, calls: any[] = []) => createCoreClient({ getToken: async () => "tok", baseUrl: "https://core", fetcher: (async (u: string, i: any) => { calls.push([u, i]); return new Response(JSON.stringify(body), { status }); }) as any });
const camp = (x: any = {}) => ({ id: "c1", name: "n", template_name: "new_members_first_time", language: "he", status: "draft", recipient_count: 1, sent_count: 0, failed_count: 0, pending_count: 1, created_at: null, ...x });
const draft = { name: "סתיו", template_name: "new_members_first_time", idempotency_key: "11111111-2222-3333-4444-555555555555", permission_confirmed: true, consent_basis: "נרשמו בטופס עם הסכמה לדיוור", recipients: [{ phone: "972512277533", name: "Kobi" }] };

describe("template campaign contracts", () => {
  it("lists approved templates with BODY text and gift_ready", async () => {
    const calls: any[] = [];
    const r = await mk({ ok: true, gift_ready: false, templates: [{ id: "1", name: "zooga_dna_gift", status: "APPROVED", language: "he", category: "MARKETING", components: [{ type: "HEADER" }, { type: "BODY", text: "היי {{1}}" }] }, { id: "2", name: "x", status: "PENDING", components: [] }] }, 200, calls).listTemplates();
    expect(calls[0][0]).toBe("https://core/v1/admin/templates");
    expect(calls[0][1].headers.Authorization).toBe("Bearer tok");
    expect(r.templates.map(t => t.name)).toEqual(["zooga_dna_gift"]);
    expect(renderTemplatePreview(r.templates[0].body, "Kobi")).toBe("היי Kobi");
    expect(r.gift_ready).toBe(false);
  });
  it("creates a draft with the exact body and never calls launch", async () => {
    const calls: any[] = [];
    const r = await mk({ ok: true, campaign: camp(), duplicate: false }, 200, calls).createTemplateCampaign(draft);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("https://core/v1/admin/template-campaigns");
    expect(JSON.parse(calls[0][1].body)).toEqual({ ...draft, language: "he" });
    expect(r.campaign.status).toBe("draft");
  });
  it("blocks invalid drafts client-side before any request", async () => {
    const calls: any[] = [];
    const c = mk({}, 200, calls);
    await expect(c.createTemplateCampaign({ ...draft, permission_confirmed: false })).rejects.toThrow(/malformed/);
    await expect(c.createTemplateCampaign({ ...draft, consent_basis: "קצר" })).rejects.toThrow();
    await expect(c.createTemplateCampaign({ ...draft, name: " " })).rejects.toThrow();
    await expect(c.createTemplateCampaign({ ...draft, idempotency_key: "x" })).rejects.toThrow();
    expect(draftBlockers({ ...draft, recipients: Array.from({ length: 501 }, (_, i) => ({ phone: `9725${String(i).padStart(8, "0")}`, name: "" })) })).toContain("מקסימום 500 נמענים");
    expect(calls).toHaveLength(0);
  });
  it("normalizes IL mobiles and dedupes", () => {
    for (const p of ["0512277533", "+972 51-227-7533", "972512277533", "00972512277533"]) expect(normalizeIlMobile(p)).toBe("972512277533");
    expect(normalizeIlMobile("031234567")).toBeNull();
    expect(buildRecipients([{ phone: "0512277533" }, { phone: "+972512277533" }, { phone: "12" }])).toMatchObject({ invalid: 1, duplicates: 1, recipients: [{ phone: "972512277533" }] });
  });
  it("launch hits the draft-specific endpoint and reports duplicates", async () => {
    const calls: any[] = [];
    const r = await mk({ ok: true, campaign: camp({ status: "queued" }), queued: 0, blocked: 0, duplicate: true }, 200, calls).launchTemplateCampaign("c1");
    expect(calls[0][0]).toBe("https://core/v1/admin/template-campaigns/c1/launch");
    expect(calls[0][1].method).toBe("POST");
    expect(r.duplicate).toBe(true);
  });
  it("no double launch: only drafts are launchable; DNA blocked until gift_ready", () => {
    expect(canLaunch(camp(), false)).toBe(true);
    expect(canLaunch(camp({ status: "queued" }), true)).toBe(false);
    expect(giftLaunchBlocked("zooga_dna_gift", false)).toBe(true);
    expect(canLaunch(camp({ template_name: "zooga_dna_gift" }), false)).toBe(false);
    expect(canLaunch(camp({ template_name: "zooga_dna_gift" }), true)).toBe(true);
  });
  it("surfaces 422 codes with Hebrew text", async () => {
    await expect(mk({ ok: false, code: "gift_fulfillment_unconfigured" }, 422).launchTemplateCampaign("c1")).rejects.toMatchObject({ status: 422, code: "gift_fulfillment_unconfigured" });
    for (const k of ["invalid_campaign", "campaign_permission_required", "invalid_recipient_count", "invalid_recipient", "template_not_approved", "campaign_not_found", "campaign_not_draft", "gift_fulfillment_unconfigured"]) expect(CAMPAIGN_ERROR_TEXT[k]).toMatch(/[\u0590-\u05FF]/);
  });
  it("detail rejects another campaign; polling only while pending; accepted is not delivered", async () => {
    await expect(mk({ ok: true, campaign: camp({ id: "other" }), recipients: [] }).getTemplateCampaign("c1")).rejects.toThrow(/campaign_mismatch/);
    expect(isPending(camp({ status: "queued", pending_count: 2 }))).toBe(true);
    expect(isPending(camp({ status: "queued", pending_count: 0 }))).toBe(false);
    expect(isPending(camp())).toBe(false);
    expect(deliveryLabel("accepted")).not.toBe(deliveryLabel("delivered"));
  });
  it("UI uses Core only; legacy gateway sender no longer mounted", () => {
    const ui = readFileSync("src/routes/_app.campaign-manager.tsx", "utf8");
    expect(ui).not.toMatch(/useServerFn|gateway-campaign|supabase|createOutboundCampaign/);
    expect(readFileSync("src/routes/_app.intake-campaign.tsx", "utf8")).not.toMatch(/<QuickCampaign/);
  });
});
