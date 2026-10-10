import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { createCoreClient, CoreApiError } from "@/lib/hostinger-core/client";
import { resolveBlockers, sanitizeIntakePatch, canResolveHandoff } from "@/lib/hostinger-core/intake-definitions";
import { auditSource, parseContactWorkflow, fieldLabel } from "@/lib/hostinger-core/contact-workflow";

const def = (k: string, i: number, extra: any = {}) => ({ field_key: k, label: k, question_text: "q", purpose_text: null, presentation: "text", options: [], required: false, skippable: true, order_index: i, enabled: true, stage: "baseline", depends_on: {}, ...extra });
const six = ["first_name", "city", "birth_date", "interests", "relationship_status", "primary_goal"];
const mk = (body: any, status = 200, calls: any[] = []) => createCoreClient({ getToken: async () => "tok", baseUrl: "https://core", fetcher: (async (u: string, i: any) => { calls.push([u, i]); return new Response(JSON.stringify(body), { status }); }) as any });

describe("intake definitions contract", () => {
  it("GET lists sorted definitions with real stage", async () => {
    const calls: any[] = [];
    const defs = await mk({ ok: true, definitions: six.map((k, i) => def(k, 60 - i * 10, k === "birth_date" ? { stage: "progressive" } : {})) }, 200, calls).listIntakeDefinitions();
    expect(calls[0][0]).toBe("https://core/v1/admin/intake-definitions");
    expect(calls[0][1].headers.Authorization).toBe("Bearer tok");
    expect(defs.map(d => d.field_key)).toEqual([...six].reverse());
    expect(defs.find(d => d.field_key === "birth_date")!.stage).toBe("progressive");
  });
  it("rejects malformed definitions", async () => {
    await expect(mk({ ok: true, definitions: [def("x", 1, { stage: "weird" })] }).listIntakeDefinitions()).rejects.toThrow(/core_shape_malformed/);
    await expect(mk({ ok: true }).listIntakeDefinitions()).rejects.toThrow(/core_shape_malformed/);
  });
  it("PATCH sends only editable keys, never options", async () => {
    const calls: any[] = [];
    await mk({ ok: true, definition: def("city", 20) }, 200, calls).patchIntakeDefinition("city", { question_text: "איפה?", options: [], stage: "progressive", enabled: false });
    expect(calls[0][0]).toBe("https://core/v1/admin/intake-definitions/city");
    expect(calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(calls[0][1].body)).toEqual({ question_text: "איפה?", enabled: false });
    expect(() => sanitizeIntakePatch({ order_index: 1.5 })).toThrow();
  });
  it("surfaces 422 codes", async () => {
    await expect(mk({ ok: false, code: "ungrounded_perk_wording" }, 422).patchIntakeDefinition("birth_date", { question_text: "מתנה!" })).rejects.toMatchObject({ status: 422, code: "ungrounded_perk_wording" });
  });
  it("intake tab uses Core only (no legacy server functions/db)", () => {
    const src = readFileSync("src/components/intake-config-tab.tsx", "utf8");
    expect(src).not.toMatch(/useServerFn|onboarding\.functions|supabase|getIntakeStudioConfig/);
    expect(src).toMatch(/listIntakeDefinitions/);
  });
});

describe("handoff resolve contract", () => {
  const ok = { contacted: true, outcome: "resolved", summary: "דיברתי עם הלקוח וסגרנו" };
  it("requires manager confirmation, outcome and summary before any request", async () => {
    const calls: any[] = [];
    const c = mk({ ok: true, handoff: { id: "h1", released: true } }, 200, calls);
    await expect(c.resolveHandoff("h1", { ...ok, contacted: false })).rejects.toThrow(/manager_outcome_required/);
    await expect(c.resolveHandoff("h1", { ...ok, outcome: "auto" })).rejects.toThrow();
    await expect(c.resolveHandoff("h1", { ...ok, summary: "קצר" })).rejects.toThrow();
    expect(resolveBlockers({ ...ok, summary: "x".repeat(2001) }).length).toBe(1);
    expect(calls).toHaveLength(0);
  });
  it("POSTs exact body and parses result", async () => {
    const calls: any[] = [];
    const r = await mk({ ok: true, handoff: { id: "h1", released: false, duplicate: true } }, 200, calls).resolveHandoff("h1", { ...ok, contacted_at: "2026-10-10T10:00:00Z" });
    expect(calls[0][0]).toBe("https://core/v1/admin/handoffs/h1/resolve");
    expect(JSON.parse(calls[0][1].body)).toEqual({ contacted: true, outcome: "resolved", summary: ok.summary, contacted_at: "2026-10-10T10:00:00.000Z" });
    expect(r).toEqual({ id: "h1", released: false, duplicate: true });
  });
  it("422 is a visible CoreApiError", async () => {
    await expect(mk({ ok: false, code: "invalid_outcome" }, 422).resolveHandoff("h1", ok)).rejects.toBeInstanceOf(CoreApiError);
  });
  it("action only on open/claimed handoffs; dialog never auto-submits", () => {
    expect(canResolveHandoff("open")).toBe(true);
    expect(canResolveHandoff("claimed")).toBe(true);
    expect(canResolveHandoff("resolved")).toBe(false);
    const src = readFileSync("src/components/handoff-resolve-dialog.tsx", "utf8");
    expect(src).not.toMatch(/useEffect\([^)]*resolveHandoff|supabase|useServerFn/);
  });
});

describe("workflow intake + audit source", () => {
  it("parses required and definitions_source; labels new keys", () => {
    const w = parseContactWorkflow({ ok: true, workflow: { contact_id: "c", customer_consent: "granted", intake: { state: "in_progress", completed: ["first_name"], missing: ["birth_date", "relationship_status"], required: ["first_name", "relationship_status"], completion_score: 0.5, definitions_source: "core" } } }, "c");
    expect(w.intake.required).toEqual(["first_name", "relationship_status"]);
    expect(w.intake.definitions_source).toBe("core");
    for (const k of ["birth_date", "primary_goal", "manager_summary"]) expect(fieldLabel(k)).toMatch(/[\u0590-\u05FF]/);
  });
  it("labels manager outcomes and historical repairs separately from model analysis", () => {
    expect(auditSource({ record_kind: "manager_outcome", mode: null })).toBe("manager");
    expect(auditSource({ record_kind: "turn", mode: "historical_repair" })).toBe("historical");
    expect(auditSource({ record_kind: "turn", mode: null })).toBe("model");
  });
});
