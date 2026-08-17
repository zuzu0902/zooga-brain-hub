import { describe, it, expect } from "vitest";
import {
  deriveCanonicalState,
  toLiteConversation,
  toLiveConversationState,
  statesAgree,
} from "@/lib/canonical-state/state";
import { auditFactBatch } from "@/lib/fact-audit/audit";
import { proposeFacts } from "@/lib/fact-audit/extract";
import { resolveActiveOfferLock, isComplaint } from "@/lib/offer-catalog/active-offer-lock";
import { matchOffer } from "@/lib/offer-catalog/match";
import { detectTopic, shouldAskIntakeQuestion } from "@/lib/intake-suppression";
import {
  inboundProcessKey,
  outboundKey,
  senderOwner,
  maySend,
  shouldProcessInbound,
} from "@/lib/conversation-idempotency";

const consented = {
  id: "c1",
  consent_status: "granted",
  human_owned: false,
  dynamic_profile_fields: {},
};

const withActive = (offerId: string) => ({
  ...consented,
  dynamic_profile_fields: {
    active_offer: { offer_id: offerId, title: "וייטנאם בחנוכה", set_at: "2026-08-01", reason: "explicit" },
  },
});

describe("canonical state — one source of truth for live + lite", () => {
  it("opt-out beats everything", () => {
    const s = deriveCanonicalState({ contact: { ...consented, opted_out_at: "2026-08-01" } });
    expect(s.phase).toBe("opted_out");
    expect(toLiveConversationState(s)).toBe("opted_out");
  });

  it("human ownership beats consent and intake", () => {
    const s = deriveCanonicalState({ contact: { ...consented, human_owned: true }, nextQuestionKey: "city" });
    expect(s.phase).toBe("human_owned");
    expect(s.current_question_key).toBeNull();
  });

  it("missing consent blocks intake and sales", () => {
    const s = deriveCanonicalState({ contact: { id: "c1" }, nextQuestionKey: "city" });
    expect(s.phase).toBe("awaiting_consent");
  });

  it("a sellable active offer puts the conversation in sales, not intake", () => {
    const s = deriveCanonicalState({
      contact: withActive("o1"),
      sellableOfferIds: ["o1"],
      nextQuestionKey: "city",
    });
    expect(s.phase).toBe("sales_conversation");
    expect(s.active_offer?.offer_id).toBe("o1");
  });

  it("sold-out fails closed: the lock disappears with the offer", () => {
    const s = deriveCanonicalState({ contact: withActive("o1"), sellableOfferIds: [], nextQuestionKey: "city" });
    expect(s.active_offer).toBeNull();
    expect(s.phase).toBe("intake");
  });

  it("a direct question moves the phase to sales, not intake", () => {
    const s = deriveCanonicalState({ contact: consented, nextQuestionKey: "city", salesTurn: true });
    expect(s.phase).toBe("sales_conversation");
  });

  it("live and lite adapters describe the SAME state", () => {
    const live = deriveCanonicalState({ contact: withActive("o1"), sellableOfferIds: ["o1"] });
    const lite = deriveCanonicalState({
      contact: withActive("o1"),
      lite: toLiteConversation(live),
      sellableOfferIds: ["o1"],
    });
    expect(statesAgree(live, lite)).toBe(true);
    expect(toLiteConversation(live).phase).toBe("sales_conversation");
  });
});

describe("fact extraction — deterministic + AI merge, audited", () => {
  const source = {
    source: "test",
    source_message_id: "wamid.1",
    source_type: "voice" as const,
    observed_at: "2026-08-17T10:00:00Z",
  };

  it("extracts trip facts identically from a voice transcript", () => {
    const facts = proposeFacts({
      text: "אני רוצה לטוס לוייטנאם בחנוכה, לבד, יש לי כאבי רגליים ותקציב עד 9000 שקל",
      sourceType: "voice",
    });
    const keys = facts.map((f) => f.field_key);
    expect(keys).toContain("travel_party");
    expect(keys).toContain("mobility_limit");
    expect(keys).toContain("budget_signal");
    expect(facts.find((f) => f.field_key === "budget_signal")?.value).toBe("9000");
  });

  it("a date range and AI facts are merged, deterministic wins", () => {
    const facts = proposeFacts({
      text: "בין 12/12 עד 20/12",
      sourceType: "text",
      aiFacts: { travel_date_range: "משהו אחר", interests: "טיולים" },
    });
    expect(facts.find((f) => f.field_key === "travel_date_range")?.value).toBe("12/12-20/12");
    expect(facts.find((f) => f.field_key === "interests")?.kind).toBe("inferred");
  });

  it("an empty proposal never deletes a stored value", () => {
    const out = auditFactBatch({
      contactId: "c1",
      proposed: [{ field_key: "destination", value: null, kind: "explicit", confidence: 90 }],
      current: {
        destination: {
          field_key: "destination",
          value_text: "vietnam",
          explicit_or_inferred: "explicit",
          confidence: 95,
          source: "prev",
          source_message_id: null,
          evidence: null,
          observed_at: "2026-08-01T00:00:00Z",
        } as any,
      },
      source,
    });
    expect(out.accepted).toHaveLength(0);
    expect(out.cleared).toHaveLength(0);
    expect(out.records[0]?.accepted).toBe(false);
    expect(out.records[0]?.reason).toBe("empty_value_never_deletes");
    expect(out.records[0]?.previous_value).toBe("vietnam");
  });

  it("an explicit correction may clear a stored value, and it is audited", () => {
    const out = auditFactBatch({
      contactId: "c1",
      proposed: [{ field_key: "destination", value: null, kind: "explicit", confidence: 90, correction: true }],
      current: { destination: { field_key: "destination", value_text: "dubai" } as any },
      source,
    });
    expect(out.cleared).toEqual(["destination"]);
    expect(out.records[0]).toMatchObject({ accepted: true, previous_value: "dubai", source_type: "voice" });
  });

  it("an inference never overwrites an explicit fact, and the rejection is audited", () => {
    const out = auditFactBatch({
      contactId: "c1",
      proposed: [{ field_key: "destination", value: "dubai", kind: "inferred", confidence: 60 }],
      current: {
        destination: { field_key: "destination", value_text: "vietnam", explicit_or_inferred: "explicit", confidence: 95 } as any,
      },
      source,
    });
    expect(out.accepted).toHaveLength(0);
    expect(out.records[0]?.reason).toBe("inference_cannot_override_explicit");
  });
});

const entry = (over: any = {}) => ({
  id: "o1",
  title: "וייטנאם בחנוכה",
  destinations: ["vietnam"],
  holidays: ["hanukkah"],
  months: [12],
  sellable: true,
  ...over,
});

describe("active offer lock", () => {
  const catalog = [entry(), entry({ id: "o2", title: "דובאי באוקטובר", destinations: ["dubai"], holidays: [], months: [10] })];
  const active = { offer_id: "o1", title: "וייטנאם בחנוכה", set_at: "", reason: "explicit" };

  it("a complaint that mentions a month can never switch the lock", () => {
    const msg = "למה שלחת לי אוקטובר?";
    expect(isComplaint(msg)).toBe(true);
    const lock = resolveActiveOfferLock({
      active,
      match: matchOffer({ message: msg, catalog, activeOfferId: "o1" }),
      message: msg,
      sellableOfferIds: ["o1", "o2"],
    });
    expect(lock.action).toBe("keep");
    expect(lock.offer_id).toBe("o1");
  });

  it("the lock survives a neutral follow-up", () => {
    const msg = "ומה לגבי המחיר?";
    const lock = resolveActiveOfferLock({
      active,
      match: matchOffer({ message: msg, catalog, activeOfferId: "o1" }),
      message: msg,
      sellableOfferIds: ["o1", "o2"],
    });
    expect(lock.offer_id).toBe("o1");
  });

  it("an explicit new destination switches the lock", () => {
    const msg = "בעצם מעניין אותי דובאי";
    const lock = resolveActiveOfferLock({
      active,
      match: matchOffer({ message: msg, catalog, activeOfferId: "o1" }),
      message: msg,
      sellableOfferIds: ["o1", "o2"],
    });
    expect(lock.action).toBe("set");
    expect(lock.offer_id).toBe("o2");
  });

  it("a non-sellable locked offer is released (fail closed)", () => {
    const lock = resolveActiveOfferLock({
      active,
      match: matchOffer({ message: "שלום", catalog, activeOfferId: "o1" }),
      message: "שלום",
      sellableOfferIds: [],
    });
    expect(lock.action).toBe("release");
    expect(lock.offer_id).toBeNull();
  });

  it("no match never guesses — it clarifies or stays put", () => {
    const catalog2 = [entry({ id: "a", title: "וייטנאם א" }), entry({ id: "b", title: "וייטנאם ב" })];
    const lock = resolveActiveOfferLock({
      active: null,
      match: matchOffer({ message: "וייטנאם", catalog: catalog2 }),
      message: "וייטנאם",
      sellableOfferIds: ["a", "b"],
    });
    expect(lock.action).toBe("clarify");
    expect(lock.offer_id).toBeNull();
    expect(lock.clarification).toBeTruthy();
  });
});

describe("intake suppression + phase alignment", () => {
  it("a direct question is answered first", () => {
    expect(shouldAskIntakeQuestion({ questionKey: "city", topic: "sales", directQuestion: true }).ask).toBe(false);
  });

  it("a declined question is never re-asked on any route", () => {
    expect(
      shouldAskIntakeQuestion({ questionKey: "birth_date", topic: "general", declinedKeys: ["birth_date"] }).reason,
    ).toBe("question_declined");
  });

  it("an answered question is suppressed", () => {
    expect(shouldAskIntakeQuestion({ questionKey: "city", topic: "general", answeredKeys: ["city"] }).ask).toBe(false);
  });

  it("no relationship question during trip / cancellation / accessibility", () => {
    for (const text of ["אני רוצה לבטל את הטיול", "יש נגישות לכסא גלגלים?", "מתי הטיסה לוייטנאם?"]) {
      const topic = detectTopic(text);
      expect(shouldAskIntakeQuestion({ questionKey: "looking_for_relationship", topic }).ask).toBe(false);
    }
  });

  it("a relevant question is still asked", () => {
    expect(shouldAskIntakeQuestion({ questionKey: "city", topic: "general" }).ask).toBe(true);
  });
});

describe("one owner, one reply idempotency", () => {
  it("only one route owns the send", () => {
    expect(senderOwner({ liteMode: "shadow", killSwitch: true })).toBe("live");
    expect(maySend("lite", { liteMode: "shadow", killSwitch: true })).toBe(false);
    expect(senderOwner({ liteMode: "live", killSwitch: false })).toBe("lite");
    expect(maySend("live", { liteMode: "live", killSwitch: false })).toBe(false);
  });

  it("lite still processes an inbound the live engine already answered", () => {
    const processed = [inboundProcessKey("wamid.1", "live")];
    expect(shouldProcessInbound({ providerMessageId: "wamid.1", route: "lite", processedKeys: processed })).toBe(true);
    expect(shouldProcessInbound({ providerMessageId: "wamid.1", route: "live", processedKeys: processed })).toBe(false);
  });

  it("outbound keys are deterministic per inbound + kind", () => {
    expect(outboundKey({ providerMessageId: "w1", kind: "offers" })).toBe(
      outboundKey({ providerMessageId: "w1", kind: "offers" }),
    );
    expect(outboundKey({ providerMessageId: "w1", kind: "offers" })).not.toBe(
      outboundKey({ providerMessageId: "w2", kind: "offers" }),
    );
  });
});