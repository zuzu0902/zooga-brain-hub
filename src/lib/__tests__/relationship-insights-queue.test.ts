/**
 * Durable insights queue: enqueue survives request termination, duplicate and
 * concurrent enqueues collapse to one job, the worker retries with backoff,
 * two different hashes both get generated, current-version switching is
 * atomic, and manual refresh forces exactly one extra attempt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelationshipAnswer } from "@/lib/relationship-intake/questions";

const answer = (key: string, text: string): RelationshipAnswer => ({
  question_key: key,
  raw_text: text,
  structured_value: {},
  source: "text",
  evidence_message_id: null,
  confidence: 90,
  skipped_by_user: false,
  answered_at: "2026-01-01T00:00:00.000Z",
});

const state: any = {
  answers: {} as Record<string, RelationshipAnswer>,
  jobs: [] as any[],
  insights: [] as any[],
  calls: 0,
  now: () => Date.now(),
  modelFails: false,
};

let jobSeq = 0;

/** Mirrors the SQL: unique open job per (contact_id, source_hash). */
function rpc(fn: string, p: any) {
  if (fn === "ri_enqueue_insight_job") {
    const open = state.jobs.find(
      (j: any) =>
        j.contact_id === p.p_contact_id &&
        j.source_hash === p.p_source_hash &&
        ["pending", "leased", "failed"].includes(j.state),
    );
    if (open) {
      open.force = open.force || !!p.p_force;
      if (p.p_force) open.next_attempt_at = 0;
      return Promise.resolve({ data: [{ job_id: open.id, duplicate: true, state: open.state }], error: null });
    }
    const job = {
      id: `job_${++jobSeq}`,
      contact_id: p.p_contact_id,
      source_hash: p.p_source_hash,
      force: !!p.p_force,
      state: "pending",
      attempts: 0,
      max_attempts: 4,
      next_attempt_at: 0,
      lease_until: null,
      last_error: null,
      created_at: state.jobs.length,
    };
    state.jobs.push(job);
    return Promise.resolve({ data: [{ job_id: job.id, duplicate: false, state: "pending" }], error: null });
  }

  if (fn === "ri_claim_insight_jobs") {
    const due = state.jobs
      .filter(
        (j: any) =>
          ["pending", "failed", "leased"].includes(j.state) &&
          j.attempts < j.max_attempts &&
          j.next_attempt_at <= state.now() &&
          (j.lease_until == null || j.lease_until < state.now()),
      )
      .slice(0, p.p_limit ?? 3);
    for (const j of due) {
      j.state = "leased";
      j.attempts += 1;
      j.lease_until = state.now() + 180_000;
    }
    return Promise.resolve({ data: due.map((j: any) => ({ ...j, job_id: j.id })), error: null });
  }

  if (fn === "ri_finish_insight_job") {
    const j = state.jobs.find((x: any) => x.id === p.p_job_id);
    if (!j) return Promise.resolve({ data: null, error: null });
    if (p.p_success) {
      j.state = "succeeded";
      j.lease_until = null;
      j.last_error = null;
    } else if (j.attempts >= j.max_attempts) {
      j.state = "dead_letter";
      j.lease_until = null;
      j.last_error = p.p_error;
    } else {
      j.state = "failed";
      j.lease_until = null;
      j.last_error = p.p_error;
      j.next_attempt_at = state.now() + (p.p_backoff_seconds ?? 60) * 1000;
    }
    return Promise.resolve({ data: null, error: null });
  }

  if (fn === "ri_persist_insights") {
    const version =
      Math.max(0, ...state.insights.filter((r: any) => r.contact_id === p.p_contact_id).map((r: any) => r.version)) + 1;
    for (const r of state.insights) if (r.contact_id === p.p_contact_id) r.is_current = false;
    const existing = state.insights.find(
      (r: any) => r.contact_id === p.p_contact_id && r.source_hash === p.p_source_hash,
    );
    if (existing) {
      Object.assign(existing, { is_current: true, status: p.p_status, error: p.p_error });
      return Promise.resolve({ data: [{ version: existing.version }], error: null });
    }
    state.insights.push({
      contact_id: p.p_contact_id,
      source_hash: p.p_source_hash,
      version,
      is_current: true,
      status: p.p_status,
      error: p.p_error,
    });
    return Promise.resolve({ data: [{ version }], error: null });
  }

  return Promise.resolve({ data: [], error: null });
}

function tableQuery(table: string) {
  const filters: Record<string, unknown> = {};
  const rowsFor = () => {
    const src =
      table === "relationship_insight_jobs"
        ? state.jobs
        : table === "relationship_intake_answers"
          ? Object.keys(state.answers).map((k) => ({ id: `id_${k}`, question_key: k, contact_id: filters['contact_id'] , is_current: true }))
          : state.insights;
    return src
      .filter((r: any) => Object.entries(filters).every(([k, v]) => r[k] === v))
      .slice()
      .sort((a: any, b: any) => (b.version ?? b.created_at ?? 0) - (a.version ?? a.created_at ?? 0));
  };
  const chain: any = {
    select: () => chain,
    eq: (k: string, v: unknown) => {
      filters[k] = v;
      return chain;
    },
    order: () => chain,
    limit: () => Promise.resolve({ data: rowsFor() }),
    maybeSingle: () => Promise.resolve({ data: rowsFor()[0] ?? null }),
    then: (res: any) => Promise.resolve({ data: rowsFor() }).then(res),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => tableQuery(t), rpc },
}));
vi.mock("@/lib/relationship-intake/intake.server", () => ({
  loadRelationshipQuestions: async () =>
    ["relationship_status", "readiness_feeling"].map((k, i) => ({
      question_key: k,
      label: k,
      question_text: "?",
      order_index: (i + 1) * 10,
      active: true,
      skippable: true,
      required: false,
      is_final_question: false,
    })),
  loadRelationshipAnswers: async () => ({ answers: state.answers }),
}));
vi.mock("@/lib/tamar-v2/model-registry.server", () => ({
  callStage: async () => {
    state.calls += 1;
    if (state.modelFails) {
      throw new Error("gateway_unreachable");
    }
    return {
      ok: true,
      content: JSON.stringify({
        summary_he: "תקציר פנימי",
        sections: [
          {
            key: "needs_boundaries",
            items: [{ text: "חשוב לה כנות", certainty: "explicit_fact", evidence_keys: ["readiness_feeling"] }],
          },
        ],
        contradictions: [],
        matching_tags: [],
        confidence: 70,
      }),
      model_id: "google/gemini-2.5-pro",
      http_status: 200,
      latency_ms: 5,
      fallback_used: false,
      error: null,
    };
  },
}));

const queue = () => import("@/lib/relationship-insights/queue.server");

beforeEach(() => {
  state.answers = {
    relationship_status: answer("relationship_status", "גרושה"),
    readiness_feeling: answer("readiness_feeling", "מוכנה"),
  };
  state.jobs = [];
  state.insights = [];
  state.calls = 0;
  state.modelFails = false;
  state.now = () => 1_000_000;
});

describe("insights queue — durable enqueue", () => {
  it("commits a job before the request returns, so termination still yields insights", async () => {
    const q = await queue();
    // "request" ends right after enqueue — nothing is left running in it
    const res = await q.enqueueRelationshipInsights("c1");
    expect(res.enqueued).toBe(true);
    expect(res.duplicate).toBe(false);
    expect(state.jobs).toHaveLength(1);
    expect(state.calls).toBe(0); // no model call inside the request

    // later, an independent drain finishes the work
    const report = await q.runInsightsWorker({ worker: "w1" });
    expect(report.claimed).toBe(1);
    expect(report.succeeded).toBe(1);
    expect(state.calls).toBe(1);
    expect(state.insights.filter((r: any) => r.is_current)).toHaveLength(1);
    expect(state.jobs[0].state).toBe("succeeded");
  });

  it("does not enqueue when the questionnaire has no answers", async () => {
    state.answers = {};
    const q = await queue();
    const res = await q.enqueueRelationshipInsights("c1");
    expect(res).toMatchObject({ enqueued: false, reason: "no_answers" });
    expect(state.jobs).toHaveLength(0);
  });

  it("collapses duplicate and concurrent enqueues into one job and one model call", async () => {
    const q = await queue();
    const [a, b, c] = await Promise.all([
      q.enqueueRelationshipInsights("c1"),
      q.enqueueRelationshipInsights("c1"),
      q.enqueueRelationshipInsights("c1", { force: true }),
    ]);
    expect(state.jobs).toHaveLength(1);
    expect([a, b, c].filter((r) => r.duplicate)).toHaveLength(2);
    await q.runInsightsWorker({ worker: "w1" });
    expect(state.calls).toBe(1);
  });
});

describe("insights queue — worker semantics", () => {
  it("retries with backoff and dead-letters only after max attempts", async () => {
    const q = await queue();
    state.modelFails = true;
    await q.enqueueRelationshipInsights("c1");

    for (let i = 1; i <= 4; i++) {
      const report = await q.runInsightsWorker({ worker: `w${i}` });
      expect(report.claimed).toBe(1);
      if (i < 4) {
        const at = state.now();
        expect(state.jobs[0].state).toBe("failed");
        expect(state.jobs[0].next_attempt_at).toBeGreaterThan(at);
        const due = state.jobs[0].next_attempt_at;
        state.now = () => due; // time passes
      }
    }
    expect(state.jobs[0].state).toBe("dead_letter");
    expect(state.jobs[0].last_error).toContain("gateway_unreachable");

    // exhausted job is no longer claimed
    const after = await q.runInsightsWorker({ worker: "w5" });
    expect(after.claimed).toBe(0);
  });

  it("skips the model when the answers moved on while the job was queued", async () => {
    const q = await queue();
    await q.enqueueRelationshipInsights("c1");
    state.answers['readiness_feeling'] = answer("readiness_feeling", "עדיין מתלבטת");
    const report = await q.runInsightsWorker({ worker: "w1" });
    expect(report.succeeded).toBe(1);
    expect(state.calls).toBe(0);
    expect((report.results[0] as any).reason).toBe("stale_job");
  });

  it("generates for two different hashes and keeps exactly one current version", async () => {
    const q = await queue();
    await q.enqueueRelationshipInsights("c1");
    await q.runInsightsWorker({ worker: "w1" });

    state.answers['readiness_feeling'] = answer("readiness_feeling", "עדיין מתלבטת");
    const second = await q.enqueueRelationshipInsights("c1");
    expect(second.duplicate).toBe(false);
    await q.runInsightsWorker({ worker: "w1" });

    expect(state.calls).toBe(2);
    expect(state.insights).toHaveLength(2); // history kept
    expect(state.insights.filter((r: any) => r.is_current)).toHaveLength(1);
    expect(state.insights.map((r: any) => r.version).sort()).toEqual([1, 2]);
  });

  it("keeps a single current version when completion and manual refresh race", async () => {
    const q = await queue();
    await q.enqueueRelationshipInsights("c1");
    await q.enqueueRelationshipInsights("c1", { force: true, requestedBy: "admin" });
    await Promise.all([
      q.runInsightsWorker({ worker: "completion" }),
      q.runInsightsWorker({ worker: "admin-refresh" }),
    ]);
    expect(state.insights.filter((r: any) => r.is_current)).toHaveLength(1);
    expect(state.calls).toBeLessThanOrEqual(1);
  });

  it("manual refresh after an ok result forces exactly one new attempt", async () => {
    const q = await queue();
    await q.enqueueRelationshipInsights("c1");
    await q.runInsightsWorker({ worker: "w1" });
    expect(state.calls).toBe(1);

    const forced = await q.enqueueRelationshipInsights("c1", { force: true, requestedBy: "admin" });
    expect(forced.duplicate).toBe(false); // previous job closed, a new one is created
    await q.runInsightsWorker({ worker: "admin-refresh" });
    expect(state.calls).toBe(2);
    expect(state.insights.filter((r: any) => r.is_current)).toHaveLength(1);

    // and a non-forced trigger right after is a no-op (no extra model call)
    await q.enqueueRelationshipInsights("c1");
    await q.runInsightsWorker({ worker: "w2" });
    expect(state.calls).toBe(2);
  });

  it("exposes the latest job for the UI badge", async () => {
    const q = await queue();
    await q.enqueueRelationshipInsights("c1");
    const job = await q.latestInsightJob("c1");
    expect(job.state).toBe("pending");
  });

  it("uses exponential backoff capped at 15 minutes", async () => {
    const q = await queue();
    expect(q.insightsBackoffSeconds(1)).toBe(60);
    expect(q.insightsBackoffSeconds(3)).toBe(240);
    expect(q.insightsBackoffSeconds(10)).toBe(900);
  });
});