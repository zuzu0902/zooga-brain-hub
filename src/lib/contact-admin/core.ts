/**
 * CONTACT ADMIN CORE — pure, testable rules for the two destructive-ish
 * admin actions on a contact: "Tamar reset" and "clean contact deletion".
 * No IO here; the transactional work happens in the Postgres functions
 * `admin_reset_tamar` / `admin_delete_contact`.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The literal word the admin must type to confirm a deletion. */
export const DELETE_CONFIRM_WORD = "מחק";

export const MIN_REASON_LENGTH = 3;
export const MAX_REASON_LENGTH = 500;

export type ResetInput = { contactId: string; reason: string; resetIntake?: boolean };

export function validateResetInput(input: Partial<ResetInput> | null | undefined): {
  contactId: string;
  reason: string;
  resetIntake: boolean;
} {
  const contactId = String(input?.contactId ?? "").trim();
  if (!UUID_RE.test(contactId)) throw new Error("invalid_contact_id");
  const reason = String(input?.reason ?? "").trim();
  if (reason.length < MIN_REASON_LENGTH) throw new Error("reset_reason_required");
  return { contactId, reason: reason.slice(0, MAX_REASON_LENGTH), resetIntake: input?.resetIntake === true };
}

export function validateDeleteInput(
  input: Partial<{ contactId: string; reason: string; confirmation: string }> | null | undefined,
): { contactId: string; reason: string } {
  const contactId = String(input?.contactId ?? "").trim();
  if (!UUID_RE.test(contactId)) throw new Error("invalid_contact_id");
  const reason = String(input?.reason ?? "").trim();
  if (reason.length < MIN_REASON_LENGTH) throw new Error("delete_reason_required");
  if (!isDeleteConfirmed(input?.confirmation)) throw new Error("confirmation_word_mismatch");
  return { contactId, reason: reason.slice(0, MAX_REASON_LENGTH) };
}

/** The admin must type the exact word; whitespace is forgiven, nothing else. */
export function isDeleteConfirmed(value: string | null | undefined): boolean {
  return String(value ?? "").trim() === DELETE_CONFIRM_WORD;
}

/** Never derive send permission from a reset. Opt-out always wins. */
export function nextMessageRoute(args: {
  optedOut?: boolean | null;
  consentStatus?: string | null;
}): "suppressed_opt_out" | "tamar_automation" {
  if (args.optedOut || args.consentStatus === "denied") return "suppressed_opt_out";
  return "tamar_automation";
}

export type ResetResult = {
  ok: boolean;
  handoffs_resolved?: number;
  jobs_cancelled?: number;
  outbox_cancelled?: number;
  dedupe_cleared?: number;
  intake_reset?: boolean;
  intake_answers_deleted?: number;
  intake_states_deleted?: number;
  intake_captures_deleted?: number;
  locks_released?: boolean;
  consent_status?: string | null;
  opted_out?: boolean;
  next_message_route?: string;
  conversation_state?: string;
};

/** Hebrew, human-readable receipt of exactly what the reset did. */
export function summarizeReset(r: ResetResult): string[] {
  const lines = [
    `פניות לנציג שנסגרו: ${r.handoffs_resolved ?? 0}`,
    `נעילות/בעלות אנושית ששוחררו: ${r.locks_released ? "כן" : "לא היה נעול"}`,
    `עבודות רקע שבוטלו: ${r.jobs_cancelled ?? 0}`,
    `שליחות ממתינות שבוטלו: ${r.outbox_cancelled ?? 0}`,
    r.intake_reset
      ? `אינטייק אופס (תשובות: ${r.intake_answers_deleted ?? 0}, שדות: ${r.intake_captures_deleted ?? 0})`
      : "אינטייק לא אופס",
    `הסכמה נשמרה: ${r.consent_status ?? "unknown"}${r.opted_out ? " (opted-out)" : ""}`,
    r.next_message_route === "suppressed_opt_out"
      ? "ההודעה הבאה: לא תישלח פנייה — הלקוח בסירוב"
      : "ההודעה הבאה מהלקוח תנותב לתמר (אוטומציה)",
    "לא נשלחה הודעת WhatsApp כחלק מהאיפוס.",
  ];
  return lines;
}

export const DELETE_COUNT_LABELS: Record<string, string> = {
  messages: "הודעות",
  interactions: "אינטראקציות",
  handoffs: "פניות לנציג",
  open_handoffs: "פניות פתוחות",
  tasks: "משימות",
  memories: "זיכרונות",
  profile_facts: "עובדות פרופיל",
  profile_history: "היסטוריית פרופיל",
  extracted_attributes: "מאפיינים שחולצו",
  pending_insights: "תובנות ממתינות",
  intake_captures: "שדות אינטייק",
  relationship_answers: "תשובות שאלון זוגיות",
  relationship_state: "מצב שאלון",
  voice_transcripts: "תמלולי קול",
  campaign_memberships: "שיוכי קמפיין",
  imported_leads: "לידים מיובאים",
  onboarding_events: "אירועי onboarding",
  decision_traces: "עקבות החלטה",
  runtime_executions: "ריצות runtime",
  state_transitions: "מעברי מצב",
  pending_jobs: "עבודות ממתינות",
  pending_outbox: "שליחות ממתינות",
  identities_preserved: "זהויות שיישמרו (ניתוק בלבד)",
  vault_events_preserved: "אירועי vault שיישמרו",
};

/** Keys that are preserved rather than deleted — shown separately in the modal. */
export const PRESERVED_KEYS = ["identities_preserved", "vault_events_preserved"] as const;

export function maskPhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `***${digits.slice(-4)}`;
}