/**
 * "הפעלת תמר" — manual, admin-initiated Tamar conversation starter.
 *
 * Pure logic only: topics, template policy and the safety gate. Every rule is
 * re-evaluated twice — once for the preview and once again at execution time.
 */

export type ActivationTopic =
  | "intake_continue"
  | "community_intro"
  | "trip_event"
  | "relationship_survey"
  | "activity_update"
  | "free_topic";

export type TopicSpec = {
  key: ActivationTopic;
  label_he: string;
  /** marketing content → consent_marketing is mandatory */
  requires_marketing_consent: boolean;
  /** approved Meta template usable OUTSIDE the 24h window for this topic */
  template: { name: string; language: string } | null;
  /**
   * The topic may only run when a real, active (sellable) offer backs it.
   * Enforced strictly outside the service window, where the template promises
   * "פעילות חדשה" without naming it.
   */
  requires_active_offer?: boolean;
  /** the free-text instruction may stay empty — a safe internal one is used */
  instruction_optional?: boolean;
};

/**
 * Legacy / renamed topics. "חזרה מתוזמנת" is not a separate purpose: a future
 * date lives in the schedule field, so it maps to the re-engagement route.
 */
export const TOPIC_ALIASES: Record<string, ActivationTopic> = {
  scheduled_followup: "activity_update",
};

export function resolveTopic(topic: string): string {
  return TOPIC_ALIASES[topic] ?? topic;
}

/** Safe internal instruction used when the admin leaves the field empty. */
export const DEFAULT_INSTRUCTIONS: Record<string, string> = {
  activity_update:
    "לחדש קשר בעדינות סביב פעילות פעילה ורלוונטית. אין להמציא תוכן, תאריך, מחיר או קישור — פרטים נשלחים רק אחרי תגובה חיובית.",
};

export function effectiveInstruction(topic: string, instruction: string | null | undefined): string {
  const s = String(instruction ?? "").trim();
  if (s) return s;
  return DEFAULT_INSTRUCTIONS[resolveTopic(topic)] ?? "";
}

/**
 * zooga_opening_consent is reserved for the consent opening only. It must
 * never be reused as a generic follow-up template.
 */
export const RESERVED_TEMPLATES = ["zooga_opening_consent"];

/**
 * Approved (Meta, Hebrew) re-engagement template. Allowed ONLY for renewing
 * contact around a real active activity, outside the 24h service window.
 * Body: "היי {{1}}, כאן תמר ... רוצה שאשלח לך את הפרטים?"
 * {{1}} = first name, with a respectful fallback. No activity details inside
 * the template itself — those are sent only after the customer replies.
 */
export const REENGAGEMENT_TEMPLATE = { name: "zooga_reengagement_followup", language: "he" } as const;

/** Respectful fallback for the template's {{1}} parameter. */
export function templateFirstName(name: string | null | undefined): string {
  const n = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return n || "חבר/ה יקר/ה";
}

export const ACTIVATION_TOPICS: TopicSpec[] = [
  { key: "intake_continue", label_he: "המשך אינטייק", requires_marketing_consent: false, template: null },
  { key: "community_intro", label_he: "היכרות עם הקהילה", requires_marketing_consent: false, template: null },
  { key: "trip_event", label_he: "טיול / אירוע", requires_marketing_consent: true, template: null },
  { key: "relationship_survey", label_he: "שאלון זוגיות", requires_marketing_consent: false, template: null },
  {
    key: "activity_update",
    label_he: "חידוש שיחה – עדכון על פעילות חדשה",
    requires_marketing_consent: true,
    template: { ...REENGAGEMENT_TEMPLATE },
    requires_active_offer: true,
    instruction_optional: true,
  },
  { key: "free_topic", label_he: "נושא חופשי", requires_marketing_consent: false, template: null },
];

export function topicSpec(topic: string): TopicSpec | null {
  const key = resolveTopic(topic);
  return ACTIVATION_TOPICS.find((t) => t.key === key) ?? null;
}

export const MIN_INSTRUCTION_LENGTH = 6;

export type ActivationStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "sent"
  | "blocked"
  | "cancelled"
  | "failed";

export const STATUS_LABELS_HE: Record<ActivationStatus, string> = {
  draft: "טיוטה",
  scheduled: "מתוזמן",
  processing: "בביצוע",
  sent: "נשלח",
  blocked: "נחסם",
  cancelled: "בוטל",
  failed: "נכשל",
};

export type ActivationGateInput = {
  topic: string;
  instruction: string;
  contact: {
    id?: string | null;
    phone?: string | null;
    whatsapp_number?: string | null;
    whatsapp_opt_in_status?: string | null;
    whatsapp_opt_in_at?: string | null;
    whatsapp_opt_in_source?: string | null;
    consent_marketing?: boolean | null;
    opted_out_at?: string | null;
    human_owned?: boolean | null;
  } | null;
  /** more than one contact row resolves to this phone */
  duplicateContacts?: number;
  openHandoffs?: number;
  sessionWindowOpen: boolean;
  /** an approved Meta template exists AND matches this topic exactly */
  templateApproved?: boolean;
  offerSelected?: boolean;
  offerSellable?: boolean;
  /** a pending draft/scheduled/processing activation already exists */
  pendingActivation?: boolean;
  /** an identical activation was already sent recently */
  recentDuplicateMessage?: boolean;
};

export type ActivationGate = {
  allowed: boolean;
  reason: string | null;
  reason_he: string | null;
  transport: "session" | "template" | null;
};

const block = (reason: string, he: string): ActivationGate => ({
  allowed: false,
  reason,
  reason_he: he,
  transport: null,
});

/**
 * The single safety gate. Runs identically for preview and for execution, so
 * a preview can never promise something the send would refuse.
 */
export function evaluateActivation(input: ActivationGateInput): ActivationGate {
  const spec = topicSpec(input.topic);
  if (!spec) return block("unknown_topic", "מטרת השיחה אינה מוכרת");
  const instruction = effectiveInstruction(input.topic, input.instruction);
  if (instruction.length < MIN_INSTRUCTION_LENGTH)
    return block("instruction_missing", "יש לכתוב הוראה לתמר");

  const c = input.contact;
  if (!c) return block("contact_not_found", "איש הקשר לא נמצא");
  if ((input.duplicateContacts ?? 1) > 1)
    return block("duplicate_contacts", "קיימות רשומות כפולות למספר הזה — יש לאחד לפני שליחה");
  if (!(c.whatsapp_number || c.phone)) return block("missing_phone", "אין מספר טלפון");
  if (c.opted_out_at) return block("opted_out", "הלקוח ביקש להפסיק קבלת הודעות");

  const status = String(c.whatsapp_opt_in_status ?? "unknown");
  if (status === "denied") return block("opt_in_denied", "אישור הפנייה בוואטסאפ נדחה");
  if (status !== "verified" || !c.whatsapp_opt_in_source || !c.whatsapp_opt_in_at)
    return block("opt_in_unverified", "אין אישור מאומת לפנייה בוואטסאפ (נדרש מקור ומועד)");

  if (c.human_owned) return block("human_owned", "השיחה בטיפול אנושי");
  if ((input.openHandoffs ?? 0) > 0) return block("open_handoff", "קיימת פנייה פתוחה לנציג");

  if (spec.requires_marketing_consent && !c.consent_marketing)
    return block("no_marketing_consent", "אין הסכמה שיווקית לנושא הזה");

  if (input.offerSelected && !input.offerSellable)
    return block("offer_not_sellable", "המוצר שנבחר אינו פעיל למכירה");

  if (spec.requires_active_offer && !(input.offerSelected && input.offerSellable))
    return block("no_active_offer", "אין פעילות פעילה שאפשר לעדכן עליה — יש לבחור מוצר/אירוע פעיל שלא פג");

  if (input.pendingActivation) return block("duplicate_activation", "כבר קיימת הפעלה ממתינה לאיש הקשר");
  if (input.recentDuplicateMessage)
    return block("duplicate_message", "הודעה זהה כבר נשלחה לאחרונה");

  if (input.sessionWindowOpen) {
    return { allowed: true, reason: null, reason_he: null, transport: "session" };
  }

  if (!spec.template) {
    return block(
      "no_service_window_no_template",
      "חלון 24 השעות סגור ואין תבנית מאושרת שמתאימה למטרה הזו — לא ניתן לשלוח טקסט חופשי",
    );
  }
  if (RESERVED_TEMPLATES.includes(spec.template.name))
    return block("reserved_template", "תבנית פתיחת ההסכמה אינה מיועדת לשיחות המשך");
  if (!input.templateApproved)
    return block("template_not_approved", "התבנית הנדרשת אינה מאושרת ב-Meta");

  return { allowed: true, reason: null, reason_he: null, transport: "template" };
}

/** Israel-local wall clock → UTC ISO. The UI always works in Israel time. */
export function isFutureSchedule(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t > now.getTime();
}

/** Stable per-request idempotency key: same intent = same key. */
export function activationIdempotencyKey(args: {
  contactId: string;
  topic: string;
  instruction: string;
  offerId?: string | null;
  scheduledAt?: string | null;
}): string {
  const norm = args.instruction.trim().replace(/\s+/g, " ").toLowerCase();
  return [
    "act",
    args.contactId,
    args.topic,
    args.offerId ?? "no-offer",
    args.scheduledAt ?? "now",
    hash(norm),
  ].join(":");
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}