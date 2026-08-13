import { describe, expect, it } from "vitest";
import {
  getNextMissingIntakeQuestion,
  planIntakeState,
  locationKnown,
} from "@/lib/intake-next-question";
import type { IntakeFieldDefinition, ProfileFact } from "@/lib/onboarding/types";

const DEFS: IntakeFieldDefinition[] = [
  { field_key: "first_name", label: "שם", question_text: "איך קוראים לך?", purpose_text: null, presentation: "text", options: [], required: true, skippable: true, order_index: 10, enabled: true, stage: "baseline" },
  { field_key: "city", label: "אזור מגורים", question_text: "באיזה אזור בארץ את/ה גר/ה?", purpose_text: null, presentation: "text", options: [], required: false, skippable: true, order_index: 20, enabled: true, stage: "baseline" },
  { field_key: "birth_date", label: "תאריך לידה", question_text: "תרצה/י לשתף תאריך לידה?", purpose_text: null, presentation: "text", options: [], required: false, skippable: true, order_index: 30, enabled: true, stage: "progressive" },
  { field_key: "interests", label: "תחומי עניין", question_text: "מה הכי מעניין אותך מהפעילות של זוגה?", purpose_text: null, presentation: "text", options: [], required: true, skippable: true, order_index: 40, enabled: true, stage: "baseline" },
  { field_key: "primary_goal", label: "מטרת הקשר", question_text: "מה הכי חשוב לך שנעזור לך בו עכשיו?", purpose_text: null, presentation: "text", options: [], required: false, skippable: true, order_index: 50, enabled: true, stage: "baseline" },
];

const fact = (key: string, value: string): ProfileFact => ({
  field_key: key, value_text: value, value_json: null, explicit_or_inferred: "explicit",
  confidence: 92, source: "tamar", source_message_id: null, evidence: null,
  observed_at: "2026-08-13T07:06:36Z",
} as ProfileFact);

const orly = {
  facts: { first_name: fact("first_name", "אורלי"), city: fact("city", "רמלה"), region: fact("region", "השפלה") },
  skipped: [] as string[],
};

describe("canonical next intake question", () => {
  it("Orly: city+region known -> next real missing field is interests, not birth_date", () => {
    const q = getNextMissingIntakeQuestion(DEFS, orly);
    expect(q?.field_key).toBe("interests");
    expect(q?.question_text).toBe("מה הכי מעניין אותך מהפעילות של זוגה?");
  });

  it("location question is never a candidate once city/region exist", () => {
    expect(locationKnown(orly)).toBe(true);
    const onlyLocationMissing = { facts: { region: fact("region", "השפלה") }, skipped: [] as string[] };
    expect(getNextMissingIntakeQuestion(DEFS, onlyLocationMissing)?.field_key).not.toBe("city");
  });

  it("birth_date is optional/late — only after every baseline field", () => {
    const nearlyDone = {
      facts: { ...orly.facts, interests: fact("interests", "טיולים"), primary_goal: fact("primary_goal", "להכיר אנשים") },
      skipped: [] as string[],
    };
    const q = getNextMissingIntakeQuestion(DEFS, nearlyDone);
    expect(q?.field_key).toBe("birth_date");
    expect(q?.optional).toBe(true);
    expect(planIntakeState(DEFS, nearlyDone).status).toBe("completed");
  });

  it("UI = engine = stored state (same plan object)", () => {
    const plan = planIntakeState(DEFS, orly);
    expect(plan.stage).toBe("interests");
    expect(plan.status).toBe("in_progress");
    expect(plan.next).toEqual(getNextMissingIntakeQuestion(DEFS, orly));
    expect(plan.missing).not.toContain("city");
  });

  it("stale stored state self-heals from the facts", () => {
    // stored intake_last_step_id was 'birth_date'; the plan ignores it
    expect(planIntakeState(DEFS, orly).stage).toBe("interests");
  });

  it("repeated / concurrent evaluation is deterministic (two workers)", () => {
    const a = planIntakeState(DEFS, orly);
    const b = planIntakeState(DEFS, JSON.parse(JSON.stringify(orly)));
    expect(b).toEqual(a);
  });

  it("empty contact starts at first_name and reports not_started", () => {
    const empty = { facts: {}, skipped: [] as string[] };
    expect(getNextMissingIntakeQuestion(DEFS, empty)?.field_key).toBe("first_name");
    expect(planIntakeState(DEFS, empty).status).toBe("not_started");
  });

  it("skipped fields are not re-asked (restart/retry)", () => {
    const skipped = { facts: orly.facts, skipped: ["interests"] };
    expect(getNextMissingIntakeQuestion(DEFS, skipped)?.field_key).toBe("primary_goal");
  });
});
