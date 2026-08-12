import { describe, expect, it } from "vitest";
import {
  activationIdempotencyKey,
  evaluateActivation,
  isFutureSchedule,
  topicSpec,
  type ActivationGateInput,
} from "@/lib/tamar-activation/core";

const verifiedContact = {
  id: "c1",
  phone: "+972500000000",
  whatsapp_opt_in_status: "verified",
  whatsapp_opt_in_at: "2026-08-12T07:39:00Z",
  whatsapp_opt_in_source: "owner_confirmation_chat",
  consent_marketing: true,
  opted_out_at: null,
  human_owned: false,
};

function input(over: Partial<ActivationGateInput> = {}): ActivationGateInput {
  return {
    topic: "intake_continue",
    instruction: "תשאלי אם היא רוצה להמשיך את האינטייק",
    contact: verifiedContact,
    duplicateContacts: 1,
    openHandoffs: 0,
    sessionWindowOpen: true,
    ...over,
  };
}

describe("tamar activation gate", () => {
  it("allows a session-window send for a verified contact", () => {
    const g = evaluateActivation(input());
    expect(g.allowed).toBe(true);
    expect(g.transport).toBe("session");
  });

  it("blocks an unverified opt-in", () => {
    const g = evaluateActivation(input({ contact: { ...verifiedContact, whatsapp_opt_in_status: "unknown" } }));
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe("opt_in_unverified");
  });

  it("blocks an opted-out contact", () => {
    const g = evaluateActivation(input({ contact: { ...verifiedContact, opted_out_at: "2026-01-01T00:00:00Z" } }));
    expect(g.reason).toBe("opted_out");
  });

  it("blocks a human-owned thread and an open handoff", () => {
    expect(evaluateActivation(input({ contact: { ...verifiedContact, human_owned: true } })).reason).toBe("human_owned");
    expect(evaluateActivation(input({ openHandoffs: 1 })).reason).toBe("open_handoff");
  });

  it("blocks duplicate contact rows", () => {
    expect(evaluateActivation(input({ duplicateContacts: 2 })).reason).toBe("duplicate_contacts");
  });

  it("blocks free text outside the 24h window when no template matches the topic", () => {
    const g = evaluateActivation(input({ sessionWindowOpen: false }));
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe("no_service_window_no_template");
    expect(g.transport).toBeNull();
  });

  it("never reuses the consent opening template for follow-ups", () => {
    for (const spec of ["intake_continue", "trip_event", "free_topic"]) {
      expect(topicSpec(spec)?.template?.name).not.toBe("zooga_opening_consent");
    }
  });

  it("requires marketing consent for a sales topic only", () => {
    const noConsent = { ...verifiedContact, consent_marketing: false };
    expect(evaluateActivation(input({ topic: "trip_event", contact: noConsent })).reason).toBe("no_marketing_consent");
    expect(evaluateActivation(input({ topic: "intake_continue", contact: noConsent })).allowed).toBe(true);
  });

  it("blocks an expired / non-sellable offer", () => {
    expect(evaluateActivation(input({ offerSelected: true, offerSellable: false })).reason).toBe("offer_not_sellable");
    expect(evaluateActivation(input({ offerSelected: true, offerSellable: true })).allowed).toBe(true);
  });

  it("blocks a duplicate pending activation and a duplicate recent message", () => {
    expect(evaluateActivation(input({ pendingActivation: true })).reason).toBe("duplicate_activation");
    expect(evaluateActivation(input({ recentDuplicateMessage: true })).reason).toBe("duplicate_message");
  });

  it("requires an instruction", () => {
    expect(evaluateActivation(input({ instruction: "  " })).reason).toBe("instruction_missing");
  });

  it("only accepts a future schedule", () => {
    const now = new Date("2026-08-12T10:00:00Z");
    expect(isFutureSchedule("2026-08-12T11:00:00Z", now)).toBe(true);
    expect(isFutureSchedule("2026-08-12T09:00:00Z", now)).toBe(false);
    expect(isFutureSchedule(null, now)).toBe(false);
  });

  it("produces a stable idempotency key per intent", () => {
    const a = activationIdempotencyKey({ contactId: "c1", topic: "trip_event", instruction: "בדיקה  אחת" });
    const b = activationIdempotencyKey({ contactId: "c1", topic: "trip_event", instruction: "בדיקה אחת" });
    const c = activationIdempotencyKey({ contactId: "c1", topic: "trip_event", instruction: "בדיקה שתיים" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});