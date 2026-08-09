/**
 * SINGLE SOURCE OF TRUTH for the approved Meta template `zooga_manager_handoff`.
 *
 * Approved template body variables (order is contractual):
 *   {{1}} = customer display name
 *   {{2}} = real callback phone number
 *   {{3}} = useful, short context (last request + deterministic transcript digest)
 *
 * Technical values (reason codes, urgency enums, trace ids) MUST NEVER be sent
 * as template parameters — they stay in DB/UI/audit metadata only.
 */
import { normalizePhone } from "@/lib/phone";

export const MANAGER_ALERT_TEMPLATE_NAME = "zooga_manager_handoff";
export const MANAGER_ALERT_TEMPLATE_LANGUAGE = "he";
/** Meta hard-fails params with newlines/tabs/4+ spaces; keep well under 1024. */
export const MANAGER_ALERT_PARAM_MAX = 700;

export const NAME_FALLBACK_HE = "ללא שם";
export const NAME_FALLBACK_EN = "Unknown contact";
export const PHONE_FALLBACK_HE = "מספר לא זמין";
export const PHONE_FALLBACK_EN = "Phone unavailable";
export const CONTEXT_FALLBACK_HE = "הלקוח ביקש לחזור אליו";
export const CONTEXT_FALLBACK_EN = "The customer asked to be called back";

export type TranscriptTurn = { ts?: string | null; source?: string | null; content?: string | null };

export type ManagerAlertRow = {
  customer_name?: string | null;
  customer_phone?: string | null;
  contact_phone?: string | null;
  contact_whatsapp_number?: string | null;
  sender_id?: string | null;
  latest_inbound_message?: string | null;
  conversation_excerpt?: unknown;
};

export type ManagerAlertParams = {
  name: string;
  phone: string;
  context: string;
  /** non-fatal data problems for the audit log; never sent to Meta */
  dataIssues: string[];
};

/** Meta rejects newlines/tabs and runs of 4+ spaces inside template params. */
function sanitizeParam(value: string, max = MANAGER_ALERT_PARAM_MAX): string {
  const flat = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

const TECHNICAL_TOKEN = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

/** A bare enum/reason code must never leak into a customer-facing parameter. */
export function looksTechnical(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  if (!v) return false;
  return TECHNICAL_TOKEN.test(v) || ["normal", "high", "low"].includes(v.toLowerCase());
}

function isHebrew(lang: string): boolean {
  return lang.toLowerCase().startsWith("he");
}

function speakerLabel(source: string | null | undefined, he: boolean): string {
  const s = String(source ?? "").toLowerCase();
  if (s.includes("tamar") || s.includes("assistant") || s.includes("outbound") || s.includes("bot")) {
    return he ? "תמר" : "Tamar";
  }
  return he ? "לקוח" : "Customer";
}

function turns(raw: unknown): TranscriptTurn[] {
  return Array.isArray(raw) ? (raw as TranscriptTurn[]).filter((t) => !!String(t?.content ?? "").trim()) : [];
}

/** Deterministic digest of the last 4–6 turns, chronological, no invention. */
export function buildTranscriptDigest(
  excerpt: unknown,
  latestInbound: string | null | undefined,
  language = MANAGER_ALERT_TEMPLATE_LANGUAGE,
): string {
  const he = isHebrew(language);
  const all = turns(excerpt);
  const last = all.slice(-6);
  const parts: string[] = [];
  const request = String(latestInbound ?? "").trim();
  if (request) parts.push(`${he ? "בקשה אחרונה" : "Latest request"}: ${request}`);
  if (last.length) {
    const lines = last.map((t) => `${speakerLabel(t.source, he)}: ${String(t.content ?? "").trim()}`);
    parts.push(`${he ? "שיחה" : "Conversation"}: ${lines.join(" | ")}`);
  }
  if (!parts.length) {
    return he ? CONTEXT_FALLBACK_HE : CONTEXT_FALLBACK_EN;
  }
  return sanitizeParam(parts.join(" • "));
}

/** Resolve {{1}}/{{2}}/{{3}} from a handoff row plus optional contact data. */
export function buildManagerAlertParams(
  row: ManagerAlertRow,
  language = MANAGER_ALERT_TEMPLATE_LANGUAGE,
): ManagerAlertParams {
  const he = isHebrew(language);
  const dataIssues: string[] = [];

  const rawName = String(row.customer_name ?? "").trim();
  const name =
    rawName && !looksTechnical(rawName) ? sanitizeParam(rawName, 60) : he ? NAME_FALLBACK_HE : NAME_FALLBACK_EN;
  if (!rawName) dataIssues.push("missing_customer_name");
  else if (looksTechnical(rawName)) dataIssues.push("technical_value_in_customer_name");

  const candidates = [row.customer_phone, row.contact_whatsapp_number, row.contact_phone, row.sender_id];
  let phone: string | null = null;
  for (const c of candidates) {
    const v = String(c ?? "").trim();
    if (!v || looksTechnical(v)) continue;
    const norm = normalizePhone(v);
    if (norm) {
      phone = norm;
      break;
    }
  }
  if (!phone) dataIssues.push("missing_callback_phone");

  const context = buildTranscriptDigest(row.conversation_excerpt, row.latest_inbound_message, language);
  if (context === (he ? CONTEXT_FALLBACK_HE : CONTEXT_FALLBACK_EN)) dataIssues.push("empty_transcript_context");

  return {
    name,
    phone: phone ?? (he ? PHONE_FALLBACK_HE : PHONE_FALLBACK_EN),
    context,
    dataIssues,
  };
}

/** Exact Meta `components` array for the approved template. */
export function buildManagerAlertComponents(
  row: ManagerAlertRow,
  language = MANAGER_ALERT_TEMPLATE_LANGUAGE,
): { components: any[]; params: ManagerAlertParams } {
  const params = buildManagerAlertParams(row, language);
  return {
    params,
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: params.name },
          { type: "text", text: params.phone },
          { type: "text", text: params.context },
        ],
      },
    ],
  };
}

/** Free-text (in-window) manager alert — same information, no template. */
export function buildManagerAlertText(
  row: ManagerAlertRow & { crm_link?: string | null; escalation_count?: number | null },
  language = MANAGER_ALERT_TEMPLATE_LANGUAGE,
): string {
  const he = isHebrew(language);
  const p = buildManagerAlertParams(row, language);
  return [
    he ? "🔔 התראת זוגה — נדרש טיפול אנושי" : "🔔 Zooga alert — human handling required",
    `${he ? "שם הלקוח" : "Customer"}: ${p.name}`,
    `${he ? "מספר לחזרה" : "Callback number"}: ${p.phone}`,
    (row.escalation_count ?? 0) > 1 ? `${he ? "תזכורת" : "Reminder"} #${row.escalation_count}` : null,
    `${he ? "הקשר" : "Context"}: ${p.context}`,
    row.crm_link ? `CRM: ${row.crm_link}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}