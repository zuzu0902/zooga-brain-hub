/**
 * REAL runV2Turn orchestration with DB / Meta / model mocked.
 *
 * Covers: unknown roommate question => pending offer only (no handoff);
 * a following "כן" => exactly one durable handoff + truthful ack; duplicate
 * yes => no second handoff; self-summary excludes inferred/stale/superseded
 * values; an unrelated question after a Vietnam turn does not reuse Vietnam;
 * a failed outbound send leaves the offer link retryable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------ in-memory DB ------------------------------ */

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
let seq = 0;

function match(row: Row, filters: Array<[string, string, any]>): boolean {
  return filters.every(([op, col, val]) => {
    const v = row[col];
    if (op === "eq") return String(v) === String(val);
    if (op === "is") return val === null ? v == null : v === val;
    if (op === "in") return (val as any[]).map(String).includes(String(v));
    if (op === "not_is") return val === null ? v != null : v !== val;
    if (op === "or") {
      return String(val)
        .split(",")
        .some((clause) => {
          const [c, , x] = [clause.split(".")[0], "eq", clause.split(".").slice(2).join(".")];
          return String(row[c!]) === x;
        });
    }
    return true;
  });
}

function table(name: string) {
  db[name] ??= [];
  return db[name]!;
}

function builder(name: string) {
  const filters: Array<[string, string, any]> = [];
  let payload: Row | Row[] | null = null;
  let mode: "select" | "insert" | "update" | "upsert" = "select";
  let limitN = Infinity;

  const run = () => {
    const rows = table(name);
    if (mode === "insert" || mode === "upsert") {
      const list = Array.isArray(payload) ? payload : [payload!];
      const out: Row[] = [];
      for (const p of list) {
        if (mode === "upsert" && p["provider_message_id"]) {
          const dupe = rows.find((r) => r["provider_message_id"] === p["provider_message_id"]);
          if (dupe) { out.push(dupe); continue; }
        }
        const row = { id: `${name}_${++seq}`, ...p };
        rows.push(row);
        out.push(row);
      }
      return { data: out, error: null };
    }
    if (mode === "update") {
      const hit = rows.filter((r) => match(r, filters));
      for (const r of hit) Object.assign(r, payload as Row);
      return { data: hit, error: null };
    }
    return { data: rows.filter((r) => match(r, filters)).slice(0, limitN), error: null };
  };

  const api: any = {
    select: () => api,
    eq: (c: string, v: any) => (filters.push(["eq", c, v]), api),
    is: (c: string, v: any) => (filters.push(["is", c, v]), api),
    in: (c: string, v: any) => (filters.push(["in", c, v]), api),
    not: (c: string, _op: string, v: any) => (filters.push(["not_is", c, v]), api),
    gte: () => api,
    lte: () => api,
    gt: () => api,
    lt: () => api,
    neq: (c: string, v: any) => (filters.push(["not_is", c, v]), api),
    contains: () => api,
    overlaps: () => api,
    range: () => api,
    or: (expr: string) => (filters.push(["or", "", expr]), api),
    order: () => api,
    limit: (n: number) => ((limitN = n), api),
    insert: (p: any) => ((mode = "insert"), (payload = p), api),
    upsert: (p: any) => ((mode = "upsert"), (payload = p), api),
    update: (p: any) => ((mode = "update"), (payload = p), api),
    maybeSingle: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
    then: (res: any, rej?: any) => Promise.resolve(run()).then(res, rej),
  };
  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (n: string) => builder(n), rpc: async () => ({ data: null, error: null }) },
}));

/* ------------------------------ Meta + model ------------------------------ */

const sent: Array<{ to: string; body: string }> = [];
let sendOk = true;

vi.mock("@/lib/whatsapp-meta.server", () => ({
  phoneVariants: (p: string) => [p],
  toE164: (p: any) => (p ? String(p) : null),
  isSessionWindowOpen: async () => true,
  recordDelivery: async () => undefined,
  sendWhatsAppText: async (to: string, body: string) => {
    sent.push({ to, body });
    return sendOk
      ? { ok: true, provider_message_id: `wamid_${sent.length}`, status: 200, error: null }
      : { ok: false, provider_message_id: null, status: 500, error: "meta_down" };
  },
  sendWhatsAppButtons: async (to: string, body: string) => {
    sent.push({ to, body });
    return { ok: sendOk, provider_message_id: "wamid_b", status: sendOk ? 200 : 500, error: null };
  },
  sendWhatsAppList: async (to: string, body: string) => {
    sent.push({ to, body });
    return { ok: sendOk, provider_message_id: "wamid_l", status: sendOk ? 200 : 500, error: null };
  },
  sendWhatsAppTemplate: async () => ({ ok: true, provider_message_id: "wamid_t", status: 200, error: null }),
}));

const handoffCalls: any[] = [];
vi.mock("@/lib/tamar-handoff-core.server", () => ({
  HANDOFF_RECEIPT_TEXT: "כמובן. העברתי את הבקשה שלך לאדם מהצוות של זוגה.",
  ensureHandoff: async (input: any) => {
    handoffCalls.push(input);
    // idempotent: one open handoff per contact
    return {
      handoff_id: "h1",
      task_id: "t1",
      created: handoffCalls.length === 1,
      escalation_count: handoffCalls.length,
      alert_state: "sent",
      alert_error: null,
      manager_configured: true,
      escalated_now: true,
      receipt_text: "כמובן. העברתי את הבקשה שלך לאדם מהצוות של זוגה.",
    };
  },
  healStaleHumanOwnership: async (c: any) => c,
}));

vi.mock("@/lib/conversation-guard/guard.server", () => ({
  guardOutbound: async () => ({ verdict: "send", text: null }),
}));

vi.mock("@/lib/tamar-brain/knowledge.server", () => ({ retrieveKnowledge: async () => [] }));

const writerCalls: any[] = [];
vi.mock("@/lib/tamar-v2/writer.server", () => ({
  writeGroundedAnswer: async (args: any) => {
    writerCalls.push(args);
    return "הנה מה שאני יודעת על הטיול.";
  },
}));

vi.mock("@/lib/tamar-v2/interpreter.server", () => ({
  interpret: async () => ({
    intent: "question",
    confidence: 90,
    fields: {},
    source: "test",
    sentiment: "neutral",
  }),
}));

vi.mock("@/lib/tamar-v2/model-registry.server", () => ({
  // No network in tests: the planner falls back to the deterministic plan.
  callStage: async () => ({ ok: false, content: null, model_id: null, error: "test_no_model" }),
}));
vi.mock("@/lib/zero-loss/identity.server", () => ({ registerIdentity: async () => null }));

import { runV2Turn } from "@/lib/tamar-v2/engine.server";

const CONTACT_ID = "c1";

function seedContact(dyn: Row = {}) {
  db["contacts"] = [
    {
      id: CONTACT_ID,
      phone: "+972500000001",
      whatsapp_number: "+972500000001",
      first_name: "ורדה",
      consent_marketing: true,
      consent_date: "2026-01-01T00:00:00.000Z",
      conversation_state: "consented",
      dynamic_profile_fields: dyn,
    },
  ];
}

function seedOffers() {
  db["offers"] = [
    {
      id: "off_vn",
      title: "טיול לוייטנאם 60+",
      offer_url: "https://www.zooga.co.il/vietnam",
      category: "trip",
      status: "active",
      event_date: "2099-05-01",
      event_end_date: "2099-05-12",
      ai_summary: "טיול מאורגן לוייטנאם",
      matching_tags: ["וייטנאם"],
      grounded_facts: { "יעד": "וייטנאם" },
      faq_bundle: [],
      pricing_status: "published",
      base_price_per_person: 12900,
      currency: "ILS",
      included: ["טיסות"],
      not_included: [],
    },
  ];
}

function contactRow() {
  return db["contacts"]![0]!;
}
function dynOf() {
  return (contactRow()["dynamic_profile_fields"] ?? {}) as Row;
}

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  sent.length = 0;
  handoffCalls.length = 0;
  writerCalls.length = 0;
  sendOk = true;
  seq = 0;
  seedContact();
  seedOffers();
  db["tamar_agent_versions"] = [];
  db["interactions"] = [];
});

const turn = (message: string, extra: Row = {}) =>
  runV2Turn({ phone: "+972500000001", contact_id: CONTACT_ID, message, source: "test", ...extra });

describe("pending product handoff", () => {
  it("an unknown roommate question stores a pending offer and never claims a handoff", async () => {
    await turn("עם מי אשן בחדר בטיול לוייטנאם?");
    expect(handoffCalls).toHaveLength(0);
    const pending = dynOf()["v2_pending_product_handoff"];
    expect(pending).toBeTruthy();
    expect(pending.question).toContain("עם מי אשן");
    const all = sent.map((s) => s.body).join("\n");
    expect(all).toContain("לא יודעת לענות על זה בוודאות");
    expect(all).not.toContain("העברתי את הבקשה");
  });

  it("a following yes creates exactly one handoff with full product context and the ack", async () => {
    await turn("עם מי אשן בחדר בטיול לוייטנאם?");
    await turn("כן");
    expect(handoffCalls).toHaveLength(1);
    const h = handoffCalls[0];
    expect(h.contactId).toBe(CONTACT_ID);
    expect(h.customerPhone).toBe("+972500000001");
    expect(h.suggestedResponse).toContain("עם מי אשן");
    expect(h.latestInbound).toBe("כן");
    expect(h.offerId).toBe("off_vn");
    expect(Array.isArray(h.excerpt)).toBe(true);
    expect(sent.map((s) => s.body).join("\n")).toContain("העברתי את הבקשה");
    expect(dynOf()["v2_pending_product_handoff"]).toBeUndefined();
  });

  it("a duplicate yes does not create a second handoff", async () => {
    await turn("עם מי אשן בחדר בטיול לוייטנאם?");
    await turn("כן");
    await turn("כן");
    expect(handoffCalls).toHaveLength(1);
  });

  it("a stale pending offer is not triggered by an unrelated yes", async () => {
    seedContact({
      v2_pending_product_handoff: {
        offer_id: "off_vn",
        offer_title: "טיול לוייטנאם 60+",
        question: "עם מי אשן?",
        at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
      },
    });
    await turn("כן");
    expect(handoffCalls).toHaveLength(0);
  });
});

describe("self summary provenance", () => {
  it("excludes inferred, stale and superseded values", async () => {
    db["contact_profile_facts"] = [
      { contact_id: CONTACT_ID, field_key: "city", value_text: "חיפה", explicit_or_inferred: "explicit", is_current: true, superseded_by: null },
      { contact_id: CONTACT_ID, field_key: "interests", value_text: "יין וגבינות", explicit_or_inferred: "inferred", is_current: true, superseded_by: null },
      { contact_id: CONTACT_ID, field_key: "residence_city", value_text: "אילת", explicit_or_inferred: "explicit", is_current: false, superseded_by: "old" },
    ];
    db["relationship_intake_answers"] = [
      { contact_id: CONTACT_ID, question_key: "children", raw_text: "שניים", is_current: true, skipped_by_user: false },
      { contact_id: CONTACT_ID, question_key: "height", raw_text: "טעות ישנה", is_current: false, skipped_by_user: false },
    ];
    await turn("מה את יודעת עלי?");
    const body = sent.map((s) => s.body).join("\n");
    expect(body).toContain("חיפה");
    expect(body).toContain("שניים");
    expect(body).toContain("ילדים"); // friendly label, not the key
    expect(body).not.toContain("children");
    expect(body).not.toContain("יין וגבינות");
    expect(body).not.toContain("אילת");
    expect(body).not.toContain("טעות ישנה");
  });
});

describe("product gating", () => {
  it("an unrelated question after a Vietnam turn does not reuse Vietnam", async () => {
    await turn("מה כלול בטיול לוייטנאם?");
    expect(writerCalls.at(-1)!.offerBlock).toContain("וייטנאם");
    writerCalls.length = 0;
    await turn("מי את בכלל?");
    expect(writerCalls.at(-1)?.offerBlock ?? null).toBeNull();
  });

  it("a pronoun follow-up right after a product turn keeps the same offer", async () => {
    await turn("מה כלול בטיול לוייטנאם?");
    writerCalls.length = 0;
    await turn("כמה זה עולה?");
    expect(writerCalls.at(-1)!.offerBlock).toContain("וייטנאם");
  });
});

describe("offer link ledger", () => {
  it("commits only after a successful send and stays retryable when the send fails", async () => {
    sendOk = false;
    await turn("מה כלול בטיול לוייטנאם?");
    expect(sent.map((s) => s.body).join("\n")).toContain("https://www.zooga.co.il/vietnam");
    expect(dynOf()["v2_offer_links_sent"] ?? []).toEqual([]);

    sendOk = true;
    await turn("מה כלול בטיול לוייטנאם?");
    expect(sent.map((s) => s.body).join("\n")).toContain("https://www.zooga.co.il/vietnam");
    expect(dynOf()["v2_offer_links_sent"]).toEqual(["off_vn"]);

    sent.length = 0;
    await turn("ומה עם ארוחות בטיול לוייטנאם?");
    expect(sent.map((s) => s.body).join("\n")).not.toContain("https://www.zooga.co.il/vietnam");
  });
});