/**
 * 10 multi-turn Hebrew transcript simulations for the Conversation Progress
 * Guard. Pure logic: no DB, no WhatsApp, no PII.
 *
 * A simulation drives `evaluateOutbound` turn by turn, feeding each verdict
 * back into the rolling turn history exactly as `guardOutbound` does.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateOutbound,
  questionSignature,
  type GuardResult,
  type ProgressFlags,
  type TurnRecord,
} from "@/lib/conversation-guard/core";

type Step = {
  inbound: string;
  candidate: string;
  field?: string | null;
  progress?: ProgressFlags | null;
};

function runTranscript(steps: Step[]): GuardResult[] {
  const history: TurnRecord[] = [];
  const out: GuardResult[] = [];
  for (const s of steps) {
    const r = evaluateOutbound({
      candidateText: s.candidate,
      askedField: s.field ?? null,
      inboundText: s.inbound,
      recentTurns: history,
      progress: s.progress ?? null,
    });
    out.push(r);
    history.unshift({
      asked_field: s.field ?? null,
      question_signature: questionSignature(r.text),
      response_signature: null,
      progress_made: r.verdict === "send",
      repeat_count: r.repeat_count,
    });
  }
  return out;
}

const Q_INTERESTS = "מה הכי מעניין אותך מהפעילות של זוגה?";
const Q_CITY = "באיזה אזור בארץ את/ה גר/ה?";

describe("multi-turn transcript simulations", () => {
  it("1. 'לא מכיר' twice never asks the same question a third time", () => {
    const r = runTranscript([
      { inbound: "הרצליה", candidate: Q_INTERESTS, field: "interests", progress: { saved_new_fact: true } },
      { inbound: "לא מכיר", candidate: Q_INTERESTS, field: "interests" },
      { inbound: "לא מכיר את הפעילות", candidate: Q_INTERESTS, field: "interests" },
    ]);
    expect(r[0]!.verdict).toBe("send");
    expect(r[1]!.verdict).toBe("rephrase");
    expect(r[2]!.verdict).toBe("recovery");
    expect(r[2]!.text).not.toBe(Q_INTERESTS);
  });

  it("2. 'כבר עניתי' immediately triggers recovery with an apology", () => {
    const r = runTranscript([
      { inbound: "תל אביב", candidate: Q_INTERESTS, field: "interests", progress: { saved_new_fact: true } },
      { inbound: "כבר עניתי לך על זה", candidate: Q_INTERESTS, field: "interests" },
    ]);
    expect(r[1]!.verdict).toBe("recovery");
    expect(r[1]!.loop_signal).toBe(true);
  });

  it("3. a typo in the answer still counts as progress and does not loop", () => {
    const r = runTranscript([
      { inbound: "טיולם לחול", candidate: Q_CITY, field: "residence_city", progress: { saved_new_fact: true } },
      { inbound: "הרצליה", candidate: Q_INTERESTS, field: "interests", progress: { saved_new_fact: true } },
    ]);
    expect(r.every((x) => x.verdict === "send")).toBe(true);
  });

  it("4. one answer carrying several facts advances without a re-ask", () => {
    const r = runTranscript([
      {
        inbound: "אני מהרצליה, מעניין אותי טיולים לחול ואירועים",
        candidate: "מה המטרה שלך - חברתי או זוגי?",
        field: "social_or_relationship_goal",
        progress: { saved_new_fact: true, advanced_state: true },
      },
    ]);
    expect(r[0]!.verdict).toBe("send");
    expect(r[0]!.repeat_count).toBe(0);
  });

  it("5. a direct question mid-intake is answered, not re-asked", () => {
    const r = runTranscript([
      { inbound: "הרצליה", candidate: Q_INTERESTS, field: "interests", progress: { saved_new_fact: true } },
      {
        inbound: "יש טיול לאלבניה?",
        candidate: "כן, יש טיול לאלבניה. הנה הפרטים והקישור.",
        field: null,
        progress: { answered_user_intent: true, provided_requested_info: true },
      },
    ]);
    expect(r[1]!.verdict).toBe("send");
  });

  it("6. free text instead of a button is treated as an answer", () => {
    const r = runTranscript([
      {
        inbound: "כן בטח אני מאשר",
        candidate: Q_CITY,
        field: "residence_city",
        progress: { advanced_state: true },
      },
    ]);
    expect(r[0]!.verdict).toBe("send");
  });

  it("7. two unparsable answers in a row hand control back to the customer", () => {
    const r = runTranscript([
      { inbound: "אהה", candidate: Q_INTERESTS, field: "interests" },
      { inbound: "מממ", candidate: Q_INTERESTS, field: "interests" },
      { inbound: "?", candidate: Q_INTERESTS, field: "interests" },
    ]);
    expect(r[2]!.verdict).toBe("recovery");
  });

  it("8. a duplicate retry of the same turn yields the same verdict", () => {
    const a = runTranscript([{ inbound: "לא מכיר", candidate: Q_INTERESTS, field: "interests" }]);
    const b = runTranscript([{ inbound: "לא מכיר", candidate: Q_INTERESTS, field: "interests" }]);
    expect(a[0]!.verdict).toBe(b[0]!.verdict);
    expect(a[0]!.text).toBe(b[0]!.text);
  });

  it("9. after a model timeout the retry does not repeat the question blindly", () => {
    const r = runTranscript([
      { inbound: "הרצליה", candidate: Q_INTERESTS, field: "interests", progress: { saved_new_fact: true } },
      { inbound: "", candidate: Q_INTERESTS, field: "interests" },
      { inbound: "", candidate: Q_INTERESTS, field: "interests" },
    ]);
    expect(r[1]!.verdict).toBe("rephrase");
    expect(r[2]!.verdict).toBe("recovery");
  });

  it("10. handoff / opt-out style turns count as progress and are never rewritten", () => {
    const r = runTranscript([
      {
        inbound: "אני רוצה לדבר עם נציג",
        candidate: "העברתי לנציג אנושי, יחזרו אליך.",
        field: null,
        progress: { performed_handoff: true },
      },
      {
        inbound: "הסר",
        candidate: "הוסרת מרשימת הדיוור.",
        field: null,
        progress: { valid_policy_close: true },
      },
    ]);
    expect(r[0]!.verdict).toBe("send");
    expect(r[1]!.verdict).toBe("send");
    expect(r[1]!.text).toBe("הוסרת מרשימת הדיוור.");
  });

  it("11. recovery resets the field so the next real answer flows again", () => {
    const r = runTranscript([
      { inbound: "לא מכיר", candidate: Q_INTERESTS, field: "interests" },
      { inbound: "לא מכיר", candidate: Q_INTERESTS, field: "interests" },
      {
        inbound: "בעצם מעניין אותי טיולים",
        candidate: "מעולה. רוצה שאשלח לך את הטיולים הקרובים?",
        field: null,
        progress: { saved_new_fact: true, advanced_state: true },
      },
    ]);
    expect(r[2]!.verdict).toBe("send");
  });
});
