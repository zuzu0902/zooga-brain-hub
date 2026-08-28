/**
 * PILOT ELIGIBILITY (PURE).
 *
 * A contact becomes eligible for Tamar's FIRST individual outreach only when
 * Alex explicitly imports it through an approved pilot file. File inclusion is
 * the operational eligibility signal — it is NEVER marketing consent and never
 * authorizes group broadcast. Inbound contacts that write to Tamar first are
 * eligible without a file (they initiated the conversation).
 */
import { normalizePhone } from "@/lib/phone";

export type PilotImportRow = {
  full_name?: string | null;
  phone?: string | null;
  notes?: string | null;
};

export type PilotExistingContact = {
  id: string;
  phone: string | null;
  opted_out_at?: string | null;
  pilot_eligible_at?: string | null;
  pilot_opener_sent_at?: string | null;
};

export type PilotRowClassification =
  | "eligible"
  | "duplicate_in_file"
  | "already_in_pilot"
  | "opted_out"
  | "invalid_phone";

export type PilotClassifiedRow = {
  index: number;
  full_name: string | null;
  raw_phone: string;
  phone: string | null;
  contact_id: string | null;
  classification: PilotRowClassification;
  reason_he: string;
};

const REASONS: Record<PilotRowClassification, string> = {
  eligible: "מוכן לפנייה ראשונה",
  duplicate_in_file: "כפול בתוך הקובץ",
  already_in_pilot: "כבר משויך לפיילוט",
  opted_out: "הלקוח ביקש להפסיק קבלת הודעות",
  invalid_phone: "מספר טלפון לא תקין",
};

export function classifyPilotRows(args: {
  rows: PilotImportRow[];
  existing: PilotExistingContact[];
}): PilotClassifiedRow[] {
  const byPhone = new Map<string, PilotExistingContact>();
  for (const c of args.existing) {
    const p = normalizePhone(c.phone);
    if (p) byPhone.set(p, c);
  }
  const seen = new Set<string>();
  return args.rows.map((row, index) => {
    const raw = String(row?.phone ?? "").trim();
    const phone = normalizePhone(raw);
    const name = String(row?.full_name ?? "").trim() || null;
    const base = { index, full_name: name, raw_phone: raw, phone, contact_id: null as string | null };
    if (!phone) return { ...base, classification: "invalid_phone", reason_he: REASONS.invalid_phone };
    if (seen.has(phone)) {
      return { ...base, classification: "duplicate_in_file", reason_he: REASONS.duplicate_in_file };
    }
    seen.add(phone);
    const existing = byPhone.get(phone) ?? null;
    const contact_id = existing?.id ?? null;
    if (existing?.opted_out_at) {
      return { ...base, contact_id, classification: "opted_out", reason_he: REASONS.opted_out };
    }
    if (existing?.pilot_eligible_at || existing?.pilot_opener_sent_at) {
      return { ...base, contact_id, classification: "already_in_pilot", reason_he: REASONS.already_in_pilot };
    }
    return { ...base, contact_id, classification: "eligible", reason_he: REASONS.eligible };
  });
}

export type PilotImportCounts = Record<PilotRowClassification, number> & { total: number };

export function pilotImportCounts(rows: PilotClassifiedRow[]): PilotImportCounts {
  const counts: PilotImportCounts = {
    total: rows.length,
    eligible: 0,
    duplicate_in_file: 0,
    already_in_pilot: 0,
    opted_out: 0,
    invalid_phone: 0,
  };
  for (const r of rows) counts[r.classification] += 1;
  return counts;
}

/**
 * The contact patch a pilot import may write. Deliberately contains NO consent
 * field: importing a file marks eligibility for the consent request, not
 * consent itself, and never touches source/status of an existing contact.
 */
export function pilotContactPatch(args: { batchId: string; fileName: string; at: string }) {
  return {
    pilot_batch_id: args.batchId,
    pilot_file_name: args.fileName,
    pilot_eligible_at: args.at,
  };
}

/** A contact may receive Tamar's first individual outreach. */
export function isPilotOutreachEligible(contact: {
  pilot_eligible_at?: string | null;
  opted_out_at?: string | null;
  human_owned?: boolean | null;
  last_inbound_at?: string | null;
}): { eligible: boolean; reason: string; reason_he: string } {
  if (contact.opted_out_at) return { eligible: false, reason: "opted_out", reason_he: REASONS.opted_out };
  if (contact.human_owned) return { eligible: false, reason: "human_owned", reason_he: "השיחה בטיפול אנושי" };
  if (contact.pilot_eligible_at) return { eligible: true, reason: "pilot_file", reason_he: REASONS.eligible };
  if (contact.last_inbound_at) return { eligible: true, reason: "inbound_initiated", reason_he: "הלקוח פנה ראשון" };
  return { eligible: false, reason: "not_in_pilot_file", reason_he: "לא נכלל בקובץ פיילוט מאושר" };
}
