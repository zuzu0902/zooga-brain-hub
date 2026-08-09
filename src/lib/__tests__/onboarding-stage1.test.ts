import { describe, expect, it } from "vitest";
import { routeConversationStart, priorConversationImpliesNothing } from "@/lib/onboarding/decision-router";
import {
  DEFAULT_INTAKE_FIELDS,
  completeness,
  extractFieldsFromFreeText,
  isSkipAnswer,
  nextIntakeStep,
  nextProgressiveStep,
  parseBirthDate,
  ageFromBirthDate,
  mustDeliverValue,
  questionBudgetExhausted,
} from "@/lib/onboarding/baseline-intake";
import {
  applyConsentReply,
  applyOpeningReply,
  mayAutoRecontactAfterDeferral,
  nextOnboardingStage,
  parseOnboardingButton,
} from "@/lib/onboarding/two-stage";
import { mergeFact } from "@/lib/onboarding/profile-facts";
import { normalizePhone } from "@/lib/phone";
import type { ProfileFact, RoutableContact } from "@/lib/onboarding/types";

function contact(over: {
  opening?: Partial<RoutableContact["opening"]>;
  consent?: Partial<RoutableContact["consent"]>;
  intake?: Partial<RoutableContact["intake"]>;
  conversation?: Partial<RoutableContact["conversation"]>;
} = {}): RoutableContact {
  return {
    id: "c1",
    phone: "+972501234567",
    whatsapp_number: "+972501234567",
    opening: { opening_status: "not_sent", opening_asked_at: null, opening_responded_at: null, opening_deferred_at: null, ...(over.opening ?? {}) },
    consent: { consent_status: "unknown", consent_source: null, consent_at: null, consent_version: null, consent_evidence: {}, opt_out_at: null, ...(over.consent ?? {}) },
    intake: { baseline_intake_status: "not_started", intake_version: 1, started_at: null, completed_at: null, last_step_id: null, ...(over.intake ?? {}) },
    conversation: { first_seen_at: null, first_inbound_at: null, last_inbound_at: null, last_outbound_at: null, total_messages: 0, has_prior_conversation: false, service_window_open_until: null, ...(over.conversation ?? {}) },
  };
}

const P = "050-123-4567";

describe("decision router — 7 branch matrix", () => {
  it("A: unknown contact with opt-in + approved template -> new intake", () => {
    const r = routeConversationStart({ phone: P, contact: null, hasOptInEvidence: true, openingTemplateApproved: true });
    expect(r.branch).toBe("A");
    expect(r.decision).toBe("new_intake");
    expect(r.create_contact).toBe(true);
    expect(r.requires_opening_template).toBe(true);
  });

  it("A: unknown contact without opt-in -> fail closed", () => {
    const r = routeConversationStart({ phone: P, contact: null, hasOptInEvidence: false, openingTemplateApproved: true });
    expect(r.decision).toBe("blocked_missing_optin");
    expect(r.may_send).toBe(false);
  });

  it("B: denied / opted out is absolutely suppressed", () => {
    const r = routeConversationStart({ phone: P, contact: contact({ consent: { consent_status: "denied" } }), hasOptInEvidence: true, openingTemplateApproved: true });
    expect(r.decision).toBe("suppressed");
    expect(r.may_send).toBe(false);
    const r2 = routeConversationStart({ phone: P, contact: contact({ consent: { consent_status: "granted", opt_out_at: "2026-01-01T00:00:00Z" } }), hasOptInEvidence: true, openingTemplateApproved: true });
    expect(r2.decision).toBe("suppressed");
  });

  it("C: pending consent with opt-in requires the approved opening template", () => {
    const c = contact({ consent: { consent_status: "pending" } });
    const ok = routeConversationStart({ phone: P, contact: c, hasOptInEvidence: true, openingTemplateApproved: true });
    expect(ok.may_send).toBe(true);
    expect(ok.next_action).toBe("send_opening_template");
    const blocked = routeConversationStart({ phone: P, contact: c, hasOptInEvidence: true, openingTemplateApproved: false });
    expect(blocked.decision).toBe("blocked_missing_template");
    expect(blocked.may_send).toBe(false);
  });

  it("D: granted + not started -> start baseline intake", () => {
    const r = routeConversationStart({ phone: P, contact: contact({ consent: { consent_status: "granted" } }), hasOptInEvidence: true, openingTemplateApproved: false });
    expect(r.branch).toBe("D");
    expect(r.next_action).toBe("start_baseline_intake");
  });

  it("E: granted + in progress -> resume, never restart", () => {
    const r = routeConversationStart({ phone: P, contact: contact({ consent: { consent_status: "granted" }, intake: { baseline_intake_status: "in_progress" } }), hasOptInEvidence: true, openingTemplateApproved: false });
    expect(r.decision).toBe("resume_intake");
    expect(r.next_action).toBe("resume_baseline_intake");
  });

  it("F: granted + completed -> contextual conversation, no baseline", () => {
    const r = routeConversationStart({ phone: P, contact: contact({ consent: { consent_status: "granted" }, intake: { baseline_intake_status: "completed" } }), hasOptInEvidence: true, openingTemplateApproved: false });
    expect(r.decision).toBe("known_contact");
    expect(r.next_action).toBe("contextual_conversation");
  });

  it("G: prior conversation alone is never consent", () => {
    const c = contact({ conversation: { has_prior_conversation: true, total_messages: 12 } });
    const r = routeConversationStart({ phone: P, contact: c, hasOptInEvidence: false, openingTemplateApproved: true });
    expect(r.decision).toBe("blocked_missing_optin");
    expect(r.reason).toBe("prior_conversation_is_not_consent");
    expect(priorConversationImpliesNothing(c)).toBe(true);
  });

  it("invalid phone fails closed", () => {
    const r = routeConversationStart({ phone: "abc", contact: null, hasOptInEvidence: true, openingTemplateApproved: true });
    expect(r.decision).toBe("blocked_invalid_phone");
    expect(r.may_send).toBe(false);
  });

  it("H: 'לא עכשיו' defers without ever denying consent", () => {
    const c = contact({ opening: { opening_status: "deferred" } });
    const r = routeConversationStart({ phone: P, contact: c, hasOptInEvidence: true, openingTemplateApproved: true });
    expect(r.branch).toBe("H");
    expect(r.decision).toBe("deferred_not_now");
    expect(r.may_send).toBe(false);
    expect(c.consent.consent_status).toBe("unknown");
    expect(c.consent.opt_out_at).toBeNull();
  });

  it("H: a deferred contact may still be answered when they write first", () => {
    const c = contact({ opening: { opening_status: "deferred" } });
    const r = routeConversationStart({ phone: P, contact: c, hasOptInEvidence: true, openingTemplateApproved: true, inboundInitiated: true });
    expect(r.decision).not.toBe("deferred_not_now");
  });
});

describe("two-stage opening: availability is not consent", () => {
  it("parses a button by id, by title and by plain text", () => {
    expect(parseOnboardingButton({ id: "opening_available_yes" })).toBe("opening_available_yes");
    expect(parseOnboardingButton({ title: "לא עכשיו" })).toBe("opening_not_now");
    expect(parseOnboardingButton({ text: "כן, מאשר/ת" })).toBe("consent_yes");
    expect(parseOnboardingButton({ text: "משהו אחר" })).toBeNull();
  });

  it("availability yes moves to the consent question and touches no consent", () => {
    const t = applyOpeningReply("opening_available_yes")!;
    expect(t.opening_status).toBe("available");
    expect(t.consent_touched).toBe(false);
    expect(t.next).toBe("ask_consent");
  });

  it("'לא עכשיו' is a deferral with no auto re-contact", () => {
    const t = applyOpeningReply("opening_not_now")!;
    expect(t.opening_status).toBe("deferred");
    expect(t.consent_touched).toBe(false);
    expect(t.next).toBe("stop_no_recontact");
    expect(mayAutoRecontactAfterDeferral()).toBe(false);
  });

  it("consent no suppresses and closes politely", () => {
    const t = applyConsentReply("consent_no")!;
    expect(t.granted).toBe(false);
    expect(t.suppress).toBe(true);
    expect(t.reply_text).toBe("תודה ולהתראות.");
  });

  it("consent yes starts the baseline intake", () => {
    expect(applyConsentReply("consent_yes")).toMatchObject({ granted: true, next: "start_baseline" });
  });
});

describe("stage planner", () => {
  const snap = { facts: {}, skipped: [] };
  const base = { defs: DEFAULT_INTAKE_FIELDS, snapshot: snap, questionsAskedThisConversation: 0, serviceWindowOpen: false, inboundInitiated: false };

  it("outside the window an unopened contact gets the availability template", () => {
    expect(nextOnboardingStage({ ...base, contact: contact() }).stage).toBe("send_opening");
  });

  it("after availability=yes the next step is the consent question", () => {
    expect(nextOnboardingStage({ ...base, contact: contact({ opening: { opening_status: "available" } }) }).stage).toBe("ask_consent");
  });

  it("a customer-initiated inbound asks consent directly, no template", () => {
    expect(nextOnboardingStage({ ...base, inboundInitiated: true, contact: contact() }).stage).toBe("ask_consent");
  });

  it("granted contact gets one baseline question per turn", () => {
    const plan = nextOnboardingStage({ ...base, contact: contact({ consent: { consent_status: "granted" } }) });
    expect(plan).toMatchObject({ stage: "baseline_intake" });
    if (plan.stage === "baseline_intake") expect(plan.field.field_key).toBe("city");
  });

  it("value is delivered by the third question", () => {
    const plan = nextOnboardingStage({ ...base, questionsAskedThisConversation: 3, contact: contact({ consent: { consent_status: "granted" } }) });
    expect(plan.stage).toBe("deliver_value");
  });

  it("a completed contact is never re-intaked", () => {
    const done = { facts: { city: fact("city", "חיפה"), interests: fact("interests", "טיולים"), primary_goal: fact("primary_goal", "לצאת יותר") }, skipped: [] };
    const plan = nextOnboardingStage({ ...base, snapshot: done, valueDelivered: true, contact: contact({ consent: { consent_status: "granted" }, intake: { baseline_intake_status: "completed" } }) });
    expect(plan).toMatchObject({ stage: "progressive_question" });
    if (plan.stage === "progressive_question") expect(plan.field.field_key).toBe("birth_date");
  });

  it("denied contacts are suppressed at the planner too", () => {
    expect(nextOnboardingStage({ ...base, contact: contact({ consent: { consent_status: "denied" } }) }).stage).toBe("suppressed");
  });
});

describe("phone dedupe", () => {
  it("all local forms normalize to one identity", () => {
    const forms = ["050-123-4567", "0501234567", "+972501234567", "00972 50 123 4567", "972501234567"];
    const set = new Set(forms.map((f) => normalizePhone(f)));
    expect(set.size).toBe(1);
    expect([...set][0]).toBe("+972501234567");
  });
});

function fact(field_key: string, value: string, kind: "explicit" | "inferred" = "explicit", confidence = 90): ProfileFact {
  return { field_key, value_text: value, explicit_or_inferred: kind, confidence, source: "test", source_message_id: null, evidence: null, observed_at: new Date().toISOString() };
}

describe("baseline intake", () => {
  it("never re-asks a known field and resumes at the next gap", () => {
    const snap = { facts: { city: fact("city", "חיפה") }, skipped: [] };
    expect(nextIntakeStep(DEFAULT_INTAKE_FIELDS, snap)?.field_key).toBe("interests");
  });

  it("skipped fields are not asked again", () => {
    const snap = { facts: {}, skipped: ["city", "interests"] };
    expect(nextIntakeStep(DEFAULT_INTAKE_FIELDS, snap)?.field_key).toBe("primary_goal");
  });

  it("low confidence inference does not count as known", () => {
    const snap = { facts: { city: fact("city", "אולי חיפה", "inferred", 40) }, skipped: [] };
    expect(nextIntakeStep(DEFAULT_INTAKE_FIELDS, snap)?.field_key).toBe("city");
  });

  it("baseline is exactly 3 questions and DOB is progressive only", () => {
    const snap = { facts: { city: fact("city", "חיפה"), interests: fact("interests", "טיולים"), primary_goal: fact("primary_goal", "לצאת") }, skipped: [] };
    expect(nextIntakeStep(DEFAULT_INTAKE_FIELDS, snap)).toBeNull();
    expect(nextProgressiveStep(DEFAULT_INTAKE_FIELDS, snap)?.field_key).toBe("birth_date");
  });

  it("completeness is per field, not a boolean", () => {
    const snap = { facts: { city: fact("city", "חיפה") }, skipped: ["birth_date"] };
    const c = completeness(DEFAULT_INTAKE_FIELDS, snap);
    expect(c.fields.length).toBe(4);
    expect(c.percent).toBe(50);
    expect(c.missing).toEqual(["interests", "primary_goal"]);
  });

  it("value must be delivered by the third question", () => {
    expect(mustDeliverValue(2)).toBe(false);
    expect(mustDeliverValue(3)).toBe(true);
    expect(questionBudgetExhausted(3)).toBe(true);
  });
});

describe("date of birth", () => {
  it("parses common Hebrew formats", () => {
    expect(parseBirthDate("12/03/1968")).toMatchObject({ ok: true, iso: "1968-03-12" });
    expect(parseBirthDate("5.7.70")).toMatchObject({ ok: true, iso: "1970-07-05" });
  });
  it("accepts day/month without a year and never fabricates an age", () => {
    const r = parseBirthDate("14/2");
    expect(r).toMatchObject({ ok: true, iso: "--02-14" });
    expect(ageFromBirthDate("--02-14")).toBeNull();
  });
  it("rejects impossible dates", () => {
    expect(parseBirthDate("31/02/1980")).toMatchObject({ ok: false, reason: "out_of_range" });
    expect(parseBirthDate("12/03/2030")).toMatchObject({ ok: false, reason: "out_of_range" });
  });
  it("honours a polite refusal", () => {
    expect(parseBirthDate("מעדיפה לא לציין")).toMatchObject({ ok: false, reason: "declined" });
    expect(isSkipAnswer("מעדיפה לא לציין")).toBe(true);
  });
  it("computes a correct age when the year is known", () => {
    expect(ageFromBirthDate("1970-01-01", new Date("2026-08-09T00:00:00Z"))).toBe(56);
  });
});

describe("free text fills several fields at once", () => {
  it("captures name, city and interests from one sentence", () => {
    const out = extractFieldsFromFreeText("קוראים לי דנה, אני מחיפה ואוהבת טיולים בחו״ל ואוכל");
    expect(out["city"]?.value).toBe("חיפה");
    expect(out["interests"]?.value).toContain("טיולים בחו״ל");
    expect(out["interests"]?.value).toContain("אוכל");
  });
  it("stores nothing that was not said", () => {
    const out = extractFieldsFromFreeText("היי");
    expect(Object.keys(out)).toHaveLength(0);
  });
});

describe("progressive profiling conflict rules", () => {
  it("explicit beats an older inference", () => {
    const r = mergeFact(fact("city", "תל אביב", "inferred", 60), { field_key: "city", value: "חיפה", kind: "explicit", confidence: 95, source: "tamar" });
    expect(r.action).toBe("update");
  });
  it("an inference can never override an explicit statement", () => {
    const r = mergeFact(fact("city", "חיפה", "explicit", 95), { field_key: "city", value: "תל אביב", kind: "inferred", confidence: 99, source: "tamar" });
    expect(r).toMatchObject({ action: "reject", reason: "inference_cannot_override_explicit" });
  });
  it("protected attributes are never stored", () => {
    const r = mergeFact(undefined, { field_key: "religion", value: "x", kind: "inferred", confidence: 90, source: "tamar" });
    expect(r).toMatchObject({ action: "reject", reason: "protected_attribute" });
  });
  it("socio-economic reads stay signals with evidence, capped below certainty", () => {
    const r = mergeFact(undefined, { field_key: "budget_signal", value: "רגיש למחיר", kind: "explicit", confidence: 100, source: "tamar", evidence: "יקר לי" });
    expect(r.action).toBe("insert");
    if (r.action === "insert") {
      expect(r.fact.confidence).toBe(90);
      expect(r.fact.evidence).toBe("יקר לי");
    }
  });
  it("every stored fact carries confidence and provenance", () => {
    const r = mergeFact(undefined, { field_key: "interests", value: "טבע", kind: "explicit", confidence: 88, source: "tamar_extractor", source_message_id: "wamid.x", evidence: "אני אוהבת טבע" });
    expect(r.action).toBe("insert");
    if (r.action === "insert") {
      expect(r.fact.source_message_id).toBe("wamid.x");
      expect(r.fact.confidence).toBe(88);
    }
  });
});

describe("preview = send parity", () => {
  it("the same router input yields the same decision every time", () => {
    const input = { phone: P, contact: contact({ consent: { consent_status: "granted" }, intake: { baseline_intake_status: "in_progress" } }), hasOptInEvidence: true, openingTemplateApproved: false };
    const a = routeConversationStart(input);
    const b = routeConversationStart(input);
    expect(a).toEqual(b);
    expect(a.may_send).toBe(true);
  });
  it("a suppressed row can never be turned into a send", () => {
    const r = routeConversationStart({ phone: P, contact: contact({ consent: { consent_status: "denied" } }), hasOptInEvidence: true, openingTemplateApproved: true });
    expect(r.may_send).toBe(false);
    expect(r.next_action).toBe("none");
  });
});