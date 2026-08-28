/**
 * TAMAR V2 — LONDON active-offer continuity regression (phone ending 7833): reset semantics,
 * referential offer resolution, sensitive accessibility handling,
 * terminal composition and per-wamid idempotency.
 *
 * Original header of the shared harness:
 *
 * The real engine runs against an in-memory database with Meta, the guard
 * and the model stages mocked. It proves the live contract:
 *   one wamid -> one runtime execution -> one outbound envelope;
 *   a retry after delivery writes and sends nothing;
 *   two wamids stay two turns;
 *   a grounded Baku answer never drags in Dubai/Vietnam or an intake question;
 *   only post-guard text reaches the transcript;
 *   explicit CRM writeback is idempotent and inference never overwrites it;
 *   simple turns route to the cheap model, complex turns escalate.
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
        .some((clause) => String(row[clause.split(".")[0]!]) === clause.split(".").slice(2).join("."));
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
  let conflict: string[] = [];
  let limitN = Infinity;

  const run = () => {
    const rows = table(name);
    if (mode === "insert" || mode === "upsert") {
      const list = Array.isArray(payload) ? payload : [payload!];
      const out: Row[] = [];
      for (const p of list) {
        if (mode === "upsert" && conflict.length) {
          const dupe = rows.find((r) => conflict.every((c) => String(r[c]) === String(p[c])));
          if (dupe) continue; // ignoreDuplicates semantics
        }
        const row = { id: `${name}_${++seq}`, created_at: new Date().toISOString(), ...p };
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
    neq: (c: string, v: any) => (filters.push(["not_is", c, v]), api),
    gte: () => api,
    lte: () => api,
    gt: () => api,
    lt: () => api,
    contains: () => api,
    overlaps: () => api,
    range: () => api,
    or: (expr: string) => (filters.push(["or", "", expr]), api),
    order: () => api,
    limit: (n: number) => ((limitN = n), api),
    insert: (p: any) => ((mode = "insert"), (payload = p), api),
    upsert: (p: any, opts?: any) => (
      (mode = "upsert"),
      (payload = p),
      (conflict = String(opts?.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
      api
    ),
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

/* ------------------------------ Meta + stages ----------------------------- */

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
      ? { ok: true, provider_message_id: `wamid_out_${sent.length}`, status: 200, error: null }
      : { ok: false, provider_message_id: null, status: 500, error: "meta_down" };
  },
  sendWhatsAppButtons: async (to: string, body: string) => {
    sent.push({ to, body });
    return { ok: true, provider_message_id: "wamid_b", status: 200, error: null };
  },
  sendWhatsAppList: async (to: string, body: string) => {
    sent.push({ to, body });
    return { ok: true, provider_message_id: "wamid_l", status: 200, error: null };
  },
  sendWhatsAppTemplate: async () => ({ ok: true, provider_message_id: "wamid_t", status: 200, error: null }),
}));

vi.mock("@/lib/tamar-handoff-core.server", () => ({
  HANDOFF_RECEIPT_TEXT: "כמובן. העברתי את הבקשה שלך לאדם מהצוות של זוגה.",
  ensureHandoff: async () => ({ handoff_id: "h1", receipt_text: "העברתי" }),
  healStaleHumanOwnership: async (c: any) => c,
}));

let guardVerdict: { verdict: string; text: string | null } = { verdict: "send", text: null };
vi.mock("@/lib/conversation-guard/guard.server", () => ({
  guardOutbound: async () => guardVerdict,
}));

vi.mock("@/lib/tamar-brain/knowledge.server", () => ({ retrieveKnowledge: async () => [] }));

const writerCalls: any[] = [];
vi.mock("@/lib/tamar-v2/writer.server", () => ({
  writeGroundedAnswer: async (args: any) => {
    writerCalls.push(args);
    // Echo the grounded facts so the outbound text can be asserted directly.
    const block = String(args.offerBlock ?? "");
    const balance = /remaining_balance_per_person_double: ([^\n]+)/.exec(block)?.[1] ?? "";
    const single = /remaining_balance_single_room: ([^\n]+)/.exec(block)?.[1] ?? "";
    const deposit = /deposit: ([^\n]+)/.exec(block)?.[1] ?? "";
    return `יתרת התשלום בחדר זוגי היא ${balance}, ובחדר ליחיד ${single}. המקדמה ששולמה היא ${deposit}, ולכן אני מציגה כל רכיב בנפרד ולא מחשבת סכום כולל.`;
  },
}));

let interpretation: any = {
  intent: "question",
  confidence: 90,
  entities: {},
  source: "test",
  sentiment: "neutral",
  consent_answer: "unknown",
  wants_human: false,
  confusion: false,
  rationale: "",
};
vi.mock("@/lib/tamar-v2/interpreter.server", () => ({
  interpret: async () => interpretation,
}));

vi.mock("@/lib/tamar-v2/model-registry.server", () => ({
  // No network in tests: the planner falls back to the deterministic plan.
  callStage: async () => ({ ok: false, content: null, model_id: null, error: "test_no_model" }),
}));
vi.mock("@/lib/zero-loss/identity.server", () => ({ registerIdentity: async () => null }));



import { runV2Turn } from "@/lib/tamar-v2/engine.server";
import { readFocus } from "@/lib/tamar-v2/focus";

const CONTACT_ID = "c-london";
const PHONE = "+972500007833";
const LONDON_ID = "872132b7-b8e2-4265-8f1e-a1011a3b2f7b";

function seedLondon() {
  db["contacts"] = [
    {
      id: CONTACT_ID,
      phone: PHONE,
      whatsapp_number: PHONE,
      first_name: "אלכס",
      consent_marketing: true,
      consent_date: "2026-01-01T00:00:00.000Z",
      conversation_state: "recommendation_ready",
      dynamic_profile_fields: {
        v2_focus: {
          topic: "הטיול הקלאסי - לונדון",
          offer_id: LONDON_ID,
          provenance: "explicit_mention",
          updated_at: "2026-08-28T10:00:00.000Z",
        },
        v2_last_grounded_offer_id: LONDON_ID,
        v2_sent_offer_ids: [LONDON_ID],
      },
    },
  ];
  db["offers"] = [
    {
      id: LONDON_ID,
      title: "הטיול הקלאסי - לונדון",
      offer_url: "https://www.zooga.co.il/london-classic",
      category: "trip",
      status: "active",
      event_date: "2099-11-01",
      ai_summary: "הטיול הקלאסי ללונדון",
      matching_tags: ["לונדון"],
      grounded_facts: {
        remaining_balance_per_person_double: "1650 $",
        remaining_balance_single_room: "2050 $",
        deposit: "2000 ₪ מקדמה בעת ההרשמה",
      },
      faq_bundle: [],
      pricing_status: "published",
      currency: "ILS",
      included: [],
      not_included: [],
    },
    {
      id: "vn-1",
      title: "טיול לוייטנאם",
      offer_url: "https://www.zooga.co.il/vietnam",
      category: "trip",
      status: "active",
      event_date: "2099-05-01",
      ai_summary: "טיול לוייטנאם",
      matching_tags: ["וייטנאם"],
      grounded_facts: {},
      faq_bundle: [],
      pricing_status: "published",
      currency: "ILS",
      included: [],
      not_included: [],
    },
    {
      id: "vn-2",
      title: "טיול לוייטנאם לבני 60 פלוס",
      offer_url: "https://www.zooga.co.il/vietnam60",
      category: "trip",
      status: "active",
      event_date: "2099-06-01",
      ai_summary: "טיול לוייטנאם לבני 60 פלוס",
      matching_tags: ["וייטנאם"],
      grounded_facts: {},
      faq_bundle: [],
      pricing_status: "published",
      currency: "ILS",
      included: [],
      not_included: [],
    },
  ];
  db["tamar_agent_versions"] = [];
  db["interactions"] = [];
  db["contact_profile_facts"] = [];
}

const turn = (message: string, wamid: string) =>
  runV2Turn({
    phone: PHONE,
    contact_id: CONTACT_ID,
    message,
    source: "meta_webhook",
    inbound_message_id: wamid,
  });

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  sent.length = 0;
  writerCalls.length = 0;
  sendOk = true;
  seq = 0;
  guardVerdict = { verdict: "send", text: null };
  interpretation = {
    intent: "price_question",
    confidence: 90,
    entities: {},
    source: "test",
    sentiment: "neutral",
    consent_answer: "unknown",
    wants_human: false,
    confusion: false,
    rationale: "",
  };
  seedLondon();
});

const contact = () => db["contacts"]![0]!;

describe("London active offer answers the balance/total follow-up", () => {
  it("never clarifies, never mentions Vietnam, and answers from verified facts", async () => {
    await turn("ומה יתרת התשלום? מה הסכום הכולל של הטיול? כמה עולה לי כל הטיול.", "wamid.london.1");

    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    expect(body).not.toContain("וייטנאם");
    expect(body).toContain("1650");
    expect(body).toContain("2050");
    expect(body).toContain("מקדמה");
    expect(body).not.toContain("רק שאדע במדויק");

    expect(writerCalls).toHaveLength(1);
    const block = String(writerCalls[0]!.offerBlock ?? "");
    expect(block).toContain("לונדון");
    expect(block).not.toContain("וייטנאם");
    expect(block).toContain("currency_rule");

    expect(readFocus(contact()["dynamic_profile_fields"]).offer_id).toBe(LONDON_ID);
  });

  it("the corrective turn recovers London and answers the pending question", async () => {
    await turn("ומה יתרת התשלום? מה הסכום הכולל של הטיול?", "wamid.london.2");
    sent.length = 0;
    writerCalls.length = 0;

    await turn("הייתי איתך בשיחה של הטיול ללונדון, על זה שאלתי. כמה עולה לי כל הטיול?", "wamid.london.3");

    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    expect(body).not.toContain("וייטנאם");
    expect(body).toContain("לונדון");
    expect(body).toContain("1650");
    expect(body).toContain("2050");
    expect(String(writerCalls[0]!.offerBlock ?? "")).not.toContain("וייטנאם");
    expect(readFocus(contact()["dynamic_profile_fields"]).offer_id).toBe(LONDON_ID);
  });

  it("produces exactly one outbound envelope for the inbound turn", async () => {
    await turn("ומה יתרת התשלום של הטיול?", "wamid.london.4");
    expect(sent).toHaveLength(1);
  });
});

describe("an explicit new destination still switches the active offer", () => {
  it("moves the focus to the Vietnam 60+ trip", async () => {
    await turn("בעצם מעניין אותי הטיול לוייטנאם לבני 60 פלוס, מה המחיר?", "wamid.london.5");
    expect(readFocus(contact()["dynamic_profile_fields"]).offer_id).toBe("vn-2");
    expect(String(writerCalls[0]!.offerBlock ?? "")).toContain("וייטנאם");
  });
});
