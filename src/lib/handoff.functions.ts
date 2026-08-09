import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  .inputValidator((input: { contactId: string; resetIntake?: boolean }) => {
    const id = String(input?.contactId ?? "").trim();
    if (!UUID.test(id)) throw new Error("invalid_contact_id");
    return { contactId: id, resetIntake: input?.resetIntake === true };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { releaseIfUnheld } = await import("@/lib/tamar-handoff-core.server");
    const res = await releaseIfUnheld({
      contactId: data.contactId,
      actor: context.userId,
      trigger: "manual_release_to_tamar",
      force: true,
    });
    let reset: any = null;
    if (data.resetIntake && res.released) {
      const { data: rpc } = await supabaseAdmin.rpc("admin_reset_tamar" as any, {
        p_contact_id: data.contactId,
        p_reason: "return_to_tamar_with_intake_reset",
        p_reset_intake: true,
        p_actor: context.userId,
      } as any);
      reset = rpc ?? null;
    }
    await supabaseAdmin.from("zero_loss_audit_log" as any).insert({
      actor_user_id: context.userId,
      actor_label: "admin_console",
      action: "release_contact_to_tamar",
      target_kind: "contact",
      target_id: data.contactId,
      details: { resolved_handoffs: res.resolved_handoffs, reset_intake: data.resetIntake, decision: res.decision },
    } as any);
    return { ...res, reset };
  });