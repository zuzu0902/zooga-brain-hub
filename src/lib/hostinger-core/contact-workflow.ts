/** Browser-safe contract + presentation helpers for GET /v1/admin/contacts/:id/workflow. No I/O. */

export class ContactWorkflowShapeError extends Error {
  constructor(public reason: string) { super(`contact_workflow_malformed:${reason}`); }
}

export type WorkflowMessage = { id: string; conversation_id: string | null; direction: "inbound" | "outbound" | "system"; text: string; occurred_at: string | null; delivery_state: string | null };
export type WorkflowConsent = { channel: string | null; status: string | null; wording_version: string | null; evidence: Record<string, any>; source_system: string | null; recorded_at: string | null };
export type WorkflowFact = { field_key: string; value_text: string | null; evidence_quote: string | null; observed_at: string | null };
export type WorkflowMemory = { memory_key: string; memory_value: unknown; source_updated_at: string | null };
export type WorkflowAudit = { record_kind: string | null; summary: string | null; intent: string | null; next_question: string | null; customer_consent: string | null; mode: string | null; source_updated_at: string | null };
export type WorkflowHandoff = { id: string; state: string | null; reason: string | null; manager_summary: string | null; created_at: string | null };
export type WorkflowTask = { id: string; title: string | null; description: string | null; status: string | null; priority: string | null; created_at: string | null };
export type ContactWorkflow = {
  contact_id: string;
  customer_consent: "unknown" | "asked" | "granted" | "declined";
  intake: { state: string | null; completed: string[]; missing: string[]; completion_score: number };
  consents: WorkflowConsent[]; messages: WorkflowMessage[]; next_cursor: string | null;
  memories: WorkflowMemory[]; facts: WorkflowFact[]; audits: WorkflowAudit[]; handoffs: WorkflowHandoff[]; tasks: WorkflowTask[];
};

const o = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as any) : {});
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);
const arr = (w: any, k: string): any[] => {
  if (w[k] === undefined || w[k] === null) return [];
  if (!Array.isArray(w[k])) throw new ContactWorkflowShapeError(`${k}_not_array`);
  return w[k];
};
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

export function parseContactWorkflow(body: unknown, expectedId: string): ContactWorkflow {
  const b = o(body);
  if (b.ok !== true || !b.workflow || typeof b.workflow !== "object") throw new ContactWorkflowShapeError("missing_workflow");
  const w = o(b.workflow);
  if (w.contact_id !== expectedId) throw new ContactWorkflowShapeError("contact_mismatch");
  const cc = ["unknown", "asked", "granted", "declined"].includes(w.customer_consent) ? w.customer_consent : "unknown";
  const intake = o(w.intake);
  const messages = arr(w, "messages").map((m) => {
    const r = o(m);
    if (!s(r.id) || !["inbound", "outbound", "system"].includes(r.direction)) throw new ContactWorkflowShapeError("bad_message");
    return { id: String(r.id), conversation_id: s(r.conversation_id), direction: r.direction, text: typeof o(r.content).text === "string" ? o(r.content).text : "", occurred_at: s(r.occurred_at), delivery_state: s(r.delivery_state) } as WorkflowMessage;
  });
  return {
    contact_id: expectedId, customer_consent: cc,
    intake: { state: s(intake.state), completed: strs(intake.completed), missing: strs(intake.missing), completion_score: Number.isFinite(Number(intake.completion_score)) ? Number(intake.completion_score) : 0 },
    consents: arr(w, "consents").map((c) => { const r = o(c); return { channel: s(r.channel), status: s(r.status), wording_version: s(r.wording_version), evidence: o(r.evidence), source_system: s(r.source_system), recorded_at: s(r.recorded_at) }; }),
    messages, next_cursor: s(w.next_cursor),
    memories: arr(w, "memories").map((m) => { const r = o(m); return { memory_key: s(r.memory_key) ?? "", memory_value: r.memory_value, source_updated_at: s(r.source_updated_at) }; }),
    facts: arr(w, "facts").map((f) => { const r = o(f); return { field_key: s(r.field_key) ?? "", value_text: s(r.value_text), evidence_quote: s(o(r.payload).evidence_quote), observed_at: s(r.observed_at) }; }),
    audits: arr(w, "audits").map((a) => { const r = o(a); const p = o(r.payload); return { record_kind: s(r.record_kind), summary: s(p.summary), intent: s(p.intent), next_question: s(p.next_question), customer_consent: s(p.customer_consent), mode: s(p.mode), source_updated_at: s(r.source_updated_at) }; }),
    handoffs: arr(w, "handoffs").map((h) => { const r = o(h); return { id: String(r.id ?? ""), state: s(r.state), reason: s(r.reason), manager_summary: s(r.manager_summary), created_at: s(r.created_at) }; }),
    tasks: arr(w, "tasks").map((t) => { const r = o(t); return { id: String(r.id ?? ""), title: s(r.title), description: s(r.description), status: s(r.status), priority: s(r.priority), created_at: s(r.created_at) }; }),
  };
}

/** Merge an earlier page in front of loaded messages: chronological, deduped by id. */
export function mergeOlderMessages(older: WorkflowMessage[], current: WorkflowMessage[]): WorkflowMessage[] {
  const seen = new Set<string>(); const out: WorkflowMessage[] = [];
  for (const m of [...older, ...current]) if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
  return out;
}

export type ConsentView = { label: string; fromCustomer: boolean; customerAnswer: "yes" | "no" | "other" | null; note: string; customerText: string | null; askWording: string | null; respondedAt: string | null; askedAt: string | null };

const CONSENT_STATUS: Record<string, string> = { granted: "אישר/ה", declined: "סירב/ה", asked: "נשאל/ה, ממתין לתשובה", unknown: "לא ידוע", opted_out: "הסיר/ה הסכמה", revoked: "בוטלה" };
export const consentStatusLabel = (v: string | null | undefined) => CONSENT_STATUS[v ?? "unknown"] ?? "לא ידוע";

const YES = new Set(["yes", "כן", "approve", "approved", "accept", "accepted"]);
const NO = new Set(["no", "לא", "stop", "decline", "declined", "opt_out", "unsubscribe"]);

/**
 * A confirmed customer "yes" requires full linked evidence: linked=true, the ask wording and
 * sent time, answer=yes and a provider message id. Declines/stops stay visible but never read as yes.
 */
export function consentView(c: WorkflowConsent): ConsentView {
  const ev = o(c.evidence); const resp = o(ev.response); const ask = o(ev.ask);
  const answer = (s(resp.answer) ?? "").toLowerCase();
  const customerAnswer = !answer ? null : YES.has(answer) ? "yes" : NO.has(answer) ? "no" : "other";
  const fromCustomer = ev.linked === true && !!s(ask.wording) && !!s(ask.sent_at) && customerAnswer === "yes" && !!s(resp.provider_message_id);
  const hasResponse = !!(s(resp.provider_message_id) || s(resp.text) || answer);
  const note = fromCustomer ? "אישור מאומת מהלקוח"
    : customerAnswer === "no" ? "הלקוח סירב או ביקש להפסיק"
    : hasResponse ? "תשובה ללא אישור מאומת — אינה אישור מהלקוח"
    : c.status === "granted" || c.status === "declined" ? "רישום ידני/מפעיל — אינו אישור מהלקוח"
    : "אין תשובה מתועדת מהלקוח";
  return { label: consentStatusLabel(c.status), fromCustomer, customerAnswer, note, customerText: s(resp.text) ?? s(resp.answer), askWording: s(ask.wording), respondedAt: s(resp.responded_at), askedAt: s(ask.sent_at) ?? s(ask.asked_at) };
}

const FIELD_LABELS: Record<string, string> = {
  first_name: "שם פרטי", last_name: "שם משפחה", full_name: "שם מלא", phone: "טלפון", email: "אימייל", city: "עיר", region: "אזור",
  age: "גיל", age_range: "טווח גיל", gender: "מגדר", relationship_status: "סטטוס משפחתי", interests: "תחומי עניין",
  budget: "תקציב", preferred_dates: "תאריכים מועדפים", accessibility: "נגישות", occupation: "עיסוק", children: "ילדים",
  social_or_relationship_goal: "מטרה חברתית או זוגית", preferred_activity_type: "סוג פעילות מועדף", city_or_region: "עיר או אזור",
  age_or_birth_date: "גיל או תאריך לידה", source_attribution: "מקור הגעה", budget_sensitivity_or_range: "תקציב או רגישות למחיר",
  language_style_preference: "סגנון שפה מועדף", conversation_summary: "סיכום שיחה",
  marketing_consent: "הסכמה לדיוור", whatsapp_consent: "הסכמה ל-WhatsApp",
};
export const fieldLabel = (k: string) => FIELD_LABELS[k] ?? k.replace(/[_.]+/g, " ").trim();

const STATE_LABELS: Record<string, string> = {
  not_started: "לא התחיל", in_progress: "בתהליך", completed: "הושלם", paused: "מושהה", open: "פתוח", resolved: "טופל", closed: "סגור",
  pending: "ממתין", done: "בוצע", cancelled: "בוטל", delivered: "נמסרה", read: "נקראה", sent: "נשלחה", failed: "נכשלה", queued: "בתור",
  awaiting_consent: "ממתין להסכמה", active: "פעיל", handoff: "הועבר למנהל", claimed: "נלקח לטיפול", accepted: "התקבל",
  human_request: "בקשה לנציג", pricing: "שאלת מחיר", travel: "נסיעות וטיולים", event_info: "מידע על אירוע", registration: "הרשמה",
  payment: "תשלום", complaint: "תלונה", greeting: "פתיחה", consent: "הסכמה", opt_out: "הסרה", intake: "אינטייק", info: "בקשת מידע",
  recommendation: "המלצה", general: "כללי", smalltalk: "שיחה כללית", other: "אחר",
  high: "גבוהה", medium: "בינונית", normal: "רגילה", low: "נמוכה", urgent: "דחוף",
};
export const stateLabel = (v: string | null | undefined) => (v ? STATE_LABELS[v] ?? v.replace(/_/g, " ") : "—");

/** Readable text for a memory value without dumping JSON. */
export function memoryText(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v === true ? "כן" : v === false ? "לא" : String(v);
  if (Array.isArray(v)) return v.map(memoryText).join(", ");
  return Object.entries(o(v)).filter(([, x]) => x != null && x !== "").map(([k, x]) => `${fieldLabel(k)}: ${memoryText(x)}`).join(" · ") || "—";
}
