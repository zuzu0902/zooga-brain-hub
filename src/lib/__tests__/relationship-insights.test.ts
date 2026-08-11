import { describe, expect, it, vi } from "vitest";
import {
  INSIGHT_SECTION_KEYS,
  answersSourceHash,
  buildFallbackInsights,
  buildInsightsUserPrompt,
  containsClinicalClaim,
  parseInsights,
  type ParseContext,
} from "@/lib/relationship-insights/core";
import type { RelationshipAnswer } from "@/lib/relationship-intake/questions";

const answer = (key: string, text: string, over: Partial<RelationshipAnswer> = {}): RelationshipAnswer => ({
  question_key: key,
  raw_text: text,
  structured_value: {},
  source: "text",
  evidence_message_id: null,
  confidence: 90,
  skipped_by_user: false,
  answered_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

const ANSWERS: Record<string, RelationshipAnswer> = {
  relationship_status: answer("relationship_status", "גרושה"),
  readiness_feeling: answer("readiness_feeling", "מרגישה מוכנה"),
  future_plans: answer("future_plans", "לא מעוניינת בנישואין"),
  children: answer("children", "שני ילדים בוגרים"),
  height: answer("height", "1.65", { skipped_by_user: true, raw_text: null }),
};

const ctx = (): ParseContext => ({
  validKeys: new Set(Object.keys(ANSWERS)),
  idByKey: { relationship_status: "a1", readiness_feeling: "a2", future_plans: "a3", children: "a4" },
  missing: [{ question_key: "occupation", question: "מה המקצוע שלך?" }],
});

const good = {
  summary_he: "גרושה, מרגישה מוכנה לקשר, אם לשני ילדים בוגרים.",
  sections: INSIGHT_SECTION_KEYS.map((key) => ({
    key,
    items: [
      { text: "מוכנה לקשר חדש", certainty: "explicit_fact", evidence_keys: ["readiness_feeling"] },
    ],
  })),
  contradictions: [
    { text: "מוכנות לקשר לצד חוסר עניין בנישואין", certainty: "supported_hypothesis", evidence_keys: ["readiness_feeling", "future_plans"] },
  ],
  matching_tags: [{ tag: "ללא נישואין", certainty: "explicit_fact", evidence_keys: ["future_plans"] }],
  confidence: 80,
};

describe("relationship insights — schema & parser", () => {
  it("parses a valid structured payload with all sections", () => {
    const p = parseInsights(JSON.stringify(good), ctx())!;
    expect(p).toBeTruthy();
    expect(p.sections.map((s) => s.key)).toEqual([...INSIGHT_SECTION_KEYS]);
    expect(p.confidence).toBe(80);
  });

  it("rejects invalid JSON and empty output", () => {
    expect(parseInsights("not json at all", ctx())).toBeNull();
    expect(parseInsights(null, ctx())).toBeNull();
    expect(parseInsights("{}", ctx())).toBeNull();
  });

  it("drops evidence keys that do not exist in the answers", () => {
    const bad = { ...good, sections: [{ key: "values_expectations", items: [{ text: "אוהב טיולים", certainty: "explicit_fact", evidence_keys: ["made_up_key"] }] }] };
    const p = parseInsights(JSON.stringify(bad), ctx())!;
    const item = p.sections.find((s) => s.key === "values_expectations")!.items[0]!;
    expect(item.evidence_keys).toEqual([]);
    expect(item.certainty).toBe("unknown");
  });

  it("maps evidence keys to real answer ids", () => {
    const p = parseInsights(JSON.stringify(good), ctx())!;
    expect(p.sections[0]!.items[0]!.evidence_answer_ids).toEqual(["a2"]);
  });

  it("keeps contradictions with their evidence", () => {
    const p = parseInsights(JSON.stringify(good), ctx())!;
    expect(p.contradictions[0]!.evidence_keys).toEqual(["readiness_feeling", "future_plans"]);
  });

  it("exposes missing information from the questionnaire", () => {
    const p = parseInsights(JSON.stringify(good), ctx())!;
    expect(p.missing_info).toEqual([{ question_key: "occupation", question: "מה המקצוע שלך?" }]);
  });
});

describe("relationship insights — safety", () => {
  it("flags clinical / worthiness language", () => {
    expect(containsClinicalClaim("נראה שיש כאן דיכאון")).toBe(true);
    expect(containsClinicalClaim("narcissistic traits")).toBe(true);
    expect(containsClinicalClaim("יש לפסול אותה")).toBe(true);
    expect(containsClinicalClaim("מחפשת קשר יציב")).toBe(false);
  });

  it("drops clinical items and rejects a clinical summary", () => {
    const clinical = {
      ...good,
      sections: [{ key: "needs_boundaries", items: [{ text: "סובלת מהפרעת אישיות", certainty: "supported_hypothesis", evidence_keys: ["readiness_feeling"] }, { text: "חשוב לה כנות", certainty: "explicit_fact", evidence_keys: ["readiness_feeling"] }] }],
    };
    const p = parseInsights(JSON.stringify(clinical), ctx())!;
    const items = p.sections.find((s) => s.key === "needs_boundaries")!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toContain("כנות");

    const badSummary = { ...good, summary_he: "אבחנה: ביפולר" };
    expect(parseInsights(JSON.stringify(badSummary), ctx())).toBeNull();
  });
});

describe("relationship insights — hashing & versioning", () => {
  it("is stable for identical answers and changes when an answer changes", () => {
    const h1 = answersSourceHash(ANSWERS);
    const h2 = answersSourceHash({ ...ANSWERS });
    expect(h1).toBe(h2);
    const h3 = answersSourceHash({ ...ANSWERS, readiness_feeling: answer("readiness_feeling", "עדיין לא") });
    expect(h3).not.toBe(h1);
  });

  it("ignores key ordering", () => {
    const reordered: Record<string, RelationshipAnswer> = {};
    for (const k of Object.keys(ANSWERS).reverse()) reordered[k] = ANSWERS[k]!;
    expect(answersSourceHash(reordered)).toBe(answersSourceHash(ANSWERS));
  });
});

describe("relationship insights — fallback", () => {
  it("builds a deterministic explicit-fact-only profile", () => {
    const fb = buildFallbackInsights(ANSWERS, { relationship_status: "סטטוס זוגי", children: "ילדים" }, {
      idByKey: ctx().idByKey,
      missing: ctx().missing,
    });
    const all = fb.sections.flatMap((s) => s.items);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((i) => i.certainty === "explicit_fact")).toBe(true);
    expect(all.every((i) => i.evidence_keys.length === 1)).toBe(true);
    expect(all.some((i) => i.text.includes("1.65"))).toBe(false); // skipped answers excluded
  });

  it("handles an incomplete / empty questionnaire", () => {
    const fb = buildFallbackInsights({}, {}, { idByKey: {}, missing: [] });
    expect(fb.summary_he).toContain("אין עדיין תשובות");
    expect(fb.confidence).toBe(0);
  });

  it("never leaks skipped answers into the prompt", () => {
    const prompt = buildInsightsUserPrompt(ANSWERS, {}, ctx().missing);
    expect(prompt).not.toContain("1.65");
    expect(prompt).toContain("height");
  });
});

// --------------------------------------------------------- generation flow

const state: any = { rows: [] as any[], calls: 0, modelContent: JSON.stringify(good) };

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/relationship-intake/intake.server", () => ({
  loadRelationshipQuestions: async () => [
    { question_key: "relationship_status", label: "סטטוס", question_text: "?", order_index: 10, active: true, skippable: true, required: false, is_final_question: false },
    { question_key: "readiness_feeling", label: "מוכנות", question_text: "?", order_index: 20, active: true, skippable: true, required: false, is_final_question: false },
    { question_key: "future_plans", label: "עתיד", question_text: "?", order_index: 30, active: true, skippable: true, required: false, is_final_question: false },
    { question_key: "children", label: "ילדים", question_text: "?", order_index: 40, active: true, skippable: true, required: false, is_final_question: false },
    { question_key: "occupation", label: "מקצוע", question_text: "מה המקצוע שלך?", order_index: 50, active: true, skippable: true, required: false, is_final_question: false },
  ],
  loadRelationshipAnswers: async () => ({ answers: state.answers }),
}));
vi.mock("@/lib/tamar-v2/model-registry.server", () => ({
  callStage: async () => {
    state.calls += 1;
    return state.modelContent === null
      ? { ok: false, content: null, model_id: "google/gemini-2.5-pro", http_status: 0, latency_ms: 1, fallback_used: false, error: "timeout" }
      : { ok: true, content: state.modelContent, model_id: "google/gemini-2.5-pro", http_status: 200, latency_ms: 5, fallback_used: false, error: null };
  },
}));

function fakeDb() {
  const chain: any = {
    _table: "",
    _filters: {} as Record<string, unknown>,
    from(t: string) { chain._table = t; chain._filters = {}; return chain; },
    select() { return chain; },
    eq(k: string, v: unknown) { chain._filters[k] = v; return chain; },
    order() { return chain; },
    limit() { return Promise.resolve({ data: chain._result() }); },
    update() { return { eq: () => ({ eq: () => Promise.resolve({}) }) }; },
    maybeSingle() { return Promise.resolve({ data: chain._result()[0] ?? null }); },
    upsert(row: any) {
      const idx = state.rows.findIndex((r: any) => r.contact_id === row.contact_id && r.source_hash === row.source_hash);
      if (idx >= 0) state.rows[idx] = { ...state.rows[idx], ...row };
      else state.rows.push(row);
      return Promise.resolve({ error: null });
    },
    _result() {
      if (chain._table === "relationship_intake_answers") {
        return Object.keys(state.answers).map((k) => ({ id: `id_${k}`, question_key: k }));
      }
      return state.rows.filter((r: any) =>
        Object.entries(chain._filters).every(([k, v]) => (r as any)[k] === v),
      ).sort((a: any, b: any) => b.version - a.version);
    },
    then(res: any) { return Promise.resolve({ data: chain._result() }).then(res); },
  };
  return chain;
}

describe("relationship insights — generation", () => {
  it("generates once, is idempotent on duplicate triggers, and re-generates on answer change", async () => {
    const mod = await import("@/lib/relationship-insights/insights.server");
    const sb = await import("@/integrations/supabase/client.server");
    Object.assign(sb.supabaseAdmin as any, fakeDb());
    state.answers = { ...ANSWERS };
    state.rows = [];
    state.calls = 0;

    const first = await mod.generateRelationshipInsights("c1");
    expect(first.generated).toBe(true);
    expect(first.status).toBe("ok");
    expect(first.version).toBe(1);
    expect(state.calls).toBe(1);

    const dup = await mod.generateRelationshipInsights("c1");
    expect(dup.generated).toBe(false);
    expect(dup.reason).toBe("up_to_date");
    expect(state.calls).toBe(1);

    state.answers = { ...ANSWERS, readiness_feeling: answer("readiness_feeling", "עדיין מתלבטת") };
    const second = await mod.generateRelationshipInsights("c1");
    expect(second.generated).toBe(true);
    expect(second.version).toBe(2);
    expect(second.source_hash).not.toBe(first.source_hash);
    expect(state.rows).toHaveLength(2); // history kept
    expect(state.rows.filter((r: any) => r.is_current)).toHaveLength(1);
  });

  it("falls back deterministically on a model timeout", async () => {
    const mod = await import("@/lib/relationship-insights/insights.server");
    const sb = await import("@/integrations/supabase/client.server");
    Object.assign(sb.supabaseAdmin as any, fakeDb());
    state.answers = { ...ANSWERS };
    state.rows = [];
    state.modelContent = null;
    const res = await mod.generateRelationshipInsights("c2");
    expect(res.status).toBe("fallback");
    expect(state.rows[0].error).toBe("timeout");
    expect(state.rows[0].summary_he).toContain("דטרמיניסטי");
    state.modelContent = JSON.stringify(good);
  });

  it("records a degraded record on invalid model JSON and allows retry", async () => {
    const mod = await import("@/lib/relationship-insights/insights.server");
    const sb = await import("@/integrations/supabase/client.server");
    Object.assign(sb.supabaseAdmin as any, fakeDb());
    state.answers = { ...ANSWERS };
    state.rows = [];
    state.modelContent = "<<<not json>>>";
    const res = await mod.generateRelationshipInsights("c3");
    expect(res.status).toBe("degraded");
    expect(state.rows[0].error).toBe("invalid_model_output");

    state.modelContent = JSON.stringify(good);
    const retry = await mod.generateRelationshipInsights("c3");
    expect(retry.generated).toBe(true);
    expect(retry.status).toBe("ok");
  });

  it("does nothing when there are no answers", async () => {
    const mod = await import("@/lib/relationship-insights/insights.server");
    const sb = await import("@/integrations/supabase/client.server");
    Object.assign(sb.supabaseAdmin as any, fakeDb());
    state.answers = {};
    state.rows = [];
    const res = await mod.generateRelationshipInsights("c4");
    expect(res).toEqual({ generated: false, reason: "no_answers" });
  });
});