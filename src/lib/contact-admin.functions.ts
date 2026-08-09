/**
 * ADMIN CONTACT OPERATIONS — server functions for "Tamar reset" and the
 * clean, transactional contact deletion. All real work runs inside a single
 * Postgres SECURITY DEFINER function so the whole operation is atomic and
 * rolls back completely on any failure. No WhatsApp is ever sent from here.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { UUID_RE, validateDeleteInput, validateResetInput } from "@/lib/contact-admin/core";

async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error("authorization_check_failed");
  if (data !== true) throw new Error("forbidden");
}

/** Dry-run dependency preview for the delete modal (counts only, no payloads). */
export const previewContactDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contactId: string }) => {
    const contactId = String(input?.contactId ?? "").trim();
    if (!UUID_RE.test(contactId)) throw new Error("invalid_contact_id");
    return { contactId };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("admin_contact_delete_preview" as any, {
      p_contact_id: data.contactId,
      p_actor: context.userId,
    } as any);
    if (error) throw new Error(error.message);
    return res as any;
  });

/** Safe, idempotent "Tamar reset". Consent / opt-out are never changed. */
export const resetTamarForContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contactId: string; reason: string; resetIntake?: boolean }) =>
    validateResetInput(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("admin_reset_tamar" as any, {
      p_contact_id: data.contactId,
      p_reason: data.reason,
      p_reset_intake: data.resetIntake,
      p_actor: context.userId,
      p_correlation: crypto.randomUUID(),
    } as any);
    if (error) throw new Error(error.message);
    return res as any;
  });

/** Full transactional deletion. Identity registry + raw vault are preserved. */
export const deleteContactAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contactId: string; reason: string; confirmation: string }) =>
    validateDeleteInput(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("admin_delete_contact" as any, {
      p_contact_id: data.contactId,
      p_reason: data.reason,
      p_actor: context.userId,
      p_correlation: crypto.randomUUID(),
    } as any);
    if (error) throw new Error(error.message);
    return res as any;
  });