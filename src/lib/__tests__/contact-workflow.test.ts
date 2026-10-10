import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } }));
import { createCoreClient, CoreApiError } from "@/lib/hostinger-core/client";
import { parseContactWorkflow, consentView, mergeOlderMessages, ContactWorkflowShapeError, memoryText } from "@/lib/hostinger-core/contact-workflow";

const ID = "2e794c2a-0c85-4b6f-bbe8-f909e6f65816";
const msg = (id: string, direction: string, text: string, t: string) => ({ id, conversation_id: "c1", direction, content: { text }, occurred_at: t, delivery_state: "delivered" });
export const fixture = { ok: true, workflow: {
  contact_id: ID, customer_consent: "granted",
  intake: { state: "in_progress", completed: ["first_name", "city"], missing: ["relationship_status"], completion_score: 0.66 },
  consents: [
    { channel: "whatsapp", status: "granted", wording_version: "v2", evidence: { ask: { wording: "אפשר לדבר כאן?", sent_at: "2026-10-01T10:00:00Z" }, response: { answer: "yes", text: "כן בכיף", provider_message_id: "wamid.1", responded_at: "2026-10-01T10:01:00Z" } }, source_system: "tamar", recorded_at: "2026-10-01T10:01:00Z" },
    { channel: "whatsapp", status: "granted", wording_version: null, evidence: {}, source_system: "operator", recorded_at: "2026-10-02T10:00:00Z" },
  ],
  conversations: [], messages: [msg("m2", "outbound", "שלום Kobi!\nאני תמר", "2026-10-01T10:00:00Z"), msg("m3", "inbound", "כן בכיף", "2026-10-01T10:01:00Z")],
  next_cursor: "m2", memories: [{ memory_key: "preferences", memory_value: { city: "חיפה" }, payload: {}, source_updated_at: "2026-10-01T11:00:00Z" }],
  facts: [{ field_key: "city", value_text: "חיפה", payload: { evidence_quote: "אני גר בחיפה", source_event_id: "e1" }, observed_at: "2026-10-01T10:05:00Z" }],
  audits: [{ record_kind: "turn", payload: { summary: "מתעניין בטיול", intent: "info" }, source_updated_at: "2026-10-01T10:06:00Z" }],
  handoffs: [{ id: "h1", state: "open", reason: "ביקש נציג", manager_summary: null, created_at: "2026-10-01T12:00:00Z" }],
  tasks: [{ id: "t1", title: "להתקשר", description: "שורה 1\nשורה 2", status: "open", priority: "high", metadata: {}, created_at: "2026-10-01T12:00:00Z" }],
} };

describe("contact workflow", () => {
  it("parses a complete card fixture with multiline text", () => {
    const w = parseContactWorkflow(fixture, ID);
    expect(w.messages.map(m => m.id)).toEqual(["m2", "m3"]);
    expect(w.messages[0].text).toBe("שלום Kobi!\nאני תמר");
    expect(w.facts[0].evidence_quote).toBe("אני גר בחיפה");
    expect(w.intake.missing).toEqual(["relationship_status"]);
    expect(w.tasks[0].description).toContain("\n");
    expect(memoryText(w.memories[0].memory_value)).toBe("עיר: חיפה");
  });
  it("manual/operator consent is not customer confirmation", () => {
    const w = parseContactWorkflow(fixture, ID);
    expect(consentView(w.consents[0])).toMatchObject({ fromCustomer: true, customerText: "כן בכיף" });
    const manual = consentView(w.consents[1]);
    expect(manual.fromCustomer).toBe(false);
    expect(manual.note).toContain("אינו אישור מהלקוח");
  });
  it("rejects another contact's workflow (isolation) and malformed bodies", () => {
    expect(() => parseContactWorkflow(fixture, "other-id")).toThrow(ContactWorkflowShapeError);
    expect(() => parseContactWorkflow({ ok: true }, ID)).toThrow(/missing_workflow/);
    expect(() => parseContactWorkflow({ ok: true, workflow: { ...fixture.workflow, messages: "x" } }, ID)).toThrow(/messages_not_array/);
  });
  it("calls the exact endpoint with bearer and before cursor; surfaces unavailable", async () => {
    const calls: any[] = [];
    const ok = createCoreClient({ getToken: async () => "tok", baseUrl: "https://core", fetcher: (async (u: string, i: any) => { calls.push([u, i.headers.Authorization]); return new Response(JSON.stringify(fixture)); }) as any });
    await ok.getContactWorkflow(ID, "m2");
    expect(calls[0]).toEqual([`https://core/v1/admin/contacts/${ID}/workflow?before=m2`, "Bearer tok"]);
    const down = createCoreClient({ getToken: async () => "tok", fetcher: (async () => new Response(JSON.stringify({ ok: false, code: "not_found" }), { status: 404 })) as any });
    await expect(down.getContactWorkflow(ID)).rejects.toBeInstanceOf(CoreApiError);
  });
  it("pages older messages chronologically without duplicates", () => {
    const w = parseContactWorkflow(fixture, ID);
    const olderPage = parseContactWorkflow({ ok: true, workflow: { ...fixture.workflow, messages: [msg("m1", "outbound", "a", "2026-09-30T10:00:00Z"), msg("m2", "outbound", "dup", "x")], next_cursor: null } }, ID);
    expect(mergeOlderMessages(olderPage.messages, w.messages).map(m => m.id)).toEqual(["m1", "m2", "m3"]);
  });
});
