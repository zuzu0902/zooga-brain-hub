import { describe, expect, it } from "vitest";
import { SCENARIOS, runScenario, TEST_AGENT } from "@/lib/tamar-v2/scenarios";
import { canTransition, deriveState } from "@/lib/tamar-v2/state-machine";
import { classifyConsent, isExplicitOptOut, wantsHuman } from "@/lib/tamar-v2/classify";
import { CONSENT_BUTTONS, OPENER_TEXT, decideTurn, openerMessage } from "@/lib/tamar-v2/engine-core";
import { interpretDeterministic } from "@/lib/tamar-v2/interpret-rules";
import { buildButtonsPayload, parseInboundMessages } from "@/lib/whatsapp-meta.server";
import type { AgentVersion, FlowStep } from "@/lib/tamar-v2/types";

describe("Tamar Brain V2 — acceptance scenarios", () => {
  for (const sc of SCENARIOS) {
    it(`[${sc.category}] ${sc.name}`, () => {
      const r = runScenario(sc);
      expect(r.failures, r.failures.join(" | ")).toEqual([]);
    });
  }
});

/**
 * The live admin-edited flow uses different option ids, an extra `first_name`
 * step and a qualification stage. The same suite must stay green against it —
 * this is what the Studio eval run executes.
 */
function liveStep(
  step_key: string,
  field_key: string,
  stage: string,
  presentation: FlowStep["presentation"],
  order_index: number,
  options: Array<[string, string, string]> = [],
): FlowStep {
  return {
    step_key,
    field_key,
    stage,
    question_text: `שאלה ${step_key}?`,
    help_text: null,
    presentation,
    required: true,
    skippable: true,
    conditions: {},
    order_index,
    enabled: true,
    options: options.map(([option_id, label, value], i) => ({ option_id, label, value, order_index: i + 1, enabled: true })),
  };
}

const LIVE_AGENT: AgentVersion = {
  ...TEST_AGENT,
  steps: [
    liveStep("consent", "consent_marketing", "consent", "buttons", 10, [
      ["consent_yes", "כן", "yes"],
      ["consent_no", "לא", "no"],
    ]),
    liveStep("relationship_status", "relationship_status", "intake", "list", 20, [
      ["rs_single", "רווק/ה", "single"],
      ["rs_divorced", "גרוש/ה", "divorced"],
      ["rs_widowed", "אלמן/ה", "widowed"],
      ["rs_couple", "בזוגיות", "in_relationship"],
    ]),
    liveStep("goal", "goal", "intake", "list", 30, [
      ["goal_trips", "טיולים", "trips"],
      ["goal_people", "אנשים חדשים", "new_people"],
      ["goal_dating", "היכרויות", "dating"],
    ]),
    liveStep("preferred_activity", "preferred_activity", "intake", "list", 40, [
      ["act_culture", "תרבות", "culture"],
      ["act_social", "חברתי", "social"],
      ["act_nature", "טבע", "nature"],
    ]),
    liveStep("region", "region", "intake", "list", 50, [
      ["reg_north", "צפון", "north"],
      ["reg_center", "מרכז", "center"],
      ["reg_south", "דרום", "south"],
    ]),
    liveStep("first_name", "first_name", "intake", "text", 60),
    liveStep("special_requests", "special_requests", "intake", "text", 70),
    liveStep("budget_sensitivity", "budget_sensitivity", "qualification", "list", 80, [
      ["bud_value", "חסכוני", "value"],
      ["bud_mid", "רגיל", "standard"],
    ]),
  ],
};

describe("acceptance scenarios against the live flow version", () => {
  for (const sc of SCENARIOS) {
    it(`[live][${sc.category}] ${sc.name}`, () => {
      const r = runScenario(sc, LIVE_AGENT);
      expect(r.failures, r.failures.join(" | ")).toEqual([]);
    });
  }
});

describe("opener contract", () => {
  const opener = decideTurn({
    state: "new_inbound",
    message: "היי",
    optionId: null,
    optionValue: null,
    agent: TEST_AGENT,
    interpretation: interpretDeterministic("היי"),
    knownFields: {},
    pendingStepKey: null,
    ambiguityTurns: 0,
    answeredCount: 0,
    offers: [],
    firstName: "דנה",
    answerText: null,
  });

  it("is exactly one message", () => expect(opener.messages).toHaveLength(1));
  it("is the exact approved text, unmodified", () => {
    expect(opener.messages[0]!.body).toBe(
      "שלום, אני תמר, העוזרת הדיגיטלית של קהילת זוגה. אשמח לשוחח איתך - האם את/ה מאשר לשלוח לך הודעות למספר הזה?",
    );
    expect(OPENER_TEXT).toBe(opener.messages[0]!.body);
  });
  it("is interactive with exactly two stable buttons", () => {
    const m = opener.messages[0]! as any;
    expect(m.kind).toBe("buttons");
    expect(m.options.map((o: any) => o.id)).toEqual(["consent_yes", "consent_no"]);
    expect(m.options.map((o: any) => o.label)).toEqual(["כן", "לא"]);
  });
});

describe("Meta interactive payload", () => {
  const m = openerMessage() as any;
  const payload: any = buildButtonsPayload("972000000000", m.body, m.options);

  it("is type=interactive button, never plain text", () => {
    expect(payload.type).toBe("interactive");
    expect(payload.interactive.type).toBe("button");
    expect(payload.text).toBeUndefined();
  });
  it("carries the exact opener body", () => expect(payload.interactive.body.text).toBe(OPENER_TEXT));
  it("carries both button ids and titles", () => {
    expect(payload.interactive.action.buttons).toEqual([
      { type: "reply", reply: { id: "consent_yes", title: "כן" } },
      { type: "reply", reply: { id: "consent_no", title: "לא" } },
    ]);
  });
  it("button titles stay inside Meta's 20 char limit", () => {
    for (const b of payload.interactive.action.buttons) expect(b.reply.title.length).toBeLessThanOrEqual(20);
    expect(CONSENT_BUTTONS).toHaveLength(2);
  });
});

describe("inbound button replies", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "PHONE_ID" },
              contacts: [{ wa_id: "972000000000", profile: { name: "דנה" } }],
              messages: [
                {
                  id: "wamid.TEST",
                  from: "972000000000",
                  type: "interactive",
                  timestamp: "1700000000",
                  interactive: { type: "button_reply", button_reply: { id: "consent_yes", title: "כן" } },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it("parses button_reply id and title", () => {
    const [msg] = parseInboundMessages(payload);
    expect(msg!.option_id).toBe("consent_yes");
    expect(msg!.text).toBe("כן");
  });

  function consentTurn(optionId: string, text: string) {
    const values: Record<string, string> = { consent_yes: "yes", consent_no: "no" };
    return decideTurn({
      state: "consent_asked",
      message: text,
      optionId,
      optionValue: values[optionId] ?? null,
      agent: LIVE_AGENT,
      interpretation: interpretDeterministic(text),
      knownFields: { first_name: "דנה" },
      pendingStepKey: "consent",
      ambiguityTurns: 0,
      answeredCount: 0,
      offers: [],
      firstName: "דנה",
      answerText: null,
    });
  }

  it("yes button consents and asks exactly one question", () => {
    const d = consentTurn("consent_yes", "כן");
    expect(d.actions).toContain("consent_granted");
    expect(d.next_state).toBe("intake_active");
    expect(d.ask_step_key).toBe("relationship_status");
    const questions = (d.messages.map((m) => m.body).join("\n").match(/[?？]/g) ?? []).length;
    expect(questions).toBe(1);
  });

  it("no button opts out with a single closing message", () => {
    const d = consentTurn("consent_no", "לא");
    expect(d.next_state).toBe("opted_out");
    expect(d.actions).toContain("opt_out");
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0]!.body.trim().endsWith("תודה ולהתראות")).toBe(true);
  });

  it("confusion is never an opt-out", () => {
    for (const t of ["לא הבנתי", "מה?"]) {
      const d = consentTurn("", t);
      expect(d.actions).not.toContain("opt_out");
      expect(d.next_state).not.toBe("opted_out");
    }
  });
});

describe("state machine invariants", () => {
  it("model can never jump straight from new_inbound to recommendation", () => {
    expect(canTransition("new_inbound", "recommendation_ready").allowed).toBe(false);
  });
  it("opted_out only leaves via consent/consented", () => {
    expect(canTransition("opted_out", "intake_active").allowed).toBe(false);
    expect(canTransition("opted_out", "consented").allowed).toBe(true);
  });
  it("legacy v1 contact with consent_pending and no ask is new_inbound", () => {
    expect(deriveState({ conversation_state: "consent_pending" })).toBe("new_inbound");
  });
  it("legacy consented contact keeps consent", () => {
    expect(deriveState({ consent_marketing: true })).toBe("consented");
  });
  it("human_owned always wins", () => {
    expect(deriveState({ human_owned: true, conversation_state: "intake_active" })).toBe("human_owned");
  });
});

describe("classification guards", () => {
  it("לא הבנתי is never a no", () => expect(classifyConsent("לא הבנתי")).toBe("unknown"));
  it("לא תודה is a no", () => expect(classifyConsent("לא, תודה")).toBe("no"));
  it("button value wins over text", () => expect(classifyConsent("בלה", { optionValue: "yes" })).toBe("yes"));
  it("sentence negation is not an opt-out", () => expect(isExplicitOptOut("לא רוצה טיול ארוך")).toBe(false));
  it("standalone הסר is an opt-out", () => expect(isExplicitOptOut("הסר")).toBe(true));
  it("detects a human request", () => expect(wantsHuman("אפשר לדבר עם נציג")).toBe(true));
});
