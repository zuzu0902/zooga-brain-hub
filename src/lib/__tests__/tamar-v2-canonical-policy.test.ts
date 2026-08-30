/**
 * TAMAR V2 — canonical conversation contract (one priority ladder).
 *
 * A..H regression coverage: verified-link priority, current-inbound
 * authority, reset, recommendation gating, URL dedupe, one envelope,
 * text/voice parity.
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

const LONDON = "https://www.zooga.co.il/london-2026";

vi.mock("@/lib/tamar-v2/writer.server", () => ({
  writeGroundedAnswer: async () =>
    `הטיול ללונדון עולה 7,900 ש"ח והמסלול כולל סיורים יומיים.\n${LONDON}\nלפרטים: ${LONDON}/`,
}));

vi.mock("@/lib/tamar-v2/interpreter.server", () => ({
  interpret: async () => ({
    intent: "question",
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
import { countUrls } from "@/lib/tamar-v2/envelope";
import { RESET_ACK_TEXT } from "@/lib/tamar-v2/reset";
import {
  CANONICAL_POLICY_VERSION,
  selectCanonicalPolicy,
} from "@/lib/tamar-v2/canonical-policy";

const CONTACT_ID = "c-canonical";
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
        v2_last_offer_id: "off_london",
        v2_last_grounded_offer_id: "off_london",
        v2_focus: { offer_id: "off_london", topic: "טיול ללונדון" },
        v2_summary: "לקוח שאל האם אפשר להגיע לבד לטיול",
      },
    },
  ];
  db["offers"] = [
    {
      id: "off_london",
      title: "טיול ללונדון",
      offer_url: LONDON,
      category: "trip",
      status: "active",
      event_date: "2099-05-01",
      ai_summary: "טיול מאורגן ללונדון",
      matching_tags: ["לונדון"],
      grounded_facts: { "יעד": "לונדון", "מחיר": "7,900 ש\"ח" },
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
  seq = 0;
  seed();
});

const INTAKE_RE = /(מה\s*הכי\s*מעניין|כדי\s*שאתאים|באיזה\s*אזור|מה\s*המצב\s*המשפחתי)/;

describe("A. verified link is the canonical answer to a current link request", () => {
  it("voice 'איפה אני מוצא את הקישור של התוכנית עצמה?' returns the offer link, no intake", async () => {
    await turn("איפה אני מוצא את הקישור של התוכנית עצמה?", "wamid.c.1", {
      source: "meta_webhook_voice",
    });
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    expect(body).toContain(LONDON);
    expect(body).not.toMatch(INTAKE_RE);
    const exec = db["tamar_runtime_executions"]![0]!;
    expect(exec["prompt_blocks_injected"]["canonical_policy_version"]).toBe(CANONICAL_POLICY_VERSION);
    expect(exec["prompt_blocks_injected"]["canonical_action"]).toBe("verified_link");
    expect(exec["prompt_blocks_injected"]["active_offer_id"]).toBe("off_london");
  });

  it("B. follow-up 'מה הקשר? שאלתי מה הקישור...' still returns the link", async () => {
    await turn("מה הקשר? שאלתי מה הקישור של התוכנית", "wamid.c.2");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain(LONDON);
    expect(sent[0]!.body).not.toMatch(INTAKE_RE);
  });
});

describe("C. current product request beats an older topic", () => {
  it("voice price+route answer does not reply about joining alone", async () => {
    await turn("וכמה עולה כל הטיול? ואני רוצה לראות את המסלול, אפשר?", "wamid.c.3", {
      source: "meta_webhook_voice",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain("7,900");
    expect(sent[0]!.body).not.toMatch(/לבד|שותף לחדר/);
  });
});

describe("D. reset", () => {
  it("returns one clean deterministic acknowledgement and preserves history", async () => {
    const before = db["interactions"]!.length;
    await turn("נתחיל מחדש", "wamid.c.4");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.startsWith(RESET_ACK_TEXT)).toBe(true);
    expect(db["interactions"]!.length).toBeGreaterThanOrEqual(before);
    const contact = db["contacts"]![0]!;
    expect(contact["consent_marketing"]).toBe(true);
    expect(contact["first_name"]).toBe("אלכס");
  });
});

describe("E. recommendations only on explicit request", () => {
  it("explicit 'מה עוד יש חוץ מלונדון?' selects the recommend action", () => {
    const sel = selectCanonicalPolicy({
      controlPath: null,
      currentAsk: { price: false, route: false, link: false, any: false },
      explicitRecommendationRequest: true,
      activeOfferId: "off_london",
      activeOfferUrl: LONDON,
      orchestratorAction: "recommend_products",
      orchestratorApplies: true,
    });
    expect(sel.action).toBe("recommend");
    expect(sel.tier).toBe(6);
  });

  it("an ordinary product turn never selects recommendations", () => {
    const sel = selectCanonicalPolicy({
      controlPath: null,
      currentAsk: { price: true, route: false, link: false, any: true },
      explicitRecommendationRequest: false,
      activeOfferId: "off_london",
      activeOfferUrl: LONDON,
      orchestratorAction: "answer",
      orchestratorApplies: true,
    });
    expect(sel.action).toBe("product_answer");
    expect(sel.ignored_legacy_paths).toContain("recommendation_composer");
    expect(sel.ignored_legacy_paths).toContain("solo_policy_reply");
  });
});

describe("F/G/H. envelope invariants", () => {
  it("a repeated URL appears once at the persistence/provider boundary", async () => {
    await turn("אין לך קישור לטיול?", "wamid.c.5");
    expect(sent).toHaveLength(1);
    expect(countUrls(sent[0]!.body)).toBe(1);
    const exec = db["tamar_runtime_executions"]![0]!;
    expect(countUrls(String(exec["outbound_reply"]))).toBe(1);
    expect(exec["prompt_blocks_injected"]["final_url_count"]).toBe(1);
    expect(exec["prompt_blocks_injected"]["final_envelope_count"]).toBe(1);
  });

  it("one wamid produces exactly one envelope, and voice/text share the policy", async () => {
    await turn("איפה אני מוצא את הקישור של התוכנית עצמה?", "wamid.c.6");
    const textBody = sent[0]!.body;
    expect(sent).toHaveLength(1);
    sent.length = 0;
    await turn("איפה אני מוצא את הקישור של התוכנית עצמה?", "wamid.c.7", {
      source: "meta_webhook_voice",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toBe(textBody);
    expect(db["tamar_runtime_executions"]).toHaveLength(2);
  });
});
