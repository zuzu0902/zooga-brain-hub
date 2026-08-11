/**
 * RELATIONSHIP AI INSIGHTS — admin-only server functions.
 * Never customer facing, never sends WhatsApp.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole } from "@/lib/relationship-insights/authz";

const UUID = /^[0-9a-f-]{36}$/i;

const assertAdmin = assertAdminRole;

function contactInput(input: { contactId: string }) {
  const id = String(input?.contactId ?? "").trim();
  if (!UUID.test(id)) throw new Error("invalid_contact_id");
  return { contactId: id };
}

export const getRelationshipInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(contactInput)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { getCurrentInsights } = await import("@/lib/relationship-insights/insights.server");
    return getCurrentInsights(data.contactId);
  });

export const refreshRelationshipInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(contactInput)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { generateRelationshipInsights, getCurrentInsights } = await import(
      "@/lib/relationship-insights/insights.server"
    );
    const result = await generateRelationshipInsights(data.contactId, { force: true });
    return { result, ...(await getCurrentInsights(data.contactId)) };
  });