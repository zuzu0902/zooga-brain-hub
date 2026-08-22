import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  PROTECTED_CONTACT_IDS,
  STALE_HANDOFF_BEFORE,
  TERMINAL_EVENT_STATE,
  LEGACY_EMPTY_PAYLOAD_REASON,
  planReconciliation,
  planEmptyEventSkip,
  planLiteAlign,
  planOfferLockClear,
  summarize,
} from "@/lib/reconciliation/plan";

const contact7833 = {
  id: "2ade847a-2374-4401-852e-3056b4a0f194",
  human_owned: false,
  consent_status: "granted",
  consent_marketing: true,
  last_trip_destination: "וייטנאם",
  dynamic_profile_fields: {
    active_offer: {
      offer_id: "dbff14e9-bbae-4308-b94a-421d25a8e974",
      reason: "engine_resolution",
      title: "דובאי ואבו דאבי 5 ימים",
      set_at: "2026-08-17T16:31:28.150Z",
    },
    conversation_facts: { destination: "dubai", holiday: null, mobility_limit: false, months: [] },
    destination: "וייטנאם",
    special_requests: "חנוכה",
    v2_answered_count: 1,
  },
};

const lite7833 = {
  contact_id: contact7833.id,
  phase: "human_owned",
  human_owned: true,
  current_question_key: "looking_for_relationship",
  version: 33,
};

const contact2620 = {
  id: "b85074ef-9cdf-496d-ba3a-3f7225374359",
  human_owned: false,
  consent_status: "granted",
  consent_marketing: true,
  dynamic_profile_fields: { preferred_destination: "דובאי" },
};

const lite2620 = {
  contact_id: contact2620.id,
  phase: "awaiting_consent",
  human_owned: false,
  current_question_key: null,
  version: 1,
};

const emptyEvent = {
  id: "b33284f5-4658-40de-b008-f27fc715daef",
  contact_id: null,
  event_kind: "message",
  processing_state: "pending",
  payload: { event_type: "message.text", text: null },
  error: null,
};

const baseInput = (over: any = {}) => ({
  now: "2026-08-22T12:00:00.000Z",
  contacts: [
    { contact: contact7833, lite: lite7833, nextQuestionKey: "interests", sellableOfferIds: [] },
    { contact: contact2620, lite: lite2620, nextQuestionKey: "city", sellableOfferIds: [] },
  ],
  handoffs: [],
  pendingEvents: [emptyEvent],
  ...over,
});

describe("canonical reconciliation — planner", () => {
  it("dry-run planning performs no writes (pure module, no db import)", () => {
    const src = readFileSync("src/lib/reconciliation/plan.ts", "utf8");
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/delete\s*\(/);
  });

  it("never sends WhatsApp, creates an activation or replays an event", () => {
    const server = readFileSync("src/lib/reconciliation/reconcile.server.ts", "utf8");
    expect(server).not.toMatch(/sendWhatsApp|whatsapp-meta|tamar_activations|outbound_event_ledger/);
    expect(server).not.toMatch(/processLiteBacklog|tamar_lite_claim_next|\.delete\(/);
  });

  it("is idempotent — a second plan over the applied state is empty", () => {
    const actions = planReconciliation(baseInput());
    expect(actions.length).toBeGreaterThan(0);

    const appliedContact = {
      ...contact7833,
      dynamic_profile_fields: (actions.find((a) => a.table === "contacts")!.after as any)
        .dynamic_profile_fields,
    };
    const liteAfter = actions.find((a) => a.table === "tamar_lite_conversations")!.after as any;
    const second = planReconciliation(
      baseInput({
        contacts: [
          {
            contact: appliedContact,
            lite: { contact_id: contact7833.id, ...liteAfter },
            nextQuestionKey: "interests",
            sellableOfferIds: [],
          },
          {
            contact: contact2620,
            lite: { contact_id: contact2620.id, phase: "intake", human_owned: false, current_question_key: "city", version: 2 },
            nextQuestionKey: "city",
            sellableOfferIds: [],
          },
        ],
        pendingEvents: [{ ...emptyEvent, processing_state: TERMINAL_EVENT_STATE, error: LEGACY_EMPTY_PAYLOAD_REASON }],
      }),
    );
    expect(second).toEqual([]);
  });

  it("7833: the empty legacy event goes terminal and is never processed", () => {
    const a = planEmptyEventSkip(emptyEvent)!;
    expect(a.after).toEqual({ processing_state: TERMINAL_EVENT_STATE, error: LEGACY_EMPTY_PAYLOAD_REASON });
    expect(a.kind).toBe("event_terminal_skip");
    // a real message is left alone
    expect(planEmptyEventSkip({ ...emptyEvent, payload: { text: "שלום" } })).toBeNull();
  });

  it("7833: lite is realigned to the canonical state without a stale question", () => {
    const cleared = planOfferLockClear(contact7833)!;
    const a = planLiteAlign({
      contact: { ...contact7833, dynamic_profile_fields: (cleared.after as any).dynamic_profile_fields },
      lite: lite7833,
      nextQuestionKey: "interests",
      sellableOfferIds: [],
    })!;
    expect((a.after as any).human_owned).toBe(false);
    expect((a.after as any).phase).toBe("intake");
    expect((a.after as any).current_question_key).toBe("interests");
    expect((a.before as any).current_question_key).toBe("looking_for_relationship");
  });

  it("current_question_key is null whenever the phase is not intake", () => {
    const a = planLiteAlign({
      contact: { ...contact2620, dynamic_profile_fields: {} },
      lite: { ...lite2620, current_question_key: "city" },
      nextQuestionKey: null,
      sellableOfferIds: [],
    })!;
    expect((a.after as any).phase).toBe("sales_ready");
    expect((a.after as any).current_question_key).toBeNull();
  });

  it("2620: consented contact is never left awaiting_consent in lite", () => {
    const a = planLiteAlign({ contact: contact2620, lite: lite2620, nextQuestionKey: "city", sellableOfferIds: [] })!;
    expect((a.after as any).phase).toBe("intake");
    expect((a.after as any).phase).not.toBe("awaiting_consent");
  });

  it("the conflicting engine offer lock is cleared and NOT replaced", () => {
    const a = planOfferLockClear(contact7833)!;
    const dpf = (a.after as any).dynamic_profile_fields;
    expect(dpf.active_offer).toBeUndefined();
    expect(dpf.conversation_facts.destination).toBeUndefined();
    expect(JSON.stringify(dpf)).not.toContain("offer_id");
  });

  it("explicit customer fields survive the cleanup", () => {
    const dpf = (planOfferLockClear(contact7833)!.after as any).dynamic_profile_fields;
    expect(dpf.destination).toBe("וייטנאם");
    expect(dpf.special_requests).toBe("חנוכה");
    expect(dpf.conversation_facts.mobility_limit).toBe(false);
  });

  it("an agreeing lock is left in place", () => {
    const ok = {
      ...contact7833,
      dynamic_profile_fields: {
        ...contact7833.dynamic_profile_fields,
        active_offer: { offer_id: "x", reason: "engine_resolution", title: "וייטנאם בחנוכה" },
      },
    };
    expect(planOfferLockClear(ok)).toBeNull();
  });

  it("stale legacy handoffs close, fresh and human-owned ones do not", () => {
    const stale = { id: "h1", contact_id: contact7833.id, status: "queued", updated_at: "2026-08-03T21:21:18Z" };
    const fresh = { id: "h2", contact_id: contact7833.id, status: "notified", updated_at: "2026-08-20T10:00:00Z" };
    const owned = {
      id: "h3",
      contact_id: "87073646-5c43-40e6-ac63-b674f6366b33",
      status: "open",
      updated_at: "2026-08-04T13:09:17Z",
    };
    const orphan = { id: "h4", contact_id: null, status: "queued", updated_at: "2026-06-01T00:00:00Z" };
    const actions = planReconciliation(
      baseInput({
        handoffs: [stale, fresh, owned, orphan],
        contacts: [
          ...baseInput().contacts,
          {
            contact: { id: owned.contact_id, human_owned: true, consent_status: "granted" },
            lite: null,
            nextQuestionKey: null,
            sellableOfferIds: [],
          },
        ],
      }),
    ).filter((a) => a.kind === "handoff_stale_resolve");
    expect(actions.map((a) => a.row_id).sort()).toEqual(["h1", "h4"]);
    expect(actions[0].after).toMatchObject({ status: "resolved", note: "canonical_reconciliation_stale_legacy" });
    expect(STALE_HANDOFF_BEFORE).toBe("2026-08-17T00:00:00.000Z");
  });

  it("contact 6058 and its handoff are excluded entirely", () => {
    const protectedId = PROTECTED_CONTACT_IDS[0];
    const actions = planReconciliation(
      baseInput({
        contacts: [
          {
            contact: { id: protectedId, human_owned: true, consent_status: "granted", dynamic_profile_fields: {} },
            lite: { contact_id: protectedId, phase: "intake", human_owned: false, current_question_key: "x", version: 2 },
            nextQuestionKey: null,
            sellableOfferIds: [],
          },
        ],
        handoffs: [{ id: "h6058", contact_id: protectedId, status: "notified", updated_at: "2026-08-01T00:00:00Z" }],
        pendingEvents: [{ ...emptyEvent, contact_id: protectedId }],
      }),
    );
    expect(actions).toEqual([]);
  });

  it("summary counts every planned action kind", () => {
    const s = summarize(planReconciliation(baseInput()));
    expect(s.offer_lock_conflict_clear).toBe(1);
    expect(s.lite_state_align).toBe(2);
    expect(s.event_terminal_skip).toBe(1);
    expect(s.handoff_stale_resolve).toBe(0);
  });
});
