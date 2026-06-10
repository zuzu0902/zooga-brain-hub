/**
 * Intake recovery layer — runtime safeguards against intake loops.
 *
 * Three deterministic guards, evaluated BEFORE the normal intake directive:
 *
 * 1. REPETITION GUARD
 *    Trigger: the inbound message matches REPETITION_RE
 *    ("כבר אמרתי", "גם את זה אמרתי", "שיתפתי", "עניתי כבר", "already told you"...).
 *    Effect: normal intake progression is suspended this turn. Tamar must
 *    acknowledge, and if the last-asked field was NOT persisted, explicitly
 *    verify it ("רק כדי לוודא שנשמר אצלי נכון...") instead of asking a new
 *    question or re-asking as if nothing happened.
 *
 * 2. FRUSTRATION OVERRIDE
 *    Trigger: the inbound message matches FRUSTRATION_RE
 *    ("אני מאבד סבלנות", "נמאס לי", "די כבר", "את לא מקשיבה", "fed up"...).
 *    Effect: intake questions are fully suppressed this turn; Tamar shifts to
 *    repair mode (apologize once, give concrete value, offer human help).
 *    If the frustration/repetition streak across recent inbound turns
 *    reaches FRUSTRATION_HANDOFF_STREAK, the runtime suggests handoff.
 *
 * 3. CAPTURE RECOVERY
 *    Trigger: repetition guard fired AND the last-asked intake field is still
 *    missing from the snapshot (asked-but-not-persisted).
 *    Effect: that field becomes the recovery_target_field; the directive asks
 *    Tamar to verify exactly that value once, and intake_last_question_key is
 *    kept pointed at it so context-aware extractors (e.g. bare-name fallback)
 *    can capture the re-stated answer.
 */
import type { IntakeFieldKey, IntakeSnapshot } from "@/lib/intake-workflow";

export const REPETITION_RE =
  /(כבר\s+אמרתי|אמרתי\s+כבר|אמרתי\s+לך|גם\s+את\s+זה\s+אמרתי|כבר\s+עניתי|עניתי\s+כבר|עניתי\s+לך|כבר\s+שיתפתי|שיתפתי(\s+(כבר|אתך|איתך))?$|שיתפתי\s+(כבר|אתך|איתך)|כבר\s+כתבתי|כתבתי\s+לך|שאלת\s+(אותי\s+)?כבר|שוב\s+אותה\s+שאלה|כמה\s+פעמים\s+(צריך\s+)?ל(הגיד|ענות|כתוב)|already\s+(said|told|answered|shared|gave)|i\s+(just\s+)?told\s+you|same\s+question\s+again|asked\s+(me\s+)?(that\s+)?already)/i;

export const FRUSTRATION_RE =
  /(מאבד(ת)?\s+סבלנות|נגמרה?\s+לי\s+הסבלנות|אזלה\s+סבלנותי|נמאס\s+לי|נמאס\s+כבר|די\s+כבר|מספיק\s+כבר|^די[!.\s]*$|מעצבן(ת)?|מתסכל|מתוסכל(ת)?|את\s+לא\s+מקשיבה|לא\s+מקשיבה\s+לי|את\s+לא\s+מבינה|חוזר(ת)?\s+על\s+עצמך|עזבי|עזוב\s+את\s+זה|שכחי\s+מזה|losing\s+(my\s+)?patience|fed\s+up|so\s+annoying|this\s+is\s+frustrating|you('?re|\s+are)\s+not\s+listening|stop\s+asking)/i;

/** Streak of distress signals (current turn included) that suggests handoff. */
export const FRUSTRATION_HANDOFF_STREAK = 2;

/** How many recent INBOUND messages to scan for the streak. */
const STREAK_WINDOW = 6;

export type RecoveryMode = "none" | "repetition_recovery" | "frustration_repair";

export type RecoveryDecision = {
  mode: RecoveryMode;
  reasons: string[];
  repetition_signal: boolean;
  frustration_signal: boolean;
  /** Distress signals (frustration OR repetition) in recent inbound turns, current included. */
  frustration_streak: number;
  /** Field that was asked but never persisted — the thing to verify. */
  recovery_target_field: IntakeFieldKey | null;
  /** When true the runtime must NOT issue a normal intake question this turn. */
  suppress_intake_question: boolean;
  /** When true the handoff layer should treat this as an escalation trigger. */
  suggest_handoff: boolean;
  /** Replacement directive injected instead of the normal intake directive. */
  directive: string | null;
};

function isInbound(i: any): boolean {
  const src = String(i?.source ?? "");
  return src !== "tamar_outbound" && i?.type !== "tamar_outbound";
}

function countDistressStreak(message: string, interactions: any[]): number {
  let count = 0;
  if (REPETITION_RE.test(message) || FRUSTRATION_RE.test(message)) count += 1;
  const recentInbound = (interactions || []).filter(isInbound).slice(0, STREAK_WINDOW);
  for (const i of recentInbound) {
    const txt = String(i?.content ?? "");
    if (REPETITION_RE.test(txt) || FRUSTRATION_RE.test(txt)) count += 1;
  }
  return count;
}

function repetitionDirective(target: IntakeFieldKey | null, knownSummary: string | null): string {
  const lines = [
    "RECOVERY MODE — REPETITION GUARD ACTIVE. The user says they ALREADY provided this information.",
    "Do NOT ask any new intake question this turn. Do NOT re-ask the same question as if nothing happened.",
  ];
  if (target) {
    lines.push(
      `The field "${target}" was asked but was NOT successfully saved on our side. Own the mistake briefly and VERIFY it explicitly: e.g. "סליחה, כנראה לא נשמר אצלי נכון — רק כדי לוודא, אפשר לחזור על זה פעם אחת?" Frame it as a save/verification issue on OUR side, never as the user failing to answer.`,
    );
  } else {
    lines.push(
      "All recently-asked fields ARE saved. Acknowledge that you have the information, briefly reflect back what you know, and continue the conversation WITHOUT repeating any question.",
    );
  }
  if (knownSummary) {
    lines.push(`What we already have on file (reflect this back so the user feels heard): ${knownSummary}`);
  }
  return lines.join(" ");
}

function frustrationDirective(suggestHandoff: boolean): string {
  const lines = [
    "RECOVERY MODE — FRUSTRATION OVERRIDE ACTIVE. The user is clearly frustrated.",
    "HARD RULES this turn: (a) ZERO intake questions — do not ask for any personal detail, (b) apologize ONCE, briefly and sincerely — no over-apologizing, (c) give concrete value or a concrete next step instead of another question, (d) keep it short.",
  ];
  if (suggestHandoff) {
    lines.push(
      'Offer a human explicitly: e.g. "אם נוח לך, אני יכולה להעביר אותך עכשיו לנציג אנושי שילווה אותך אישית". The runtime is also flagging this conversation for manager attention.',
    );
  } else {
    lines.push("If frustration continues next turn, the conversation will be escalated to a human.");
  }
  return lines.join(" ");
}

export function decideRecovery(args: {
  message: string;
  interactions: any[];
  lastAskedKey: string | null;
  snapshot: IntakeSnapshot;
  /** Optional short Hebrew summary of already-captured fields. */
  knownSummary?: string | null;
}): RecoveryDecision {
  const message = String(args.message ?? "");
  const repetition_signal = REPETITION_RE.test(message);
  const frustration_signal = FRUSTRATION_RE.test(message);
  const frustration_streak = countDistressStreak(message, args.interactions);

  const reasons: string[] = [];
  if (repetition_signal) reasons.push("repetition_signal");
  if (frustration_signal) reasons.push("frustration_signal");
  if (frustration_streak >= FRUSTRATION_HANDOFF_STREAK) {
    reasons.push(`distress_streak_${frustration_streak}`);
  }

  // Capture recovery target: last asked field that is still missing.
  const lastAsked = (args.lastAskedKey ?? null) as IntakeFieldKey | null;
  const recovery_target_field =
    lastAsked && args.snapshot.missing.includes(lastAsked) ? lastAsked : null;

  if (frustration_signal) {
    const suggest_handoff = frustration_streak >= FRUSTRATION_HANDOFF_STREAK;
    return {
      mode: "frustration_repair",
      reasons,
      repetition_signal,
      frustration_signal,
      frustration_streak,
      recovery_target_field,
      suppress_intake_question: true,
      suggest_handoff,
      directive: frustrationDirective(suggest_handoff),
    };
  }

  if (repetition_signal) {
    return {
      mode: "repetition_recovery",
      reasons,
      repetition_signal,
      frustration_signal,
      frustration_streak,
      recovery_target_field,
      suppress_intake_question: true,
      suggest_handoff: frustration_streak >= FRUSTRATION_HANDOFF_STREAK + 1,
      directive: repetitionDirective(recovery_target_field, args.knownSummary ?? null),
    };
  }

  return {
    mode: "none",
    reasons,
    repetition_signal: false,
    frustration_signal: false,
    frustration_streak,
    recovery_target_field: null,
    suppress_intake_question: false,
    suggest_handoff: false,
    directive: null,
  };
}

/** Short Hebrew summary of captured intake facts for the repetition directive. */
export function summarizeKnownIntake(contact: any): string | null {
  if (!contact) return null;
  const parts: string[] = [];
  if (contact.first_name || contact.full_name) parts.push(`שם: ${contact.first_name || contact.full_name}`);
  if (contact.birth_date) parts.push(`תאריך לידה: ${contact.birth_date}`);
  else if (contact.age) parts.push(`גיל: ${contact.age}`);
  if (contact.city || contact.region) parts.push(`אזור: ${contact.city || contact.region}`);
  if (Array.isArray(contact.social_goals) && contact.social_goals.length)
    parts.push(`מטרה: ${contact.social_goals.join(", ")}`);
  if (Array.isArray(contact.favorite_activity_types) && contact.favorite_activity_types.length)
    parts.push(`פעילויות: ${contact.favorite_activity_types.join(", ")}`);
  return parts.length ? parts.join(" | ") : null;
}