/**
 * Canary handoff override — narrowly scoped to +972512277533.
 * Verifies: clears only for canary, non-canary untouched, history/consent
 * preserved, manager alert suppressed for canary only, loop-safety.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const state = {
  contacts: [] as any[],
  handoffs: [] as any[],
  updates: [] as any[],
  inserts: [] as any[],
  deletes: [] as string[],
  released: [] as any[],
};

function table(name: string) {
  const q: any = {
    _rows: name === "contacts" ? state.contacts : name === "manager_handoffs" ? state.handoffs : [],
    select() { return q; },
    eq() { return q; },
    in() { return q; },
    or() { return q; },
    limit() { return Promise.resolve({ data: q._rows }); },
    maybeSingle() { return Promise.resolve({ data: q._rows[0] ?? null }); },
    update(patch: any) { state.updates.push({ table: name, patch }); return q; },
    insert(row: any) { state.inserts.push({ table: name, row }); return Promise.resolve({ data: null }); },
    delete() { state.deletes.push(name); return q; },
    then(res: any) { return Promise.resolve({ data: q._rows }).then(res); },
  };
  return q;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (n: string) => table(n) },
}));

vi.mock("@/lib/tamar-handoff-core.server", () => ({
  OPEN_HANDOFF_STATUSES: ["open", "notified", "claimed"],
  releaseThreadToTamar: vi.fn(async (args: any) => {
    state.released.push(args);
    return { released: true, contact_id: args.contactId, resolved_handoffs: state.handoffs.length };
  }),
}));

const CANARY = "+972512277533";
const OTHER = "+972501112233";

import { applyCanaryHandoffOverride, suppressManagerAlertFor } from "@/lib/tamar-canary/handoff-override.server";

beforeEach(() => {
  state.contacts = [];
  state.handoffs = [];
  state.updates = [];
  state.inserts = [];
  state.deletes = [];
  state.released = [];
});

function frozenCanaryContact() {
  state.contacts = [{
    id: "c-1",
    phone: CANARY,
    whatsapp_number: CANARY,
    human_owned: true,
    manager_attention_required: true,
    conversation_state: "human_handoff_queued",
    consent_status: "granted",
  }];
  state.handoffs = [{ id: "h-1", status: "notified", contact_id: "c-1" }];
}

describe("canary handoff override", () => {
  it("clears an active handoff for the canary number", async () => {
    frozenCanaryContact();
    const res = await applyCanaryHandoffOverride({ phone: CANARY, inboundMessageId: "wamid.1" });
    expect(res.applied).toBe(true);
    expect(res.reason).toBe("handoff_cleared");
    expect(state.released[0]).toMatchObject({ contactId: "c-1", resolveHandoffs: true });
  });

  it("enters the turn as clean new-inbound state", async () => {
    frozenCanaryContact();
    await applyCanaryHandoffOverride({ phone: CANARY });
    const patch = state.updates.find((u) => u.table === "contacts")?.patch;
    expect(patch.conversation_state).toBe("new_inbound");
    expect(patch.human_owned).toBe(false);
    expect(patch.manager_attention_required).toBe(false);
  });

  it("does nothing for a non-canary number", async () => {
    frozenCanaryContact();
    const res = await applyCanaryHandoffOverride({ phone: OTHER });
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("not_canary");
    expect(state.released).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it("is loop-safe: no reset when there is no active handoff state", async () => {
    state.contacts = [{
      id: "c-1", phone: CANARY, whatsapp_number: CANARY,
      human_owned: false, manager_attention_required: false, conversation_state: "intake_active",
    }];
    state.handoffs = [];
    const res = await applyCanaryHandoffOverride({ phone: CANARY });
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("no_active_handoff");
    expect(state.updates).toHaveLength(0);
    expect(state.released).toHaveLength(0);
  });

  it("repeated ordinary canary messages never reset the conversation", async () => {
    state.contacts = [{
      id: "c-1", phone: CANARY, whatsapp_number: CANARY,
      human_owned: false, manager_attention_required: false, conversation_state: "value_delivery",
    }];
    for (let i = 0; i < 3; i += 1) {
      const res = await applyCanaryHandoffOverride({ phone: CANARY });
      expect(res.applied).toBe(false);
    }
    expect(state.updates).toHaveLength(0);
  });

  it("preserves history, consent, identity and audit (never deletes)", async () => {
    frozenCanaryContact();
    await applyCanaryHandoffOverride({ phone: CANARY });
    expect(state.deletes).toHaveLength(0);
    const patch = state.updates.find((u) => u.table === "contacts")?.patch ?? {};
    for (const k of ["consent_status", "consent_at", "opted_out", "phone", "whatsapp_number", "first_name"]) {
      expect(patch).not.toHaveProperty(k);
    }
  });

  it("writes a durable audit entry explaining the automatic override", async () => {
    frozenCanaryContact();
    await applyCanaryHandoffOverride({ phone: CANARY, inboundMessageId: "wamid.9" });
    const log = state.inserts.find((i) => i.table === "webhook_logs");
    expect(log?.row.status).toBe("canary_handoff_override");
    expect(String(log?.row.payload.note)).toContain("canary override");
    expect(log?.row.payload.phone_masked).toBe("***7533");
    expect(JSON.stringify(log?.row.payload)).not.toContain("972512277533");
  });

  it("suppresses manager alerts for the canary only", () => {
    expect(suppressManagerAlertFor(CANARY)).toBe(true);
    expect(suppressManagerAlertFor("972512277533")).toBe(true);
    expect(suppressManagerAlertFor("0512277533")).toBe(true);
    expect(suppressManagerAlertFor(OTHER)).toBe(false);
    expect(suppressManagerAlertFor(null)).toBe(false);
  });
});
