import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateReleaseInput } from "@/lib/handoff-release-core";

const UUID = /^[0-9a-f-]{36}$/i;

/** Presence-only health of the manager alert channel (no numbers, no secrets). */
export const getHandoffChannelHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { handoffChannelHealth } = await import("@/lib/tamar-handoff-core.server");
    return handoffChannelHealth();
  });

/** Manual, safe retry of a single manager alert from the console. */
export const retryHandoffAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { handoffId: string }) => {
    const id = String(input?.handoffId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid_handoff_id");
    return { handoffId: id };
  })
  .handler(async ({ data }) => {
    const { notifyManagerForHandoff } = await import("@/lib/tamar-handoff-core.server");
    return notifyManagerForHandoff(data.handoffId);
  });

/**
 * Resolve one handoff and, when nothing else holds the thread, automatically
 * give the conversation back to Tamar (no more permanent `human_owned`).
 */
export const resolveHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { handoffId: string; releaseToTamar?: boolean }) => {
    const id = String(input?.handoffId ?? "").trim();
    if (!UUID.test(id)) throw new Error("invalid_handoff_id");
    return { handoffId: id, releaseToTamar: input?.releaseToTamar !== false };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { releaseIfUnheld } = await import("@/lib/tamar-handoff-core.server");
    const nowIso = new Date().toISOString();
    const { data: row } = await supabaseAdmin
      .from("manager_handoffs" as any)
      .update({ status: "resolved", resolved_at: nowIso } as any)
      .eq("id", data.handoffId)
      .select("id, contact_id")
      .maybeSingle();
    const contactId = (row as any)?.contact_id ?? null;
    if (!contactId || !data.releaseToTamar) {
      return { ok: true, released: false, reason: contactId ? "release_skipped" : "no_contact" };
    }
    // Auto-release only when nothing else holds the thread (other open
    // handoff, or an explicit manual human lock). Idempotent on retry.
    const res = await releaseIfUnheld({
      contactId,
      actor: context.userId,
      trigger: "handoff_resolved",
    });
    return { ok: true, ...res };
  });

/** Read-only lock state for the UI banner ("who holds this thread and since when"). */
export const getContactLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contactId: string }) => {
    const id = String(input?.contactId ?? "").trim();
    if (!UUID.test(id)) throw new Error("invalid_contact_id");
    return { contactId: id };
  })
  .handler(async ({ data }) => {
    const { getLockSnapshot } = await import("@/lib/tamar-handoff-core.server");
    return getLockSnapshot(data.contactId);
  });

/**
 * Explicit admin action "החזר לתמר": resolves every still-open handoff,
 * forces ownership back to automation and optionally resets the intake.
 * Never deletes transcript, profile facts or consent.
 */
export const releaseContactToTamar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contactId: string; resetIntake?: boolean; reason?: string }) => {
    return validateReleaseInput(input);
  })
  .handler(async ({ data, context }) => {
    const { performContactRelease } = await import("@/lib/handoff-release-admin.server");
    return performContactRelease({
      request: data,
      actorId: context.userId,
      isAdmin: async () => {
        const { data: ok } = await context.supabase.rpc("has_role" as any, {
          _user_id: context.userId,
          _role: "admin",
        } as any);
        return ok === true;
      },
    });
  });
