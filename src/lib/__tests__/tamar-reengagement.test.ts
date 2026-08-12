import { describe, expect, it } from "vitest";
import { evaluateActivation, templateFirstName, topicSpec, type ActivationGateInput } from "@/lib/tamar-activation/core";
import {
  buildActivityDetails,
  classifyReengagementReply,
  routeReengagementReply,
} from "@/lib/tamar-activation/followup";

const contact = {
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
    topic: "activity_update",
    instruction: "תעדכני שיש פעילות חדשה ותשאלי אם לשלוח פרטים",
    contact,
    duplicateContacts: 1,
    openHandoffs: 0,
    sessionWindowOpen: false,
    templateApproved: true,
    offerSelected: true,
    offerSellable: true,
    ...over,
  };
}

describe("re-engagement activation gate", () => {
  it("uses the approved template outside the service window", () => {
    const g = evaluateActivation(input());
    expect(g.allowed).toBe(true);
    expect(g.transport).toBe("template");
    expect(topicSpec("activity_update")?.template?.name).toBe("zooga_reengagement_followup");
  });

  it("blocks when there is no active offer", () => {
    expect(evaluateActivation(input({ offerSelected: false, offerSellable: false })).reason).toBe("no_active_offer");
  });

  it("blocks an expired offer", () => {
    expect(evaluateActivation(input({ offerSellable: false })).reason).toBe("offer_not_sellable");
  });

  it("keeps every existing safety gate", () => {
    expect(evaluateActivation(input({ contact: { ...contact, opted_out_at: "2026-01-01T00:00:00Z" } })).reason).toBe("opted_out");
    expect(evaluateActivation(input({ openHandoffs: 1 })).reason).toBe("open_handoff");
    expect(evaluateActivation(input({ contact: { ...contact, human_owned: true } })).reason).toBe("human_owned");
    expect(evaluateActivation(input({ pendingActivation: true })).reason).toBe("duplicate_activation");
    expect(evaluateActivation(input({ recentDuplicateMessage: true })).reason).toBe("duplicate_message");
    expect(evaluateActivation(input({ contact: { ...contact, consent_marketing: false } })).reason).toBe("no_marketing_consent");
    expect(evaluateActivation(input({ templateApproved: false })).reason).toBe("template_not_approved");
  });

  it("has a respectful {{1}} fallback", () => {
    expect(templateFirstName("דינה כהן")).toBe("דינה");
    expect(templateFirstName("  ")).toBe("חבר/ה יקר/ה");
  });
});

describe("re-engagement reply policy", () => {
  it("routes a positive reply to factual details", () => {
    const r = routeReengagementReply({ message: "כן, תשלחי פרטים", intakeCompleted: false, relationshipPending: true });
    expect(r.send_details).toBe(true);
    expect(r.opt_out).toBe(false);
  });

  it("treats 'not interested in the activity' as NOT an opt-out", () => {
    const r = routeReengagementReply({ message: "לא מעוניינת בפעילות", intakeCompleted: false, relationshipPending: true });
    expect(r.opt_out).toBe(false);
    expect(r.next).toBe("continue_intake");
  });

  it("does not restart a completed intake", () => {
    const r = routeReengagementReply({ message: "לא מתאים לי", intakeCompleted: true, relationshipPending: true });
    expect(r.next).toBe("relationship_survey");
    expect(routeReengagementReply({ message: "לא מתאים לי", intakeCompleted: true, relationshipPending: false }).next).toBe("none");
  });

  it("treats an explicit removal request as an opt-out", () => {
    expect(classifyReengagementReply("אל תפנו אליי יותר")).toBe("unsubscribe");
    expect(classifyReengagementReply("הסירו אותי מהדיוור")).toBe("unsubscribe");
    expect(routeReengagementReply({ message: "הסירו אותי", intakeCompleted: false, relationshipPending: false }).opt_out).toBe(true);
  });

  it("leaves an unclear reply to the normal engine (no reply = no progress)", () => {
    const r = routeReengagementReply({ message: "מה השעה?", intakeCompleted: false, relationshipPending: false });
    expect(r.consume).toBe(false);
    expect(r.send_details).toBe(false);
  });

  it("sends only factual details and the exact stored link", () => {
    const text = buildActivityDetails({
      title: "טיול לאלבניה",
      offer_url: "https://zooga.co.il/albania",
      summary: "טיול קהילתי",
      event_date: "2026-09-10",
      event_end_date: "2026-09-17",
    });
    expect(text).toContain("טיול לאלבניה");
    expect(text).toContain("https://zooga.co.il/albania");
    expect(text).not.toMatch(/₪|\d+\s*ש"ח/);
    expect(buildActivityDetails(null)).toContain("בודקת מול הצוות");
  });
});