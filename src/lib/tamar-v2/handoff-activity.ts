/**
 * TAMAR V2 — HUMAN HANDOFF IS A COLLABORATION STATE, NEVER A LOCK (PURE).
 *
 * Production defect this repairs: a contact carried an old `human_owned`
 * freeze with an open-but-untouched handoff row. Every inbound message —
 * including explicit "מתחילים מחדש" / "ריסט" — was answered with the same
 * boilerplate "הבקשה שלך כבר הועברה לאדם מהצוות...", forever.
 *
 * Rules encoded here (deterministic, contact-specific, no time-only release):
 *  - "Active human handling" requires RECENT, contact-specific MANAGER
 *    activity (claimed / contacted / manager note / explicit manual lock).
 *    A stale transfer nobody touched is NOT active handling.
 *  - Stale freeze  -> ownership returns to Tamar for ANY inbound message.
 *  - Active handling + explicit re-engagement/reset -> ownership returns to
 *    Tamar (the customer explicitly asked to continue with her).
 *  - Active handling + ordinary message -> exactly ONE concise status reply;
 *    further messages are recorded on the handoff without repeating it.
 *  - Nothing here deletes history, CRM, memories, transcripts or notes.
 */

/** How recent contact-specific manager activity must be to count as active. */
export const ACTIVE_HANDLING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Do not repeat the status reply more than once per this window. */
export const STATUS_ACK_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export type HandoffRow = {
  status?: string | null;
  created_at?: string | null;
  claimed_at?: string | null;
  contacted_at?: string | null;
  resolved_at?: string | null;
  manager_summary?: string | null;
  notes?: unknown;
};

export type HandoffActivityInput = {
  humanOwned: boolean;
  /** set only by an explicit "take this conversation" manual lock */
  humanOwnedBy?: string | null;
  humanOwnedAt?: string | null;
  openHandoffs: HandoffRow[];
  /** any other contact-specific manager touch (note, task update) */
  managerLastActivityAt?: string | null;
  now?: Date;
};

export type HandoffActivity = {
  active: boolean;
  reason:
    | "not_frozen"
    | "active_manager_claimed"
    | "active_manual_lock"
    | "active_manager_activity"
    | "stale_no_open_handoff"
    | "stale_untouched_handoff"
    | "stale_manager_activity";
  lastManagerActivityAt: string | null;
  ageMs: number | null;
};

function ts(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Date.parse(raw);
  return Number.isNaN(n) ? null : n;
}

/**
 * Decide — deterministically and only from contact-specific evidence —
 * whether a human is ACTIVELY handling this conversation right now.
 */
export function assessHumanHandling(input: HandoffActivityInput): HandoffActivity {
  const now = (input.now ?? new Date()).getTime();
  const frozen = input.humanOwned === true || input.openHandoffs.length > 0;
  if (!frozen) {
    return { active: false, reason: "not_frozen", lastManagerActivityAt: null, ageMs: null };
  }

  const touches: Array<{ at: number; kind: HandoffActivity["reason"] }> = [];
  for (const row of input.openHandoffs) {
    const claimed = ts(row.claimed_at);
    if (claimed) touches.push({ at: claimed, kind: "active_manager_claimed" });
    const contacted = ts(row.contacted_at);
    if (contacted) touches.push({ at: contacted, kind: "active_manager_claimed" });
  }
  const manual = input.humanOwnedBy ? ts(input.humanOwnedAt) : null;
  if (manual) touches.push({ at: manual, kind: "active_manual_lock" });
  const other = ts(input.managerLastActivityAt);
  if (other) touches.push({ at: other, kind: "active_manager_activity" });

  if (!touches.length) {
    return {
      active: false,
      reason: input.openHandoffs.length ? "stale_untouched_handoff" : "stale_no_open_handoff",
      lastManagerActivityAt: null,
      ageMs: null,
    };
  }

  touches.sort((a, b) => b.at - a.at);
  const latest = touches[0]!;
  const ageMs = now - latest.at;
  const iso = new Date(latest.at).toISOString();
  if (ageMs <= ACTIVE_HANDLING_WINDOW_MS) {
    return { active: true, reason: latest.kind, lastManagerActivityAt: iso, ageMs };
  }
  return { active: false, reason: "stale_manager_activity", lastManagerActivityAt: iso, ageMs };
}

export type HandoffTurnAction = "none" | "resume_tamar" | "status_reply" | "status_quiet";

export type HandoffTurnDecision = {
  action: HandoffTurnAction;
  reason: string;
};

/**
 * What this inbound turn should do with a frozen thread.
 * `lastStatusAckAt` is the last time the customer already received the
 * "a human has your request" status reply.
 */
export function decideHandoffTurn(args: {
  frozen: boolean;
  activity: HandoffActivity;
  resetRequested: boolean;
  lastStatusAckAt?: string | null;
  now?: Date;
}): HandoffTurnDecision {
  if (!args.frozen) return { action: "none", reason: "not_frozen" };
  if (!args.activity.active) {
    return {
      action: "resume_tamar",
      reason: args.resetRequested ? `reset_${args.activity.reason}` : args.activity.reason,
    };
  }
  // Never auto-release a genuinely active manager conversation on time alone.
  if (args.resetRequested) {
    return { action: "resume_tamar", reason: "customer_reengagement_reset" };
  }
  const now = (args.now ?? new Date()).getTime();
  const acked = ts(args.lastStatusAckAt);
  if (acked && now - acked < STATUS_ACK_COOLDOWN_MS) {
    return { action: "status_quiet", reason: "status_already_acked" };
  }
  return { action: "status_reply", reason: args.activity.reason };
}

/** Concise status copy — sent once, never as a per-message boilerplate loop. */
export const HANDOFF_ACTIVE_STATUS_TEXT =
  "אדם מהצוות של זוגה מטפל בפנייה שלך כרגע ויחזור אליך. כתבתי לו גם את ההודעה הזאת. אם בינתיים תרצה/י להמשיך איתי, אפשר לכתוב לי \"נתחיל מחדש\".";
