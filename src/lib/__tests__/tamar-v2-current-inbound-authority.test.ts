/**
 * TAMAR V2 — last-inbound authority + final send-boundary URL dedupe.
 *
 * Production evidence:
 *   - a voice question about price + itinerary was answered with the
 *     "travelling alone" policy taken from an OLDER turn;
 *   - one outbound answer contained the same verified URL twice.
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
          if (dupe) continue;
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
    or: () => api,
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

vi.mock("@/lib/whatsapp-meta.server", () => ({
  phoneVariants: (p: string) => [p],
  toE164: (p: any) => (p ? String(p) : null),
  isSessionWindowOpen: async () => true,
  recordDelivery: async () => undefined,
  sendWhatsAppText: async (to: string, body: string) => {
    sent.push({ to, body });
    return { ok: true, provider_message_id: `wamid_out_${sent.length}`, status: 200, error: null };
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
  HANDOFF_RECEIPT_TEXT: "העברתי",
  ensureHandoff: async () => ({ handoff_id: "h1", receipt_text: "העברתי" }),
  healStaleHumanOwnership: async (c: any) => c,
}));

vi.mock("@/lib/conversation-guard/guard.server", () => ({
  guardOutbound: async () => ({ verdict: "send", text: null }),
}));

vi.mock("@/lib/tamar-brain/knowledge.server", () => ({ retrieveKnowledge: async () => [] }));

const BAKU = "https://www.zooga.co.il/baku-2026";
const writerCalls: any[] = [];
vi.mock("@/lib/tamar-v2/writer.server", () => ({
  writeGroundedAnswer: async (args: any) => {
    writerCalls.push(args);
    // deliberately repeats the same verified link twice
    return `הטיול לבאקו עולה 7,900 ש"ח והמסלול כולל סיורים יומיים.\n${BAKU}\nלפרטים והרשמה: ${BAKU}/`;
  },
}));

vi.mock("@/lib/tamar-v2/interpreter.server", () => ({
  interpret: async () => ({
    intent: "price_question",
    confidence: 90,
    entities: {},
    source: "test",
    sentiment: "neutral",
    consent_answer: "unknown",
    wants_human: false,
    confusion: false,
    rationale: "",
  }),
}));

vi.mock("@/lib/tamar-v2/model-registry.server", () => ({
  callStage: async () => ({ ok: false, content: null, model_id: null, error: "test_no_model" }),
}));
vi.mock("@/lib/zero-loss/identity.server", () => ({ registerIdentity: async () => null }));

import { runV2Turn } from "@/lib/tamar-v2/engine.server";
import { canonicalUrl, countUrls, dedupeUrlsInBody } from "@/lib/tamar-v2/envelope";
import { currentProductAsk, resolveCurrentMessage } from "@/lib/tamar-v2/current-message";

const CONTACT_ID = "c-authority";
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
      conversation_state: "value_delivered",
      dynamic_profile_fields: {
        v2_last_offer_id: "off_baku",
        v2_last_grounded_offer_id: "off_baku",
        v2_focus: { offer_id: "off_baku", topic: "טיול לבאקו" },
        v2_summary: "לקוח שאל האם אפשר להגיע לבד לטיול",
      },
    },
  ];
  db["offers"] = [
    {
      id: "off_baku",
      title: "טיול לבאקו",
      offer_url: BAKU,
      category: "trip",
      status: "active",
      event_date: "2099-05-01",
      ai_summary: "טיול מאורגן לבאקו",
      matching_tags: ["באקו"],
      grounded_facts: { "יעד": "באקו", "מחיר": "7,900 ש\"ח" },
      faq_bundle: [],
      pricing_status: "published",
      base_price_per_person: 7900,
      currency: "ILS",
      included: ["טיסות"],
      not_included: [],
    },
  ];
  db["tamar_agent_versions"] = [];
  db["interactions"] = [
    {
      id: "i_old",
      contact_id: CONTACT_ID,
      source: "tamar_outbound",
      content: "אפשר להגיע לבד לטיול, יש התאמת שותף לחדר.",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
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
  seq = 0;
  seed();
});

const VOICE_ASK = "וכמה עולה כל הטיול? ואני רוצה לראות את המסלול, אפשר?";

describe("last-inbound authority", () => {
  it("a voice price+route question is answered from the current transcript, not the older solo topic", async () => {
    await turn(VOICE_ASK, "wamid.auth.1", { source: "meta_webhook_voice" });
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    expect(body).toContain("7,900");
    expect(body).toContain("מסלול");
    expect(body).not.toMatch(/לבד|שותף לחדר/);
    expect(writerCalls).toHaveLength(1);
    expect(String(writerCalls[0]!.message)).toContain("המסלול");
  });

  it("text and voice share the exact same current-message path", async () => {
    await turn(VOICE_ASK, "wamid.auth.2", { source: "meta_webhook_voice" });
    const voiceBody = sent[0]!.body;
    sent.length = 0;
    writerCalls.length = 0;
    await turn(VOICE_ASK, "wamid.auth.3");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toBe(voiceBody);
  });

  it("records the current message source and id on the runtime trace", async () => {
    await turn(VOICE_ASK, "wamid.auth.4", { source: "meta_webhook_voice" });
    const exec = db["tamar_runtime_executions"]![0]!;
    expect(exec["prompt_blocks_injected"]["current_message_source"]).toBe("voice_transcript");
    expect(exec["prompt_blocks_injected"]["current_message_id"]).toBe("wamid.auth.4");
  });

  it("produces exactly one envelope per inbound wamid", async () => {
    await turn(VOICE_ASK, "wamid.auth.5", { source: "meta_webhook_voice" });
    expect(sent).toHaveLength(1);
    await turn("ומה עם המסלול?", "wamid.auth.6");
    expect(sent).toHaveLength(2);
    expect(db["tamar_runtime_executions"]).toHaveLength(2);
  });
});

describe("final send-boundary URL dedupe", () => {
  it("persists and sends the repeated Baku link exactly once", async () => {
    await turn("אין לך קישור לטיול?", "wamid.url.1");
    expect(sent).toHaveLength(1);
    expect(countUrls(sent[0]!.body)).toBe(1);
    const exec = db["tamar_runtime_executions"]![0]!;
    expect(exec["prompt_blocks_injected"]["final_url_count"]).toBe(1);
    expect(exec["prompt_blocks_injected"]["deduped_url_count"]).toBeGreaterThanOrEqual(0);
    expect(countUrls(String(exec["outbound_reply"]))).toBe(1);
  });

  it("canonicalizes trailing slash and trailing punctuation", () => {
    expect(canonicalUrl(`${BAKU}/`)).toBe(canonicalUrl(BAKU));
    expect(canonicalUrl(`${BAKU}.`)).toBe(canonicalUrl(BAKU));
    expect(countUrls(dedupeUrlsInBody(`${BAKU}\n${BAKU}/\n${BAKU}.`))).toBe(1);
  });
});

describe("current message resolution", () => {
  it("prefers the normalized transcript and flags the ask", () => {
    const cm = resolveCurrentMessage({
      rawText: "כמה עולה הבקבוק",
      normalizedText: "כמה עולה באקו",
      source: "meta_webhook_voice",
      inboundMessageId: "w1",
    });
    expect(cm.text).toBe("כמה עולה באקו");
    expect(cm.source).toBe("voice_transcript");
    expect(cm.id).toBe("w1");
    expect(currentProductAsk(VOICE_ASK)).toMatchObject({ price: true, route: true, any: true });
    expect(currentProductAsk("שלום").any).toBe(false);
  });
});
