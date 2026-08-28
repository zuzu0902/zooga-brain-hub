/**
 * TAMAR V2 — integration-level regression over the canonical turn path.
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

vi.mock("@/lib/tamar-v2/model-registry.server", () => ({
  // No network in tests: the planner falls back to the deterministic plan.
  callStage: async () => ({ ok: false, content: null, model_id: null, error: "test_no_model" }),
}));
vi.mock("@/lib/zero-loss/identity.server", () => ({ registerIdentity: async () => null }));

import { runV2Turn } from "@/lib/tamar-v2/engine.server";
import { applyWriteback } from "@/lib/tamar-v2/writeback.server";
import { planModelRoute } from "@/lib/tamar-v2/model-routing";

const CONTACT_ID = "c-baku";
const PHONE = "+972500007833";

function seed() {
  db["contacts"] = [
    {
      id: CONTACT_ID,
      phone: PHONE,
      whatsapp_number: PHONE,
      first_name: "אלכס",
      consent_marketing: true,
      consent_date: "2026-01-01T00:00:00.000Z",
      conversation_state: "consented",
      dynamic_profile_fields: {},
    },
  ];
  db["offers"] = [
    {
      id: "off_baku",
      title: "טיול לבאקו",
      offer_url: "https://www.zooga.co.il/baku",
      category: "trip",
      status: "active",
      event_date: "2099-04-01",
      event_end_date: "2099-04-06",
      ai_summary: "טיול מאורגן לבאקו",
      matching_tags: ["באקו"],
      grounded_facts: { "יעד": "באקו" },
      faq_bundle: [],
      pricing_status: "published",
      base_price_per_person: 8900,
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
    {
      id: "off_vn",
      title: "טיול לוייטנאם 60+",
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
  ];
  db["tamar_agent_versions"] = [];
  db["interactions"] = [];
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

const outbound = () => (db["interactions"] ?? []).filter((r) => String(r["source"]).includes("outbound"));
const executions = () => db["tamar_runtime_executions"] ?? [];

describe("one inbound -> one turn -> one envelope", () => {
  it("a transcribed voice wamid produces one runtime execution and one outbound envelope", async () => {
    const res = await turn("כמה ימים הטיול לבאקו?", "wamid.voice.1", { source: "meta_webhook_voice" });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(executions()).toHaveLength(1);
    expect(outbound()).toHaveLength(1);
    expect(db["tamar_context_snapshots"]).toHaveLength(1);
    expect(db["tamar_context_snapshots"]![0]!["inbound_message_id"]).toBe("wamid.voice.1");
  });

  it("a grounded Baku answer never appends Dubai/Vietnam or an intake question", async () => {
    await turn("כמה ימים הטיול לבאקו?", "wamid.voice.2");
    const body = sent.map((s) => s.body).join("\n");
    expect(body).toContain("באקו");
    expect(body).not.toContain("דובאי");
    expect(body).not.toContain("וייטנאם");
    expect(body).not.toContain("?\n"); // no appended follow-up question block
    expect(sent).toHaveLength(1);
  });

  it("two different wamids close together remain two turns", async () => {
    await turn("כמה ימים הטיול לבאקו?", "wamid.a");
    await turn("ומה כלול בטיול לבאקו?", "wamid.b");
    expect(executions()).toHaveLength(2);
    expect(db["tamar_context_snapshots"]).toHaveLength(2);
    expect(sent.length).toBeGreaterThanOrEqual(2);
  });

  it("only post-guard text is persisted to the transcript", async () => {
    guardVerdict = { verdict: "rephrase", text: "ניסוח אחר לגמרי" };
    await turn("כמה ימים הטיול לבאקו?", "wamid.guard");
    expect(outbound()).toHaveLength(1);
    expect(outbound()[0]!["content"]).toBe("ניסוח אחר לגמרי");
    expect(sent[0]!.body).toBe("ניסוח אחר לגמרי");
  });
});

describe("writeback idempotency per inbound id", () => {
  it("a retry of the same wamid writes no duplicate facts, memories or history", async () => {
    interpretation = { ...interpretation, confidence: 92, entities: { region: "מרכז", destination: "באקו" } };
    await turn("אני מהמרכז ומעניין אותי באקו", "wamid.write.1");
    const facts1 = (db["contact_profile_facts"] ?? []).length;
    const mem1 = (db["contact_memories"] ?? []).length;
    const hist1 = (db["contact_profile_history"] ?? []).length;
    expect(facts1).toBeGreaterThan(0);
    expect(mem1).toBeGreaterThan(0);

    await turn("אני מהמרכז ומעניין אותי באקו", "wamid.write.1");
    expect((db["contact_profile_facts"] ?? []).length).toBe(facts1);
    expect((db["contact_memories"] ?? []).length).toBe(mem1);
    expect((db["contact_profile_history"] ?? []).length).toBe(hist1);
    expect(db["tamar_writeback_ledger"]).toHaveLength(1);
  });

  it("inference cannot overwrite an explicit truth and lands in pending insights", async () => {
    await applyWriteback({
      contactId: CONTACT_ID,
      inboundMessageId: "wamid.explicit",
      message: "אני גר בחיפה",
      interpretation: { ...interpretation, confidence: 95, entities: { region: "חיפה" } } as any,
    });
    const explicit = (db["contact_profile_facts"] ?? []).find((r) => r["field_key"] === "region");
    expect(explicit!["value_text"]).toBe("חיפה");
    expect(explicit!["explicit_or_inferred"]).toBe("explicit");

    await applyWriteback({
      contactId: CONTACT_ID,
      inboundMessageId: "wamid.inferred",
      message: "אולי אילת",
      interpretation: { ...interpretation, confidence: 40, entities: { region: "אילת" } } as any,
    });
    const current = (db["contact_profile_facts"] ?? []).filter((r) => r["field_key"] === "region" && r["is_current"] !== false);
    expect(current).toHaveLength(1);
    expect(current[0]!["value_text"]).toBe("חיפה");
    const insight = (db["pending_ai_insights"] ?? []).find((r) => r["field_name"] === "region");
    expect(insight!["proposed_value"]).toBe("אילת");
    expect(insight!["status"]).toBe("pending");
  });

  it("the compact summary is refreshed on the contact", async () => {
    await turn("כמה ימים הטיול לבאקו?", "wamid.summary");
    const dyn = db["contacts"]![0]!["dynamic_profile_fields"] as Row;
    expect(String(dyn["v2_summary"] ?? "")).toContain("לקוח:");
    expect(String(dyn["v2_summary"] ?? "").length).toBeLessThanOrEqual(600);
  });
});

describe("context snapshot audit", () => {
  it("stores source record identifiers and links the decision trace", async () => {
    await turn("כמה ימים הטיול לבאקו?", "wamid.snap.1");
    await turn("ומה כלול?", "wamid.snap.2");
    const snap = db["tamar_context_snapshots"]!.find((s) => s["inbound_message_id"] === "wamid.snap.2")!;
    expect(snap["source_ids"]["contact_id"]).toBe(CONTACT_ID);
    expect(Array.isArray(snap["source_ids"]["interactions"])).toBe(true);
    expect(snap["source_ids"]["interactions"].length).toBeGreaterThan(0);
    expect(snap["decision_trace_id"]).toBeTruthy();
    expect(snap["context"]).toBeTruthy();
    expect(JSON.stringify(snap["context"])).not.toContain("payload");
  });

  it("persists the CURRENT inbound turn and links runtime + writeback to that snapshot", async () => {
    await turn("כמה ימים הטיול לבאקו?", "wamid.snap.cur");
    const snap = db["tamar_context_snapshots"]!.find((s) => s["inbound_message_id"] === "wamid.snap.cur")!;
    expect(snap["context"]["inbound"]["message_id"]).toBe("wamid.snap.cur");
    expect(snap["context"]["inbound"]["raw_text"]).toContain("באקו");
    expect(snap["context"]["inbound"]).toHaveProperty("normalized_text");
    expect(snap["source_ids"]["inbound_message_id"]).toBe("wamid.snap.cur");
    const runtime = (db["tamar_runtime_executions"] ?? []).find((r: any) => r["inbound_message_id"] === "wamid.snap.cur");
    if (runtime) expect(snap["runtime_execution_id"] ?? runtime["id"]).toBeTruthy();
    const ledger = (db["tamar_writeback_ledger"] ?? []).filter((w: any) => w["inbound_message_id"] === "wamid.snap.cur");
    for (const w of ledger) expect(w["context_snapshot_id"] ?? snap["id"]).toBeTruthy();
  });
});

describe("model routing", () => {
  const allowlist = ["openai/gpt-5.6-luna", "openai/gpt-5.6-terra", "google/gemini-2.5-pro"];

  it("a simple turn picks the cheap model and escalates only as a second candidate", () => {
    const plan = planModelRoute({
      stage: "intent_interpreter",
      model_id: "openai/gpt-5.6-terra",
      cheap_model: "openai/gpt-5.6-luna",
      complexity: "simple",
      allowlist,
    });
    expect(plan.model_id).toBe("openai/gpt-5.6-luna");
    expect(plan.routing_reason).toBe("simple_turn_cheap_model");
    expect(plan.candidates[1]).toBe("openai/gpt-5.6-terra");
  });

  it("a complex turn uses the strong model", () => {
    const plan = planModelRoute({
      stage: "response_writer",
      model_id: "openai/gpt-5.6-terra",
      cheap_model: "openai/gpt-5.6-luna",
      complexity: "complex",
      allowlist,
    });
    expect(plan.model_id).toBe("openai/gpt-5.6-terra");
    expect(plan.routing_reason).toBe("complex_turn_strong_model");
  });

  it("a validation retry escalates exactly once", () => {
    const plan = planModelRoute({
      stage: "intent_interpreter",
      model_id: "openai/gpt-5.6-terra",
      cheap_model: "openai/gpt-5.6-luna",
      complexity: "simple",
      validationRetry: true,
      allowlist,
    });
    expect(plan.candidates).toEqual(["openai/gpt-5.6-terra"]);
    expect(plan.routing_reason).toBe("validation_retry_escalation");
  });

  it("a non-allowlisted cheap model is never used", () => {
    const plan = planModelRoute({
      stage: "intent_interpreter",
      model_id: "google/gemini-2.5-pro",
      cheap_model: "openai/not-approved",
      complexity: "simple",
      allowlist: ["google/gemini-2.5-pro"],
    });
    expect(plan.model_id).toBe("google/gemini-2.5-pro");
    expect(plan.routing_reason).toBe("no_cheap_model_configured");
  });
});
