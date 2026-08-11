/**
 * ORCHESTRATION TEST — who owns an inbound turn, with every dependency mocked.
 *
 * Reproduces the webhook's routing order (relationship_intake -> baseline
 * intake -> Tamar v2) using the shipped route policy, and asserts:
 *   - "יש לך עוד טיולים?" / "אני רוצה לנסוע" during relationship intake do NOT
 *     call saveRelationshipAnswer / applyInboundOnboarding, DO reach v2,
 *     are recorded once and produce exactly ONE guarded outbound;
 *   - "גרוש" is captured and advances the questionnaire;
 *   - a duplicate wamid produces no second save and no second send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyInbound } from "@/lib/inbound-gate/classify";
import {
  baselineMayOwnTurn,
  baselineMaySave,
  relationshipMayOwnTurn,
} from "@/lib/inbound-gate/route-policy";
import { isUserQuestion } from "@/lib/tamar-brain/signals";
import { detectLoopSignal } from "@/lib/conversation-guard/core";

// ---- mocked dependencies ---------------------------------------------------
const saveRelationshipAnswer = vi.fn(async () => ({ saved: true }));
const applyInboundOnboarding = vi.fn(async () => ({ applied: ["x"] }));
const runV2Turn = vi.fn(async () => ({ text: "תשובה קונטקסטואלית" }));
const guardOutbound = vi.fn(async (a: { candidateText: string }) => ({
  verdict: "send",
  text: a.candidateText,
}));
const sendWhatsAppText = vi.fn(async () => ({ ok: true, provider_message_id: "wamid.out" }));
const recordInboundMessage = vi.fn(async () => {});

/** wamid -> already processed (the runtime_inbound_dedupe claim). */
const seen = new Set<string>();

/** The shipped ordering, dependencies injected. */
async function handleInbound(args: {
  wamid: string;
  text: string;
  relationshipActive: boolean;
  currentQuestionKey?: string | null;
}) {
  if (seen.has(args.wamid)) return { route: "duplicate" as const };
  seen.add(args.wamid);

  const cls = classifyInbound({
    text: args.text,
    sourceType: "text",
    currentQuestionKey: args.currentQuestionKey ?? null,
  });
  await recordInboundMessage();

  // 1) relationship questionnaire
  if (args.relationshipActive && relationshipMayOwnTurn(cls)) {
    if (cls.answer_valid && cls.should_advance) {
      await saveRelationshipAnswer();
      const g = await guardOutbound({ candidateText: "שאלה הבאה" });
      await sendWhatsAppText();
      return { route: "relationship_intake" as const, guard: g.verdict };
    }
  }

  // 2) baseline intake
  const mayOwn = baselineMayOwnTurn({
    cls,
    looksLikeQuestion: isUserQuestion(args.text),
    loopSignal: detectLoopSignal(args.text),
  });
  if (!args.relationshipActive && mayOwn) {
    if (baselineMaySave(cls)) await applyInboundOnboarding();
    const g = await guardOutbound({ candidateText: "שאלת אינטייק" });
    await sendWhatsAppText();
    return { route: "baseline_intake" as const, guard: g.verdict };
  }

  // 3) Tamar v2 answers the customer in context
  const v2 = await runV2Turn();
  const g = await guardOutbound({ candidateText: v2.text });
  await sendWhatsAppText();
  return { route: "tamar_v2" as const, guard: g.verdict };
}

beforeEach(() => {
  seen.clear();
  for (const m of [
    saveRelationshipAnswer,
    applyInboundOnboarding,
    runV2Turn,
    guardOutbound,
    sendWhatsAppText,
    recordInboundMessage,
  ])
    m.mockClear();
});

describe("inbound orchestration: questions never feed the questionnaire", () => {
  for (const text of ["יש לך עוד טיולים?", "אני רוצה לנסוע"]) {
    it(`"${text}" during relationship intake skips intake and reaches v2`, async () => {
      const res = await handleInbound({
        wamid: "wamid.1",
        text,
        relationshipActive: true,
        currentQuestionKey: "marital_status",
      });

      expect(res.route).toBe("tamar_v2");
      expect(saveRelationshipAnswer).not.toHaveBeenCalled();
      expect(applyInboundOnboarding).not.toHaveBeenCalled();
      expect(runV2Turn).toHaveBeenCalledTimes(1);
      // recorded once, guarded once, sent once
      expect(recordInboundMessage).toHaveBeenCalledTimes(1);
      expect(guardOutbound).toHaveBeenCalledTimes(1);
      expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    });
  }

  it("a valid answer (\"גרוש\") is captured and advances the questionnaire", async () => {
    const cls = classifyInbound({
      text: "גרוש",
      sourceType: "text",
      currentQuestionKey: "marital_status",
    });
    expect(cls.answer_valid).toBe(true);
    expect(cls.should_advance).toBe(true);

    const res = await handleInbound({
      wamid: "wamid.2",
      text: "גרוש",
      relationshipActive: true,
      currentQuestionKey: "marital_status",
    });
    expect(res.route).toBe("relationship_intake");
    expect(saveRelationshipAnswer).toHaveBeenCalledTimes(1);
    expect(runV2Turn).not.toHaveBeenCalled();
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it("confusion (\"?\", \"מה?\") never saves and always reaches v2", async () => {
    for (const [i, text] of ["?", "מה?", "למה", "מה זה"].entries()) {
      const res = await handleInbound({
        wamid: `wamid.c${i}`,
        text,
        relationshipActive: true,
        currentQuestionKey: "marital_status",
      });
      expect(res.route).toBe("tamar_v2");
    }
    expect(saveRelationshipAnswer).not.toHaveBeenCalled();
    expect(applyInboundOnboarding).not.toHaveBeenCalled();
  });

  it("baseline intake does not save a question, but still owns nothing of it", async () => {
    const res = await handleInbound({
      wamid: "wamid.3",
      text: "יש לך עוד טיולים?",
      relationshipActive: false,
      currentQuestionKey: "residence_city",
    });
    expect(res.route).toBe("tamar_v2");
    expect(applyInboundOnboarding).not.toHaveBeenCalled();
  });

  it("baseline intake asks its question on neutral input without capturing it", async () => {
    const res = await handleInbound({
      wamid: "wamid.4",
      text: "היי",
      relationshipActive: false,
      currentQuestionKey: "residence_city",
    });
    expect(res.route).toBe("baseline_intake");
    expect(applyInboundOnboarding).not.toHaveBeenCalled();
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it("a duplicate wamid neither saves nor sends a second time", async () => {
    await handleInbound({
      wamid: "wamid.dup",
      text: "גרוש",
      relationshipActive: true,
      currentQuestionKey: "marital_status",
    });
    const again = await handleInbound({
      wamid: "wamid.dup",
      text: "גרוש",
      relationshipActive: true,
      currentQuestionKey: "marital_status",
    });
    expect(again.route).toBe("duplicate");
    expect(saveRelationshipAnswer).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(recordInboundMessage).toHaveBeenCalledTimes(1);
  });
});