/**
 * TAMAR LITE — pure consent resolution for the shadow processor.
 * Single source of truth: `verifiedWhatsAppConsent`, plus a legacy-tolerant
 * fallback. Opt-out always wins. No IO, no mutation.
 */
import { verifiedWhatsAppConsent, type ConsentContact } from "@/lib/whatsapp-optin/consent-resolver";

export const LITE_CONTACT_COLUMNS = [
  "consent_status",
  "consent_marketing",
  "consent_source",
  "consent_date",
  "opted_out_at",
  "whatsapp_opt_in_status",
  "whatsapp_opt_in_at",
  "whatsapp_opt_in_source",
  "whatsapp_opt_in_evidence",
  "human_owned",
  "residence_city",
  "region",
  "interests",
  "last_presented_offers",
].join(",");

export type LiteConsentContact = ConsentContact & { consent_status?: string | null };

export function isOptedOut(contact: LiteConsentContact | null | undefined): boolean {
  if (!contact) return false;
  return !!contact.opted_out_at || contact.consent_status === "denied";
}

export function resolveLiteConsent(contact: LiteConsentContact | null | undefined): boolean {
  if (!contact) return false;
  if (isOptedOut(contact)) return false;
  if (verifiedWhatsAppConsent({ contact }).verified) return true;
  // legacy CRM records without a complete normalized trail
  return contact.consent_status === "granted" || contact.consent_marketing === true;
}
