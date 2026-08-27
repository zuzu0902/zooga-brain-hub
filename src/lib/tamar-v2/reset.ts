/**
 * TAMAR BRAIN V2 — explicit conversation reset (PURE, no I/O).
 *
 * "נתחיל מחדש" is a deterministic, pre-model instruction. It clears ONLY the
 * volatile conversational working state: pending question, ambiguity/answer
 * counters, stale recommendation pointers, the last-offer pointers, the
 * pending product handoff and the rolling short-term summary.
 *
 * It NEVER touches message history, CRM columns, profile facts, memories,
 * audit rows or consent — those are durable truth.
 */

/** Explicit, unambiguous "let's start over" phrasings. */
const RESET_RE =
  /(נתחיל\s+מחדש|בוא(י)?\s+נתחיל\s+מחדש|להתחיל\s+מחדש|התחלה\s+חדשה|מתחילים\s+מחדש|אפס(י)?\s+(את\s+)?השיחה|לאפס\s+(את\s+)?השיחה|תתחילי\s+מחדש|נתחיל\s+מהתחלה|מהתחלה\s+בבקשה|start\s+over|reset\s+(the\s+)?(chat|conversation))/i;

export function isConversationResetRequest(message: string | null | undefined): boolean {
  const raw = String(message ?? "").trim();
  if (!raw) return false;
  return RESET_RE.test(raw);
}

/**
 * The reset acknowledgement. Terminal for the turn: no recommendations, no
 * offers, no unsolicited questions.
 */
export const RESET_ACK_TEXT =
  "בשמחה, מתחילים מחדש 🙂 ניקיתי את מה שהיה פתוח בשיחה שלנו. מה הכי מעניין אותך עכשיו?";

/** Volatile working-state keys cleared by a reset. */
export const RESET_CLEAR_KEYS = [
  "v2_pending_step",
  "v2_ambiguity_turns",
  "v2_answered_count",
  "v2_summary",
  "v2_last_offer_id",
  "v2_last_grounded_offer_id",
  "v2_sent_offer_ids",
  "v2_offer_ledger",
  "v2_pending_handoff",
] as const;

/**
 * Clear the volatile keys from a dynamic_profile_fields object.
 * Returns a NEW object plus the list of keys that actually held a value.
 */
export function applyResetToDynamic(dyn: Record<string, any> | null | undefined): {
  dyn: Record<string, any>;
  cleared: string[];
} {
  const out: Record<string, any> = { ...(dyn ?? {}) };
  const cleared: string[] = [];
  for (const key of RESET_CLEAR_KEYS) {
    const v = out[key];
    const had = v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && v !== "";
    if (had) cleared.push(key);
    delete out[key];
  }
  out["v2_reset_at"] = new Date().toISOString();
  return { dyn: out, cleared };
}
