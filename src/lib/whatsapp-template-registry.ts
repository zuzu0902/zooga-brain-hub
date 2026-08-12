/**
 * Internal WhatsApp template registry.
 *
 * The Meta API tells us a template is APPROVED, but not *who* attested to it
 * inside Zooga or *when*. The activation gate requires both, so every template
 * we are allowed to send outside the 24h window must appear here with a real
 * approval source and date. Nothing is invented: no Meta template id and no
 * fabricated timestamp — only what the owner attested to.
 */

export type TemplateEvidenceType = "admin_attestation" | "meta_api";

export type TemplateRegistryEntry = {
  name: string;
  language: string;
  status: "APPROVED" | "PENDING" | "REJECTED";
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  /** activation topic this template is allowed to serve */
  purpose: string;
  variable_count: number;
  approved_source: string | null;
  /** ISO date (YYYY-MM-DD) */
  approved_at: string | null;
  evidence_type: TemplateEvidenceType;
};

/** Single source of truth — used identically by preview and by create/send. */
export const WHATSAPP_TEMPLATE_REGISTRY: TemplateRegistryEntry[] = [
  {
    name: "zooga_reengagement_followup",
    language: "he",
    status: "APPROVED",
    category: "MARKETING",
    purpose: "activity_update",
    variable_count: 1,
    approved_source: "owner_confirmed_meta_business_manager",
    approved_at: "2026-08-12",
    evidence_type: "admin_attestation",
  },
];

export function findTemplateRegistryEntry(
  name: string,
  language: string,
): TemplateRegistryEntry | null {
  const lang = language.split("_")[0];
  return (
    WHATSAPP_TEMPLATE_REGISTRY.find(
      (t) => t.name === name && t.language.split("_")[0] === lang,
    ) ?? null
  );
}

export type RegistryCheck = { ok: boolean; missing: string[]; reason_he: string | null };

/**
 * Registry-side approval evidence check. Never softens the Meta gate — it is an
 * additional requirement on top of it.
 */
export function checkTemplateRegistry(
  name: string,
  language: string,
  purpose: string,
): RegistryCheck {
  const entry = findTemplateRegistryEntry(name, language);
  if (!entry)
    return {
      ok: false,
      missing: ["registry_entry"],
      reason_he: `התבנית "${name}" (${language}) אינה רשומה במרשם התבניות הפנימי`,
    };

  const missing: string[] = [];
  if (!entry.approved_source) missing.push("approved_source");
  if (!entry.approved_at || !/^\d{4}-\d{2}-\d{2}$/.test(entry.approved_at))
    missing.push("approved_at");
  if (entry.status !== "APPROVED") missing.push("status");
  if (entry.purpose !== purpose) missing.push("purpose");

  if (missing.length) {
    const he: Record<string, string> = {
      approved_source: "מקור אישור",
      approved_at: "תאריך אישור",
      status: "סטטוס מאושר",
      purpose: "התאמה למטרת השיחה",
    };
    return {
      ok: false,
      missing,
      reason_he: `רישום התבנית "${name}" (${language}) חסר: ${missing
        .map((m) => he[m] ?? m)
        .join(", ")}`,
    };
  }
  return { ok: true, missing: [], reason_he: null };
}
