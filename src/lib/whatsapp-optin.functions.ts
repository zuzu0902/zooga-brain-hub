import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const setContactWhatsAppOptIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        contact_id: z.string().uuid(),
        status: z.enum(["unknown", "verified", "denied"]),
        source: z.string().trim().max(120).optional().nullable(),
        evidence: z.string().trim().max(300).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { setWhatsAppOptIn } = await import("@/lib/whatsapp-optin/optin.server");
    return setWhatsAppOptIn({
      contactId: data.contact_id,
      status: data.status,
      source: data.source ?? null,
      evidence: data.evidence ?? null,
    });
  });

/** Send the approved consent-opening template once. dry_run sends nothing. */
export const sendConsentOpeningToContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ contact_id: z.string().uuid(), dry_run: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { sendConsentOpening } = await import("@/lib/whatsapp-optin/optin.server");
    return sendConsentOpening(data.contact_id, { dryRun: !!data.dry_run });
  });