/** Browser-safe contracts for Core individual template campaigns. No I/O, no sending. */

export class TemplateCampaignShapeError extends Error {
  constructor(public reason: string) { super(`template_campaign_malformed:${reason}`); }
}
const o = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as any) : {});
const s = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export type CoreTemplate = { id: string; name: string; status: string; language: string; category: string | null; body: string };
export type TemplateList = { templates: CoreTemplate[]; gift_ready: boolean };
export type TemplateCampaign = {
  id: string; name: string; template_name: string; language: string; status: string;
  recipient_count: number; sent_count: number; failed_count: number; pending_count: number; created_at: string | null;
};
export type CampaignRecipient = {
  phone: string; display_name: string | null; response_state: string | null; delivery_state: string | null;
  failure_code: string | null; provider_message_id: string | null; sent_at: string | null;
};
export type CampaignDraftInput = { name: string; template_name: string; idempotency_key: string; permission_confirmed: boolean; consent_basis: string; recipients: { phone: string; name: string }[] };

export const GIFT_TEMPLATE = "zooga_dna_gift";
export const MAX_RECIPIENTS = 500;

export function parseTemplates(body: unknown): TemplateList {
  const b = o(body);
  if (b.ok !== true || !Array.isArray(b.templates)) throw new TemplateCampaignShapeError("templates");
  const templates = b.templates.map((t: any) => {
    const r = o(t);
    if (!s(r.name)) throw new TemplateCampaignShapeError("template_name");
    const bodyComp = (Array.isArray(r.components) ? r.components : []).find((c: any) => String(o(c).type).toUpperCase() === "BODY");
    return { id: String(r.id ?? r.name), name: r.name, status: String(r.status ?? ""), language: String(r.language ?? ""), category: s(r.category), body: String(o(bodyComp).text ?? "") };
  }).filter((t: CoreTemplate) => t.status === "APPROVED");
  return { templates, gift_ready: b.gift_ready === true };
}

export function parseCampaign(raw: unknown): TemplateCampaign {
  const r = o(raw);
  if (!s(r.id) || !s(r.status)) throw new TemplateCampaignShapeError("campaign");
  return { id: r.id, name: String(r.name ?? ""), template_name: String(r.template_name ?? ""), language: String(r.language ?? "he"), status: r.status,
    recipient_count: n(r.recipient_count), sent_count: n(r.sent_count), failed_count: n(r.failed_count), pending_count: n(r.pending_count), created_at: s(r.created_at) };
}
export function parseCampaignList(body: unknown): TemplateCampaign[] {
  const b = o(body);
  if (b.ok !== true || !Array.isArray(b.campaigns)) throw new TemplateCampaignShapeError("campaigns");
  return b.campaigns.map(parseCampaign);
}
export function parseCampaignDetail(body: unknown, expectedId: string): { campaign: TemplateCampaign; recipients: CampaignRecipient[] } {
  const b = o(body);
  if (b.ok !== true || !Array.isArray(b.recipients)) throw new TemplateCampaignShapeError("detail");
  const campaign = parseCampaign(b.campaign);
  if (campaign.id !== expectedId) throw new TemplateCampaignShapeError("campaign_mismatch");
  return { campaign, recipients: b.recipients.map((x: any) => { const r = o(x); return { phone: String(r.phone ?? ""), display_name: s(r.display_name), response_state: s(r.response_state), delivery_state: s(r.delivery_state), failure_code: s(r.failure_code), provider_message_id: s(r.provider_message_id), sent_at: s(r.sent_at) }; }) };
}

/** Israeli mobile in canonical 9725XXXXXXXX form (from 05…, +972…, 972…). */
export function normalizeIlMobile(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("0")) d = "972" + d.slice(1);
  else if (d.length === 9 && d.startsWith("5")) d = "972" + d;
  return /^9725\d{8}$/.test(d) ? d : null;
}

export function buildRecipients(entries: { phone: string; name?: string | null }[]): { recipients: { phone: string; name: string }[]; invalid: number; duplicates: number } {
  const seen = new Set<string>(); const recipients: { phone: string; name: string }[] = []; let invalid = 0, duplicates = 0;
  for (const e of entries) {
    const p = normalizeIlMobile(e.phone);
    if (!p) { invalid++; continue; }
    if (seen.has(p)) { duplicates++; continue; }
    seen.add(p); recipients.push({ phone: p, name: String(e.name ?? "").trim().slice(0, 80) });
  }
  return { recipients, invalid, duplicates };
}

export function draftBlockers(i: Omit<CampaignDraftInput, "idempotency_key">): string[] {
  const b: string[] = [];
  if (!i.name.trim()) b.push("יש לתת שם לקמפיין");
  if (!i.template_name) b.push("יש לבחור תבנית מאושרת");
  if (!i.recipients.length) b.push("יש לבחור לפחות נמען אחד");
  if (i.recipients.length > MAX_RECIPIENTS) b.push(`מקסימום ${MAX_RECIPIENTS} נמענים`);
  if (i.recipients.some(r => !normalizeIlMobile(r.phone))) b.push("יש נמען עם מספר לא תקין");
  const unnamed = i.recipients.filter(r => !r.name.trim()).length;
  if (unnamed) b.push(`${unnamed} נמענים ללא שם — מלאו "שם ברירת מחדל", או הוסיפו שם בשורה (טלפון, שם), בקובץ או בכרטיס איש הקשר`);
  if (!i.permission_confirmed) b.push("יש לאשר שקיים בסיס הרשאה לפנייה");
  const len = i.consent_basis.trim().length;
  if (len < 10 || len > 1000) b.push("יש לתאר את מקור ההרשאה (10–1000 תווים)");
  return b;
}

export function buildDraftBody(i: CampaignDraftInput) {
  if (draftBlockers(i).length) throw new TemplateCampaignShapeError("invalid_draft");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(i.idempotency_key)) throw new TemplateCampaignShapeError("idempotency_key");
  return { name: i.name.trim(), template_name: i.template_name, language: "he" as const, idempotency_key: i.idempotency_key,
    permission_confirmed: true as const, consent_basis: i.consent_basis.trim(), recipients: i.recipients.map(r => ({ phone: r.phone, name: r.name })) };
}

/** Preview: {{1}} becomes the recipient name (or an example name); other variables stay visible. */
export function renderTemplatePreview(body: string, name: string): string {
  const v = name.trim() || "דנה";
  return body.replace(/\{\{\s*1\s*\}\}/g, () => v);
}

export const giftLaunchBlocked = (templateName: string, giftReady: boolean) => templateName === GIFT_TEMPLATE && !giftReady;
export const canLaunch = (c: TemplateCampaign, giftReady: boolean) => c.status === "draft" && !giftLaunchBlocked(c.template_name, giftReady);
/** Poll only while Core still has unsent recipients. */
export const isPending = (c: TemplateCampaign) => c.status === "queued" && c.pending_count > 0;
export const unnamedCount = (rs: { name: string }[]) => rs.filter(r => !r.name.trim()).length;

const DELIVERY: Record<string, string> = {
  pending: "ממתין", queued: "בתור", accepted: "התקבל אצל ספק (טרם נמסר)", sent: "נשלח לספק", delivered: "נמסר", read: "נקרא",
  failed: "נכשל", suppressed: "הושמט (הסרה/טיפול אנושי/שיחה סגורה)", blocked: "נחסם", cancelled: "בוטל", skipped: "דולג",
};
export const deliveryLabel = (v: string | null) => (v ? DELIVERY[v] ?? v : "—");
const RESPONSE: Record<string, string> = {
  none: "לא הגיב", replied: "הגיב", accepted: "השיב בחיוב לפנייה", deferred: "ביקש לדחות למועד אחר", declined: "סירב",
  suppressed_optout: "לא נשלח — הלקוח ביקש הסרה בעבר", suppressed_human_or_closed: "לא נשלח — השיחה בטיפול אנושי או סגורה",
};
export const responseLabel = (v: string | null) => (v ? RESPONSE[v] ?? v : "—");
const STATUS: Record<string, string> = { draft: "טיוטה", queued: "בשליחה", cancelled: "בוטל", completed: "הושלם" };
export const campaignStatusLabel = (v: string) => STATUS[v] ?? v;

export const CAMPAIGN_ERROR_TEXT: Record<string, string> = {
  invalid_campaign: "נתוני הקמפיין אינם תקינים",
  campaign_permission_required: "חובה לאשר ולתאר את בסיס ההרשאה לפנייה",
  invalid_recipient_count: `מספר הנמענים חייב להיות בין 1 ל-${MAX_RECIPIENTS}`,
  invalid_recipient: "אחד הנמענים אינו תקין — מספר נייד ישראלי ושם חובה לכל נמען",
  template_changed_recreate: "התבנית השתנתה — צרו טיוטה חדשה לאחר בדיקת הנוסח",
  template_not_approved: "התבנית אינה מאושרת ב-Meta כרגע",
  campaign_not_found: "הקמפיין לא נמצא",
  campaign_not_draft: "הקמפיין כבר שוגר או בוטל",
  gift_fulfillment_unconfigured: "שליחת תבנית המתנה חסומה עד שיוגדרו מנפיק וקישור אמיתיים למתנה",
};
