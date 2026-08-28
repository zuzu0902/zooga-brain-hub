/**
 * MANAGER HANDOFF OUTCOME (PURE).
 *
 * A manager may not silently hand a conversation back to Tamar. Before the
 * release, the manager records IN CRM that contact occurred plus the outcome
 * and notes; Tamar then resumes from the full conversation AND that summary.
 * There is no automatic release.
 */
export const HANDOFF_OUTCOMES = [
  "resolved",
  "sold",
  "scheduled_followup",
  "needs_more_info",
  "not_interested",
  "no_answer",
  "escalated",
] as const;

export type HandoffOutcome = (typeof HANDOFF_OUTCOMES)[number];

export const HANDOFF_OUTCOME_LABELS_HE: Record<HandoffOutcome, string> = {
  resolved: "טופל ונסגר",
  sold: "בוצעה מכירה/הרשמה",
  scheduled_followup: "נקבע מעקב",
  needs_more_info: "נדרש מידע נוסף",
  not_interested: "לא מעוניין",
  no_answer: "לא היה מענה",
  escalated: "הועבר להמשך טיפול",
};

export type ManagerOutcomeInput = {
  contacted?: boolean;
  contactedAt?: string | null;
  outcome?: string | null;
  summary?: string | null;
};

export type ManagerOutcome = {
  contacted_at: string;
  outcome: HandoffOutcome;
  manager_summary: string;
};

export const MIN_SUMMARY_LENGTH = 10;

/** Hebrew blockers for the UI — empty array means the form may be submitted. */
export function managerOutcomeBlockers(input: ManagerOutcomeInput): string[] {
  const blockers: string[] = [];
  if (input.contacted !== true) blockers.push("יש לאשר שבוצעה יצירת קשר עם הלקוח");
  const outcome = String(input.outcome ?? "");
  if (!(HANDOFF_OUTCOMES as readonly string[]).includes(outcome)) blockers.push("יש לבחור תוצאה");
  if (String(input.summary ?? "").trim().length < MIN_SUMMARY_LENGTH) {
    blockers.push(`יש לכתוב סיכום לנציג (לפחות ${MIN_SUMMARY_LENGTH} תווים)`);
  }
  if (input.contactedAt && Number.isNaN(Date.parse(input.contactedAt))) {
    blockers.push("מועד יצירת הקשר אינו תקין");
  }
  return blockers;
}

/** Strict validation used by the server before any release is performed. */
export function validateManagerOutcome(input: ManagerOutcomeInput, now: Date = new Date()): ManagerOutcome {
  const blockers = managerOutcomeBlockers(input);
  if (blockers.length) throw new Error("manager_outcome_required");
  return {
    contacted_at: input.contactedAt ? new Date(input.contactedAt).toISOString() : now.toISOString(),
    outcome: String(input.outcome) as HandoffOutcome,
    manager_summary: String(input.summary).trim().slice(0, 2000),
  };
}

/** The compact summary Tamar reads when she resumes the conversation. */
export function managerResumeBrief(outcome: ManagerOutcome): string {
  return `סיכום נציג (${HANDOFF_OUTCOME_LABELS_HE[outcome.outcome]}): ${outcome.manager_summary}`;
}
