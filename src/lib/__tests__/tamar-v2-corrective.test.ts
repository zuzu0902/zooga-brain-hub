/**
 * TAMAR V2 — corrective production-path regression: reset semantics,
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
    return "בבאקו נשארים חמישה ימים והטיסות כלולות.";
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

vi.mock("@/lib/zero-loss/identity.server", () => ({ registerIdentity: async () => null }));


import { runV2Turn } from "@/lib/tamar-v2/engine.server";
import { RESET_ACK_TEXT } from "@/lib/tamar-v2/reset";
import { planModelRoute } from "@/lib/tamar-v2/model-routing";

const CONTACT_ID = "c-corrective";
const PHONE = "+972500007833";

function seed(dyn: Row = {}) {
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
        v2_last_offer_id: "off_dubai",
        v2_last_grounded_offer_id: "off_60",
        v2_sent_offer_ids: ["off_dubai", "off_vn"],
        v2_summary: "לקוח: מתעניין בדובאי",
        v2_pending_step: "region",
        ...dyn,
      },
    },
  ];
  db["offers"] = [
    {
      id: "off_60",
      title: "טיול לבני 60 פלוס לוייטנאם",
      offer_url: "https://www.zooga.co.il/vietnam60",
      category: "trip",
      status: "active",
      event_date: "2099-05-01",
      ai_summary: "טיול מאורגן לבני 60 פלוס",
      matching_tags: ["וייטנאם"],
      grounded_facts: { "יעד": "וייטנאם" },
      faq_bundle: [],
      pricing_status: "published",
      base_price_per_person: 12900,
      currency: "ILS",
      included: ["טיסות"],
      not_included: [],
    },
    {
      id: "off_dubai",
      title: "טיול לדובאי",
      offer_url: "https://www.zooga.co.il/dubai",
      category: "trip",
      status: "active",
      event_date: "2099-06-01",
      ai_summary: "טיול לדובאי",
      matching_tags: ["דובאי"],
      grounded_facts: {},
      faq_bundle: [],
      pricing_status: "published",
      currency: "ILS",
      included: [],
      not_included: [],
    },
  ];
  db["tamar_agent_versions"] = [];
  db["interactions"] = [
    { id: "i_old", contact_id: CONTACT_ID, source: "tamar_outbound", content: "הצעה קודמת לדובאי", timestamp: "2026-01-01T00:00:00.000Z" },
  ];
  db["contact_profile_facts"] = [
    { id: "f_old", contact_id: CONTACT_ID, field_key: "region", value_text: "מרכז", is_current: true, explicit_or_inferred: "explicit" },
  ];
}

const turn = (message: string, wamid: string | null, extra: Row = {}) =>
  runV2Turn({
    phone: PHONE,
    contact_id: CONTACT_ID,
    message,
    source: "meta_webhook",
    inbound_message_id: wamid,
    ...extra,
  });

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  sent.length = 0;
  writerCalls.length = 0;
  sendOk = true;
  seq = 0;
  guardVerdict = { verdict: "send", text: null };
  interpretation = {
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
  seed();
});

const contact = () => db["contacts"]![0]!;
const dynOf = () => (contact()["dynamic_profile_fields"] ?? {}) as Row;

describe("explicit conversation reset", () => {
  it("clears volatile state, preserves history and CRM, and sends one clean acknowledgement", async () => {
    await turn("היי נתחיל מחדש ?", "wamid.reset.1");

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toBe(RESET_ACK_TEXT);
    expect(sent[0]!.body).not.toContain("דובאי");
    expect(sent[0]!.body).not.toContain("וייטנאם");

    expect(contact()["conversation_state"]).toBe("consented");
    const dyn = dynOf();
    expect(dyn["v2_last_offer_id"]).toBeUndefined();
    expect(dyn["v2_last_grounded_offer_id"]).toBeUndefined();
    expect(dyn["v2_summary"]).toBeUndefined();
    expect(dyn["v2_pending_step"]).toBeFalsy();

    // durable truth untouched
    expect(db["contact_profile_facts"]!.some((f) => f["id"] === "f_old")).toBe(true);
    expect(db["interactions"]!.some((i) => i["id"] === "i_old")).toBe(true);

    const resets = db["tamar_conversation_resets"] ?? [];
    expect(resets).toHaveLength(1);
    expect(resets[0]!["inbound_message_id"]).toBe("wamid.reset.1");
  });

  it("costs no model call and never repeats the reset event on retry", async () => {
    await turn("נתחיל מחדש", "wamid.reset.2");
    expect(writerCalls).toHaveLength(0);
    await turn("נתחיל מחדש", "wamid.reset.2");
    expect(db["tamar_conversation_resets"]).toHaveLength(1);
  });
});

describe("referential offer resolution", () => {
  it("resolves 'הטיול הזה של בני 60' to that exact offer", async () => {
    await turn("ספרי לי רגע על הטיול הזה של בני 60, במה מדובר?", "wamid.ref.1");
    expect(writerCalls).toHaveLength(1);
    expect(String(writerCalls[0]!.offerBlock ?? "")).toContain("בני 60");
    expect(sent).toHaveLength(1);
  });

  it("an ambiguous reference produces exactly one clarification and no offers", async () => {
    await turn("ספרי לי על הטיול הזה", "wamid.ref.2");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain("?");
    expect(sent[0]!.body).not.toContain("https://");
    expect(writerCalls).toHaveLength(0);
  });
});

describe("sensitive accessibility handling", () => {
  const ASK = "ספרי לי רגע על הטיול הזה של בני 60. אני על כיסא גלגלים, אני יכול להגיע לטיול הזה?";

  it("never promises suitability, answers once and opens one human follow-up task", async () => {
    await turn(ASK, "wamid.acc.1", { source: "meta_webhook_voice" });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain("אין לי כרגע מידע מאומת");
    expect(sent[0]!.body).not.toContain("https://");
    expect(writerCalls).toHaveLength(0);

    const tasks = db["tasks"] ?? [];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!["offer_id"]).toBe("off_60");
    expect(tasks[0]!["source_message_id"]).toBe("wamid.acc.1");
    expect(tasks[0]!["status"]).toBe("open");
  });

  it("a retry of the same voice wamid creates no duplicate task or writeback", async () => {
    await turn(ASK, "wamid.acc.2", { source: "meta_webhook_voice" });
    const facts = (db["contact_profile_facts"] ?? []).length;
    await turn(ASK, "wamid.acc.2", { source: "meta_webhook_voice" });
    expect(db["tasks"]).toHaveLength(1);
    expect(db["tamar_writeback_ledger"]).toHaveLength(1);
    expect((db["contact_profile_facts"] ?? []).length).toBe(facts);
  });

  it("two different wamids remain two turns with linked, source-bearing snapshots", async () => {
    await turn(ASK, "wamid.acc.3", { source: "meta_webhook_voice" });
    await turn("ומה עם המחיר?", "wamid.acc.4");
    expect(db["tamar_runtime_executions"]).toHaveLength(2);
    expect(db["tamar_context_snapshots"]).toHaveLength(2);
    const snap = db["tamar_context_snapshots"]!.find((s) => s["inbound_message_id"] === "wamid.acc.4")!;
    expect(snap["source_ids"]["contact_id"]).toBe(CONTACT_ID);
    expect(snap["decision_trace_id"]).toBeTruthy();
  });
});

describe("cost-aware routing stays intact", () => {
  it("simple turns keep the cheap model", () => {
    const plan = planModelRoute({
      stage: "response_writer",
      model_id: "openai/gpt-5.6-terra",
      cheap_model: "openai/gpt-5.6-luna",
      complexity: "simple",
      allowlist: ["openai/gpt-5.6-luna", "openai/gpt-5.6-terra"],
    });
    expect(plan.model_id).toBe("openai/gpt-5.6-luna");
  });
});
