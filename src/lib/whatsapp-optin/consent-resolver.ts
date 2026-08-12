/**
 * Single resolver for "may we open a WhatsApp conversation with this contact".
 *
 * The CRM stores consent in two historical shapes:
 *   1. normalized  : whatsapp_opt_in_status / _source / _at (+ _evidence)
 *   2. legacy CRM  : consent_marketing + consent_source + consent_date
 * and, when neither is complete, an explicit inbound reply to the consent
 * question may be used as evidence — but ONLY an unambiguous yes/no answer to
 * that question. A generic inbound message is never consent.
 *
 * Pure module: no IO, fully testable.
 */

import { classifyConsentReply, normalizeOptInStatus } from "./core";

export type ConsentContact = {
  whatsapp_opt_in_status?: string | null;
  whatsapp_opt_in_at?: string | null;
  whatsapp_opt_in_source?: string | null;
  whatsapp_opt_in_evidence?: string | null;
  consent_marketing?: boolean | null;
  consent_date?: string | null;
  consent_source?: string | null;
  opted_out_at?: string | null;
};

/** An inbound event that is explicitly linked to the consent question. */
export type ConsentEvidence = {
  /** durable id of the stored inbound event (vault / interaction) */
  id: string;
  /** ISO timestamp of the ORIGINAL event — never "now" */
  at: string | null;
  buttonId?: string | null;
  buttonTitle?: string | null;
  text?: string | null;
  /** the reply is stored as an answer to a stored consent question */
  repliesToConsentQuestion: boolean;
  /** the consent question itself is stored too (both events persisted) */
  questionStored: boolean;
  source?: string | null;
};

export type ResolvedConsent = {
  status: "granted" | "denied" | "unknown";
  verified: boolean;
  source: string | null;
  at: string | null;
  evidence_id: string | null;
  /** the normalized columns are empty but the consent is provable */
  needs_backfill: boolean;
  missing: string[];
  reason: string | null;
  reason_he: string | null;
};

/** Sources we accept as a real, auditable origin of consent. */
export const TRUSTED_CONSENT_SOURCES = [
  "whatsapp_button",
  "whatsapp_button_reply",
  "whatsapp_reply",
  "web_form",
  "import_file",
  "phone_call",
  "manual_admin",
  "legacy_consent",
];

const iso = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const trusted = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s && TRUSTED_CONSENT_SOURCES.includes(s) ? s : null;
};

const NO_EVIDENCE_HE =
  "לא נמצאה ראיית הסכמה מפורשת — יש לפתוח הסכמה במסלול הייעודי (zooga_opening_consent), לא בעדכון פעילות";

export function verifiedWhatsAppConsent(input: {
  contact: ConsentContact | null | undefined;
  evidence?: ConsentEvidence | null;
}): ResolvedConsent {
  const c = input.contact;
  const base: ResolvedConsent = {
    status: "unknown",
    verified: false,
    source: null,
    at: null,
    evidence_id: null,
    needs_backfill: false,
    missing: [],
    reason: null,
    reason_he: null,
  };
  if (!c) return { ...base, reason: "contact_not_found", reason_he: "איש הקשר לא נמצא" };

  if (c.opted_out_at)
    return { ...base, status: "denied", reason: "opted_out", reason_he: "הלקוח ביקש להפסיק קבלת הודעות" };
  if (normalizeOptInStatus(c.whatsapp_opt_in_status) === "denied")
    return { ...base, status: "denied", reason: "opt_in_denied", reason_he: "אישור הפנייה בוואטסאפ נדחה" };

  // 1. normalized columns
  if (normalizeOptInStatus(c.whatsapp_opt_in_status) === "verified") {
    const source = String(c.whatsapp_opt_in_source ?? "").trim() || null;
    const at = iso(c.whatsapp_opt_in_at);
    if (source && at)
      return { ...base, status: "granted", verified: true, source, at, evidence_id: c.whatsapp_opt_in_evidence ?? null };
  }

  // 2. legacy CRM consent record
  const legacySource = trusted(c.consent_source);
  const legacyAt = iso(c.consent_date);
  if (c.consent_marketing && legacySource && legacyAt) {
    return {
      ...base,
      status: "granted",
      verified: true,
      source: legacySource,
      at: legacyAt,
      needs_backfill: normalizeOptInStatus(c.whatsapp_opt_in_status) !== "verified",
    };
  }

  // 3. explicit reply to the stored consent question
  const e = input.evidence;
  if (e && e.repliesToConsentQuestion && e.questionStored) {
    const answer = classifyConsentReply({ buttonId: e.buttonId, buttonTitle: e.buttonTitle, text: e.text });
    const at = iso(e.at);
    if (answer === "no")
      return { ...base, status: "denied", evidence_id: e.id, reason: "opt_in_denied", reason_he: "הלקוח השיב שלא" };
    if (answer === "yes" && at && e.id) {
      return {
        ...base,
        status: "granted",
        verified: true,
        source: trusted(e.source) ?? "whatsapp_button_reply",
        at,
        evidence_id: e.id,
        needs_backfill: true,
      };
    }
  }

  // nothing provable — report exactly what is missing
  const missing: string[] = [];
  const partial =
    normalizeOptInStatus(c.whatsapp_opt_in_status) === "verified" || !!c.consent_marketing;
  if (partial) {
    if (!(String(c.whatsapp_opt_in_source ?? "").trim() || legacySource)) missing.push("מקור הסכמה");
    if (!(iso(c.whatsapp_opt_in_at) || legacyAt)) missing.push("מועד הסכמה");
    if (!missing.length) missing.push("סטטוס הסכמה מפורש");
    return {
      ...base,
      missing,
      reason: "consent_incomplete",
      reason_he: `רישום ההסכמה חסר: ${missing.join(", ")}`,
    };
  }
  return {
    ...base,
    missing: ["סטטוס הסכמה מפורש", "מקור הסכמה", "מועד הסכמה"],
    reason: "consent_evidence_missing",
    reason_he: NO_EVIDENCE_HE,
  };
}
