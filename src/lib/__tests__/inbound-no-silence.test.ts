/**
 * INBOUND CONTRACT: every inbound message ends in exactly one of
 *   (a) a successful outbound, (b) an explicit allowlisted no-reply,
 *   (c) a retryable / dead-lettered job.
 * Never `succeeded` + silence, never a duplicate send.
 *
 * Runs the REAL webhook handler with Meta, the model and the DB mocked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---- in-memory DB -------------------------------------------------------
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
const reset = () => {
  for (const k of Object.keys(db)) delete db[k];
  db.runtime_inbound_dedupe = [];
  db.webhook_logs = [];
  db.contacts = [];
};

function table(name: string) {
  db[name] ??= [];
  return db[name]!;
}

function makeQuery(name: string) {
  const filters: Array<(r: Row) => boolean> = [];
  const q: any = {
    select: () => q,
    eq: (col: string, val: any) => {
      filters.push((r) => r[col] === val);
      return q;
    },
    or: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: table(name).find((r) => filters.every((f) => f(r))) ?? null, error: null }),
    then: (res: any) => res({ data: table(name).filter((r) => filters.every((f) => f(r))), error: null }),
  };
  return q;
}

const supabaseAdmin: any = {
  from: (name: string) => ({
    select: () => makeQuery(name),
    insert: async (row: Row) => {
      const rows = table(name);
      if (name === "runtime_inbound_dedupe") {
        if (rows.some((r) => r.inbound_message_id === row.inbound_message_id)) {
          return { error: { code: "23505", message: "duplicate key" } };
        }
        rows.push({ created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), hit_count: 1, ...row });
        return { error: null };
      }
      rows.push({ ...row });
      return { error: null };
    },
    update: (patch: Row) => ({
      eq: async (col: string, val: any) => {
        for (const r of table(name)) if (r[col] === val) Object.assign(r, patch);
        return { error: null };
      },
    }),
  }),
  rpc: async () => ({ data: null, error: null }),
};
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin, get supabase() { return supabaseAdmin; } }));

// ---- Meta transport -----------------------------------------------------
const sends: Array<{ to: string; text: string }> = [];
let sendOk = true;
vi.mock("@/lib/whatsapp-meta.server", () => ({
  verifyMetaSignature: () => true,
  verifyHubChallenge: () => null,
  parseStatusUpdates: () => [],
  parseInboundMessages: (p: any) => p?.entry?.[0]?.changes?.[0]?.value?.messages ?? [],
  toE164: (p: string) => (p ? (p.startsWith("+") ? p : `+${p}`) : null),
  isSessionWindowOpen: async () => true,
  sendWhatsAppText: async (to: string, text: string) => {
    sends.push({ to, text });
    return sendOk ? { ok: true, provider_message_id: `out_${sends.length}`, status: 200 } : { ok: false, error: "meta_500", status: 500 };
  },
  sendWhatsAppButtons: async (to: string, text: string) => {
    sends.push({ to, text });
    return { ok: true, provider_message_id: "btn", status: 200 };
  },
  recordDelivery: async () => ({}),
}));

// ---- zero-loss vault / jobs --------------------------------------------
const finished: Array<{ jobId: string; success: boolean; error?: string }> = [];
vi.mock("@/lib/zero-loss/vault.server", () => ({
  ingestEvent: async () => ({ vault_id: "v1", correlation_id: "c1", duplicate: false }),
  leaseJobForVault: async () => "job1",
  finishJob: async (a: any) => {
    finished.push(a);
  },
  quarantineEvent: async () => {},
  phoneHash: () => "h",
  sha256: () => "h",
}));

// ---- identity -----------------------------------------------------------
let resolveMode: "ok" | "race" | "fail" = "ok";
let raceContactCreated = false;
vi.mock("@/lib/zero-loss/identity.server", () => ({
  registerIdentity: async () => "id1",
  resolveIdentity: async ({ phone }: any) => {
    if (resolveMode === "fail") throw new Error("contact_resolution_failed: insert_failed");
    if (resolveMode === "race") {
      // insert loses the race, but the row exists a moment later
      raceContactCreated = true;
      db.contacts!.push({ id: "c-race", phone: `+${String(phone).replace("+", "")}` });
      throw new Error("contact_resolution_failed: duplicate");
    }
    return { contact_id: "c1", identity_id: "id1", created_contact: false, normalized_phone: `+${String(phone).replace("+", "")}` };
  },
}));

// ---- everything the pipeline may reach ---------------------------------
vi.mock("@/lib/whatsapp-status.server", () => ({
  applyStatusUpdate: async () => {},
  applyOptIn: async () => {},
  applyOptOut: async () => {},
  markReplied: async () => {},
}));
let gateThrows = false;
vi.mock("@/lib/inbound-gate/gate.server", () => ({
  runInboundGate: async () => {
    if (gateThrows) throw new Error("gate_model_unavailable");
    return { classification: { kind: "statement", confidence: 0.9, source_type: "text", extracted_facts: {}, answer_valid: false, should_advance: false } };
  },
  recordInboundMessage: async () => {},
  markGateRoute: async () => {},
  syncGateFacts: async () => {},
}));
vi.mock("@/lib/conversation-guard/guard.server", () => ({
  guardOutbound: async ({ candidateText }: any) => ({ verdict: "send", text: candidateText, reason: null, replayed: false }),
  recentTurns: async () => [],
}));
const fallbackCalls: any[] = [];
vi.mock("@/lib/conversation-guard/fallback.server", () => ({
  maybeSendRecoveryFallback: async (a: any) => {
    fallbackCalls.push(a);
    sends.push({ to: a.phone, text: "fallback" });
    return { sent: true, reason: "recovery_sent", failure_kind: "engine" };
  },
}));
let intakePlan: any = null;
let intakePlanThrows = false;
vi.mock("@/lib/onboarding/onboarding.server", () => ({
  handleOnboardingButton: async () => ({ handled: false }),
  applyInboundOnboarding: async () => ({ applied: [] }),
  planIntakeTurn: async () => {
    if (intakePlanThrows) throw new Error("intake_boom");
    return intakePlan;
  },
}));
vi.mock("@/lib/relationship-intake/intake.server", () => ({ planRelationshipTurn: async () => null }));
vi.mock("@/lib/tamar-v2/flags.server", () => ({ v2Enabled: async () => ({ enabled: true }) }));
let v2Mode: "reply" | "silent_optout" | "throw" | "empty" = "reply";
const v2Calls: any[] = [];
vi.mock("@/lib/tamar-v2/engine.server", () => ({
  isConsentPhase: async () => false,
  runV2Turn: async (a: any) => {
    v2Calls.push(a);
    if (v2Mode === "throw") throw new Error("model_unavailable");
    if (v2Mode === "silent_optout")
      return { contact_id: "c1", sends: [], decision: { messages: [], next_state: "opted_out", silent: true, reason_codes: [] }, no_reply_reason: "opt_out_suppressed" };
    if (v2Mode === "empty")
      return { contact_id: "c1", sends: [], decision: { messages: [], next_state: "x", silent: false, reason_codes: [] }, no_reply_reason: null };
    const send = sendOk ? { ok: true } : { ok: false, error: "meta_500" };
    if (sendOk) sends.push({ to: a.phone, text: "v2 reply" });
    return { contact_id: "c1", sends: [send], decision: { messages: [{ body: "v2 reply" }], next_state: "x", silent: false, reason_codes: [] }, no_reply_reason: null };
  },
}));
vi.mock("@/lib/tamar-engine.server", () => ({ runTamarTurn: async () => ({ status: 200, payload: { reply_text: "legacy", contact_id: "c1" } }) }));

async function post(messages: any[]) {
  const mod = await import("@/routes/api/public/webhook/tamar");
  const handler = (mod.Route as any).options.server.handlers.POST;
  const res = await handler({
    request: new Request("https://x/api/public/webhook/tamar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "pn1" }, messages } }] }],
      }),
    }),
  });
  return res.json();
}

const msg = (id: string, text = "היי", from = "972501112233") => ({ id, wamid: id, from, type: "text", text, name: "t" });

// Warm the (heavy) route + worker module graph once, outside any test's timeout.
// Under a fully parallel suite the first transform+import alone can exceed the
// default 5s per-test budget; this only moves that cost, it changes no behaviour.
beforeAll(async () => {
  await import("@/routes/api/public/webhook/tamar");
  await import("@/lib/zero-loss/worker.server");
}, 60_000);

beforeEach(() => {
  reset();
  sends.length = 0;
  finished.length = 0;
  fallbackCalls.length = 0;
  v2Calls.length = 0;
  sendOk = true;
  resolveMode = "ok";
  gateThrows = false;
  intakePlan = null;
  intakePlanThrows = false;
  v2Mode = "reply";
  raceContactCreated = false;
});

const dedupe = (id: string) => db.runtime_inbound_dedupe!.find((r) => r.inbound_message_id === id);

describe("no silence, no duplicates, no false succeeded", () => {
  it("existing intake_active contact with a null intake plan still gets an answer", async () => {
    intakePlan = null;
    const out = await post([msg("wamid.A")]);
    expect(out.results[0].reply_sent).toBe(true);
    expect(v2Calls.length).toBe(1);
    expect(finished[0]).toMatchObject({ success: true });
    expect(dedupe("wamid.A")!.state).toBe("completed");
  });

  it("a throwing intake plan falls through to v2 instead of swallowing the turn", async () => {
    intakePlanThrows = true;
    const out = await post([msg("wamid.B")]);
    expect(out.results[0].reply_sent).toBe(true);
    expect(v2Calls.length).toBe(1);
  });

  it("brand new phone: the contact is resolved before the gate", async () => {
    const out = await post([msg("wamid.C", "היי", "972520000880")]);
    expect(out.results[0].contact_id).toBe("c1");
    expect(out.results[0].reply_sent).toBe(true);
  });

  it("contact create race: the row created by the concurrent delivery is used", async () => {
    resolveMode = "race";
    const out = await post([msg("wamid.D", "היי", "972520000880")]);
    expect(raceContactCreated).toBe(true);
    // The insert lost the race but the turn still runs on the existing row.
    expect(out.results[0].reply_sent).toBe(true);
    expect(fallbackCalls.length).toBe(0);
    expect(finished[0]!.success).toBe(true);
  });

  it("a failure after the claim keeps the job retryable and the second delivery re-runs once", async () => {
    gateThrows = true;
    const first = await post([msg("wamid.E")]);
    expect(first.results[0].reply_sent).toBeFalsy();
    expect(finished[0]!.success).toBe(false);
    expect(dedupe("wamid.E")!.state).toBe("claimed");

    // Meta redelivers later: the incomplete claim is retried exactly once.
    gateThrows = false;
    const row = dedupe("wamid.E")!;
    row.last_seen_at = new Date(Date.now() - 5 * 60_000).toISOString();
    const second = await post([msg("wamid.E")]);
    expect(second.results[0].duplicate).toBeFalsy();
    expect(second.results[0].reply_sent).toBe(true);

    // A third delivery is a completed duplicate: suppressed.
    const third = await post([msg("wamid.E")]);
    expect(third.results[0].duplicate).toBe(true);
    expect(third.results[0].no_reply_reason).toBe("duplicate_inbound");
  });

  it("duplicate after a completed reply never sends twice and is a legitimate success", async () => {
    await post([msg("wamid.F")]);
    const before = sends.length;
    const again = await post([msg("wamid.F")]);
    expect(sends.length).toBe(before);
    expect(again.results[0].no_reply_reason).toBe("duplicate_inbound");
    expect(finished.at(-1)).toMatchObject({ success: true });
  });

  it("an incomplete duplicate is never closed as succeeded", async () => {
    gateThrows = true;
    await post([msg("wamid.G")]);
    const again = await post([msg("wamid.G")]); // still fresh -> duplicate, incomplete
    expect(again.results[0].duplicate).toBe(true);
    expect(again.results[0].error).toBe("duplicate_incomplete");
    expect(finished.at(-1)!.success).toBe(false);
  });

  it("model/gate throw: exactly one guarded fallback and a durable failure log", async () => {
    gateThrows = true;
    await post([msg("wamid.H")]);
    expect(fallbackCalls.length).toBe(1);
    expect(db.webhook_logs!.some((l) => l.status === "turn_failed")).toBe(true);
  });

  it("send failure is not a success and stays retryable", async () => {
    sendOk = false;
    const out = await post([msg("wamid.I")]);
    expect(out.results[0].reply_sent).toBe(false);
    expect(finished[0]!.success).toBe(false);
    expect(dedupe("wamid.I")!.state).toBe("claimed");
  });

  it("explicit opt-out no-reply completes the turn without an outbound", async () => {
    v2Mode = "silent_optout";
    const out = await post([msg("wamid.J")]);
    expect(out.results[0].reply_sent).toBe(false);
    expect(out.results[0].no_reply_reason).toBe("opt_out_suppressed");
    expect(finished[0]!.success).toBe(true);
    expect(dedupe("wamid.J")!.no_reply_reason).toBe("opt_out_suppressed");
  });

  it("an unsupported message type is an explicit, recorded no-reply", async () => {
    const out = await post([{ id: "wamid.K", wamid: "wamid.K", from: "972501112233", type: "sticker" }]);
    expect(out.results[0].no_reply_reason).toBe("unsupported_message_type");
    expect(dedupe("wamid.K")!.state).toBe("completed");
    expect(finished[0]!.success).toBe(true);
  });

  it("an empty v2 decision with no documented reason still answers the customer", async () => {
    v2Mode = "empty";
    const out = await post([msg("wamid.L")]);
    expect(fallbackCalls.length).toBe(1);
    expect(out.results[0].reply_sent).toBe(false);
    expect(finished[0]!.success).toBe(false);
  });

  it("two different wamids in one envelope are both answered exactly once", async () => {
    const out = await post([msg("wamid.M1"), msg("wamid.M2")]);
    expect(out.results.map((r: any) => r.reply_sent)).toEqual([true, true]);
    expect(sends.length).toBe(2);
    expect(dedupe("wamid.M1")!.state).toBe("completed");
    expect(dedupe("wamid.M2")!.state).toBe("completed");
  });
});

describe("worker recovery re-runs the same reply pipeline", () => {
  it("recovers an incomplete turn and never re-sends a completed one", async () => {
    const { runWorker } = await import("@/lib/zero-loss/worker.server");
    db.inbound_event_vault = [
      {
        id: "v1",
        event_type: "message.text",
        normalized_phone: "+972501112233",
        raw_payload: { message: { id: "wamid.W1", text: { body: "היי" } } },
      },
    ];
    supabaseAdmin.rpc = async () => ({
      data: [{ job_id: "jobW", vault_event_id: "v1", attempts: 2, max_attempts: 6 }],
      error: null,
    });
    const first = await runWorker({ worker: "test" });
    expect(first.succeeded).toBe(1);
    expect(v2Calls.length).toBe(1);
    expect(dedupe("wamid.W1")!.state).toBe("completed");

    const second = await runWorker({ worker: "test" });
    expect(second.succeeded).toBe(1);
    expect(v2Calls.length).toBe(1); // completed turn is never re-sent
    supabaseAdmin.rpc = async () => ({ data: null, error: null });
  });
});
