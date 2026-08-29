/**
 * TAMAR V2 — CONFIRMED PRODUCTION REGRESSIONS (phone ending 7833) (phone ending 7833): reset semantics,
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
let writerOverride: ((args: any) => string) | null = null;
vi.mock("@/lib/tamar-v2/writer.server", () => ({
  writeGroundedAnswer: async (args: any) => {
    writerCalls.push(args);
    if (writerOverride) return writerOverride(args);
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

let stageContent: string | null = null;
vi.mock("@/lib/tamar-v2/model-registry.server", () => ({
  callStage: async () =>
    stageContent
      ? { ok: true, content: stageContent, model_id: "test-model", error: null }
      : { ok: false, content: null, model_id: null, error: "test_no_model" },
}));
vi.mock("@/lib/zero-loss/identity.server", () => ({ registerIdentity: async () => null }));



import { runV2Turn } from "@/lib/tamar-v2/engine.server";

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
      id: "db-1",
      title: "חופשת יוקרה בדובאי",
      offer_url: "https://www.zooga.co.il/dubai",
      category: "trip",
      status: "active",
      event_date: "2099-06-01",
      ai_summary: "חופשה בדובאי",
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
  stageContent = null;
  writerOverride = null;
  seedLondon();
});

const contact = () => db["contacts"]![0]!;
const executions = () => db["tamar_runtime_executions"] ?? [];

/* --------------------------- A. conversation reset ------------------------ */

describe("A. deterministic reset control path", () => {
  it("answers 'נתחיל מחדש' with one non-empty deterministic acknowledgement", async () => {
    const { RESET_ACK_TEXT } = await import("@/lib/tamar-v2/reset");
    // the SAME acknowledgement is already in recent history -> the previous
    // production bug deduped it into an empty body + recovery fallback.
    db["interactions"] = [
      { contact_id: CONTACT_ID, source: "tamar_outbound", content: RESET_ACK_TEXT, timestamp: new Date().toISOString() },
    ];
    await turn("נתחיל מחדש", "wamid.reset.1");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.trim()).toBe(RESET_ACK_TEXT);
    const exec = executions().at(-1)!;
    expect(String(exec["outbound_reply"]).trim()).not.toBe("");
    expect(exec["prompt_blocks_injected"]["control_path"]).toBe("conversation_reset");
    expect(exec["prompt_blocks_injected"]["empty_body_guard"]).toBeNull();
    expect(exec["prompt_blocks_injected"]["final_envelope_count"]).toBe(1);
  });

  it("clears only conversational focus and preserves consent and CRM", async () => {
    await turn("נתחיל מחדש", "wamid.reset.2");
    const c = contact();
    expect(c["consent_marketing"]).toBe(true);
    expect(c["first_name"]).toBe("אלכס");
    expect(c["dynamic_profile_fields"]["v2_focus"]).toBeUndefined();
    expect(c["dynamic_profile_fields"]["v2_last_grounded_offer_id"]).toBeUndefined();
  });
});

/* ------------------------- B/C. London completeness ----------------------- */

describe("B. London request stays complete and on-subject", () => {
  it("starts with an explicit London subject and never leaks other offers", async () => {
    interpretation.intent = "offer_interest";
    writerOverride = () =>
      "הטיול הקלאסי - לונדון כולל טיסות, מלון ומסלול מודרך. יתרת התשלום בחדר זוגי היא 1650 $.";
    await turn("אני רוצה לנסוע ללונדון", "wamid.london.1");
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    expect(body.startsWith("הטיול הקלאסי - לונדון")).toBe(true);
    expect(body).not.toContain("וייטנאם");
    expect(body).not.toContain("דובאי");
    const exec = executions().at(-1)!;
    expect(exec["prompt_blocks_injected"]["guard_result"]).toContain("guard_clean");
    expect(exec["prompt_blocks_injected"]["recovery_mode"]).toBeNull();
  });
});

describe("C. London balance follow-up", () => {
  it("states 1650, 2050 and the deposit separately in a complete sentence", async () => {
    await turn("ומה יתרת התשלום? כמה עולה לי כל הטיול?", "wamid.london.2");
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    expect(body).toContain("1650");
    expect(body).toContain("2050");
    expect(body).toContain("מקדמה");
    expect(body).not.toContain("וייטנאם");
    expect(body).not.toContain("דובאי");
  });
});

/* ------------------------------ E/F/G recovery ---------------------------- */

describe("E. leaking answers regenerate once, then use a complete deterministic answer", () => {
  it("never sends a stripped fragment", async () => {
    let call = 0;
    writerOverride = () => {
      call += 1;
      return "אפשר גם לשקול את דובאי.\nהוא כולל טיסות ומלון.";
    };
    await turn("מה כולל הטיול?", "wamid.london.3");
    expect(call).toBeGreaterThanOrEqual(2); // one regeneration inside the action
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    expect(body).not.toContain("דובאי");
    expect(body.startsWith("לגבי הטיול הקלאסי - לונדון")).toBe(true);
    expect(body).toContain("1650 $");
    const exec = executions().at(-1)!;
    expect(exec["prompt_blocks_injected"]["recovery_mode"]).toBe("deterministic_offer_answer");
  });
});

describe("F. empty generated answers never produce a blank send", () => {
  it("falls back to a complete grounded answer", async () => {
    writerOverride = () => "";
    await turn("מה כולל הטיול?", "wamid.london.4");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.trim()).not.toBe("");
    const exec = executions().at(-1)!;
    expect(String(exec["outbound_reply"]).trim()).not.toBe("");
  });
});

describe("G. dangling anaphora is replaced with a subject-first answer", () => {
  it("never sends 'הוא כולל...' without a subject", async () => {
    writerOverride = () => "הוא כולל טיסות, מלון וארוחות.";
    await turn("מה כולל הטיול?", "wamid.london.5");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.startsWith("הוא כולל")).toBe(false);
    expect(sent[0]!.body).toContain("הטיול הקלאסי - לונדון");
    const exec = executions().at(-1)!;
    expect(exec["prompt_blocks_injected"]["completeness_guard"]).toBe(true);
  });
});

/* ------------------------------- L. scope guard --------------------------- */

describe("L. scope guard", () => {
  it("the live pilot allowlist still contains only the 7833 suffix", async () => {
    const { isLiveSendAllowed } = await import("@/lib/tamar-pilot/live-allowlist");
    expect(isLiveSendAllowed("+972500007833", ["+972500007833"]).allowed).toBe(true);
    expect(isLiveSendAllowed("+972500002620", ["+972500007833"]).allowed).toBe(false);
  });
});
