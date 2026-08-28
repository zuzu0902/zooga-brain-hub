/**
 * HANDOFF RELEASE CORE — pure rules deciding when a thread may go back to
 * Tamar automation. No IO, so both the server paths and the tests share the
 * exact same decision.
 *
 * Two independent holds exist:
 *   1. an open/notified/claimed handoff row  -> the team is still on it
 *   2. an explicit manual lock (`human_owned_by` set by "take conversation")
 * Automatic release (after resolving a handoff, or auto-heal) must respect
 * BOTH. Only an explicit admin action may force past a manual lock.
 */
export type LockSnapshot = {
  humanOwned: boolean;
  /** user id that manually took the thread; null when the freeze came from a handoff */
  humanOwnedBy: string | null;
  humanOwnedAt: string | null;
  openHandoffs: number;
};

export type ReleaseDecision = {
  release: boolean;
  reason:
    | "released"
    | "already_automation_owned"
    | "other_open_handoffs"
    | "manual_human_lock"
    | "forced_release";
};

export function hasManualHumanLock(snap: Pick<LockSnapshot, "humanOwned" | "humanOwnedBy">): boolean {
  return snap.humanOwned === true && !!snap.humanOwnedBy;
}

/** Decide whether an automatic (non-forced) release may happen. */
export function decideAutoRelease(snap: LockSnapshot, opts?: { force?: boolean }): ReleaseDecision {
  if (opts?.force) return { release: true, reason: "forced_release" };
  if (snap.openHandoffs > 0) return { release: false, reason: "other_open_handoffs" };
  if (hasManualHumanLock(snap)) return { release: false, reason: "manual_human_lock" };
  // Idempotent: releasing an already-free thread is a no-op success.
  if (!snap.humanOwned) return { release: false, reason: "already_automation_owned" };
  return { release: true, reason: "released" };
}

/** Human-readable owner label for the UI lock banner (never a phone number). */
export function describeLockHolder(snap: Pick<LockSnapshot, "humanOwnedBy" | "openHandoffs">): string {
  if (snap.humanOwnedBy) return "נציג אנושי (נעילה ידנית)";
  if (snap.openHandoffs > 0) return "פנייה פתוחה לנציג";
  return "אין נעילה";
}

/** Pure validation of an admin release request (client-safe). */
const RELEASE_UUID = /^[0-9a-f-]{36}$/i;
export type ReleaseRequest = {
  contactId: string;
  resetIntake: boolean;
  reason: string;
  /** manager accountability record; required when a handoff is still open */
  managerOutcome?: {
    contacted?: boolean;
    contactedAt?: string | null;
    outcome?: string | null;
    summary?: string | null;
  } | null;
};
export function validateReleaseInput(input: {
  contactId?: string;
  resetIntake?: boolean;
  reason?: string;
  managerOutcome?: ReleaseRequest["managerOutcome"];
}): ReleaseRequest {
  const id = String(input?.contactId ?? "").trim();
  if (!RELEASE_UUID.test(id)) throw new Error("invalid_contact_id");
  const reason = String(input?.reason ?? "").trim();
  if (reason.length < 3) throw new Error("reason_required");
  return {
    contactId: id,
    resetIntake: input?.resetIntake === true,
    reason: reason.slice(0, 300),
    managerOutcome: input?.managerOutcome ?? null,
  };
}
