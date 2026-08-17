import { describe, expect, it } from "vitest";
import { assistantOfferedHandoff, classifyHandoffIntent, isHandoffDecline } from "@/lib/handoff-intent";
import { detectHandoffSignal } from "@/lib/tamar-brain/signals";
import { classifyInbound } from "@/lib/inbound-gate/classify";
import { reduceLite } from "@/lib/tamar-lite/reducer";
import type { LiteConversation, LiteInbound } from "@/lib/tamar-lite/types";

const DECLINES = [
  "אבל לא ביקשתי לעבור מנהל",
  "לא ביקשתי מנהל",
  "אל תעבירי אותי לנציג",
  "לא רוצה נציג",
  "אני רוצה להמשיך איתך",
  "אין צורך בנציג",
];

const REQUESTS = ["אפשר לדבר עם נציג?", "תעבירי אותי למנהל", "אני רוצה לדבר עם בן אדם"];

describe("handoff intent — negation never escalates", () => {
  it.each(DECLINES)("decline: %s", (t) => {
    expect(isHandoffDecline(t)).toBe(true);
    expect(detectHandoffSignal(t).handoff).toBe(false);
    expect(detectHandoffSignal(t).intent).toBe("declined");
    expect(classifyInbound({ text: t }).kind).not.toBe("handoff");
    expect(classifyInbound({ text: t }).handoff_intent).toBe("declined");
  });

  it.each(REQUESTS)("request: %s", (t) => {
    expect(detectHandoffSignal(t).handoff).toBe(true);
    expect(detectHandoffSignal(t).intent).toBe("requested");
  });

  it("voice transcript decline is treated the same as text", () => {
    const c = classifyInbound({ text: "אבל לא ביקשתי לעבור מנהל", sourceType: "voice" });
    expect(c.handoff_intent).toBe("declined");
    expect(c.kinds).not.toContain("handoff");
  });

  it("assistant offering a human is not a request", () => {
    expect(assistantOfferedHandoff("רוצה שאעביר אותך לנציג אנושי?")).toBe(true);
    expect(detectHandoffSignal("רוצה שאעביר אותך לנציג אנושי?", {}).intent).not.toBe("confirmed");
  });

  it("explicit confirmation of a previous offer does escalate", () => {
    const r = classifyHandoffIntent({ text: "כן בבקשה", offeredHandoff: true });
    expect(r.intent).toBe("confirmed");
    expect(detectHandoffSignal("כן בבקשה", { offeredHandoff: true }).handoff).toBe(true);
  });

  it("a bare 'כן' without a prior offer never escalates", () => {
    expect(detectHandoffSignal("כן").handoff).toBe(false);
  });
});

describe("tamar lite reducer — declined handoff keeps automation", () => {
  const conv: LiteConversation = {
    contact_id: "c1",
    phase: "intake",
    current_question_key: null,
    version: 3,
    last_inbound_wamid: null,
    last_outbound_key: null,
    human_owned: false,
  };
  const base: LiteInbound = {
    wamid: "w1",
    text: "אבל לא ביקשתי לעבור מנהל",
    meta_timestamp: null,
    source_type: "text",
    is_opt_out: false,
    is_handoff_request: false,
    is_direct_question: false,
    is_topic_shift: false,
    consent_granted: true,
  };

  it("declined does not flip to human_owned", () => {
    const d = reduceLite({
      conversation: conv,
      inbound: { ...base, is_handoff_request: true, handoff_declined: true },
      defs: [],
      snapshot: {} as any,
      consentGranted: true,
      optedOut: false,
      humanOwned: false,
      offerCandidates: [],
    });
    expect(d.state_after.human_owned).toBe(false);
    expect(d.action.kind).not.toBe("handoff");
  });

  it("positive request still hands off", () => {
    const d = reduceLite({
      conversation: conv,
      inbound: { ...base, text: "תעבירי אותי לנציג", is_handoff_request: true },
      defs: [],
      snapshot: {} as any,
      consentGranted: true,
      optedOut: false,
      humanOwned: false,
      offerCandidates: [],
    });
    expect(d.action.kind).toBe("handoff");
    expect(d.state_after.human_owned).toBe(true);
  });
});
