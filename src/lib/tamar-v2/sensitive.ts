/**
 * TAMAR BRAIN V2 — sensitive accessibility / medical handling (PURE).
 *
 * Wheelchair access, mobility limits, medical needs and special assistance are
 * high-stakes operational questions. Tamar may answer ONLY from grounded,
 * current source data for the exact offer. Otherwise the turn is terminal:
 * acknowledge, promise verification, open a human follow-up. Never promise
 * suitability, never infer it, never append offers afterwards.
 */

const ACCESSIBILITY_RE =
  /(כיסא\s*גלגלים|כסא\s*גלגלים|נגיש(ות|ה)?|מוגבל(ות|ים)?\s+בתנועה|קושי\s+בהליכה|בעיות?\s+הליכה|הליכון|קביים|מוגבלות|נכה|נכות|wheelchair|accessib)/i;

const MEDICAL_RE =
  /(רפואי|תרופות|דיאליזה|חמצן|אלרגי|סוכרת|לב|ניתוח|מחלה|מטפל(ת)?\s+צמוד|סיעוד|תזונה\s+מיוחדת|כשר\s+למהדרין|medical)/i;

export type SensitiveTopic = "accessibility" | "medical";

export function detectSensitiveTopic(message: string | null | undefined): SensitiveTopic | null {
  const raw = String(message ?? "");
  if (!raw.trim()) return null;
  if (ACCESSIBILITY_RE.test(raw)) return "accessibility";
  if (MEDICAL_RE.test(raw)) return "medical";
  return null;
}

/** Durable fact key for an explicitly stated accessibility need. */
export const SENSITIVE_FACT_KEY = "accessibility_need";

/**
 * Does the offer carry grounded, explicit evidence about accessibility /
 * medical suitability? Only structured, sourced fields count.
 */
export function hasGroundedSensitiveData(
  offer: Record<string, any> | null | undefined,
  topic: SensitiveTopic,
): boolean {
  if (!offer) return false;
  const re = topic === "accessibility" ? ACCESSIBILITY_RE : MEDICAL_RE;
  const parts: string[] = [];
  const facts = offer["grounded_facts"];
  if (facts && typeof facts === "object") {
    for (const [k, v] of Object.entries(facts as Record<string, any>)) parts.push(`${k} ${String(v ?? "")}`);
  }
  const faq = offer["faq_bundle"];
  if (Array.isArray(faq)) {
    for (const item of faq) parts.push(`${item?.q ?? item?.question ?? ""} ${item?.a ?? item?.answer ?? ""}`);
  }
  for (const key of ["included", "not_included", "requirements", "accessibility_notes"]) {
    const v = offer[key];
    if (Array.isArray(v)) parts.push(v.join(" "));
    else if (typeof v === "string") parts.push(v);
  }
  return parts.some((p) => re.test(p));
}

/** Terminal, honest reply when there is no grounded data for the exact offer. */
export function sensitiveVerificationText(offerTitle: string | null, topic: SensitiveTopic): string {
  const subject = offerTitle ? `"${offerTitle}"` : "הטיול הזה";
  const what = topic === "accessibility" ? "הנגישות" : "ההתאמה הרפואית";
  return [
    `תודה ששיתפת אותי, זה חשוב ואני רוצה לתת לך תשובה מדויקת ולא ניחוש.`,
    `${what} של ${subject} תלויה במסלול ובספקים בפועל, ואין לי כרגע מידע מאומת על זה.`,
    `העברתי את השאלה לאיש צוות של זוגה שיבדוק מול המסלול המדויק ויחזור אליך עם תשובה ברורה.`,
  ].join(" ");
}

/** Title of the human follow-up task. */
export function sensitiveTaskTitle(topic: SensitiveTopic, offerTitle: string | null): string {
  const what = topic === "accessibility" ? "בדיקת נגישות" : "בדיקת התאמה רפואית";
  return offerTitle ? `${what} — ${offerTitle}` : what;
}
