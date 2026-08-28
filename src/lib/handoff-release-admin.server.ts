/**
 * Admin "return to Tamar": the accountable release of a human-owned thread.
 *
 * Kept out of the server-function file so authorization, audit and
 * idempotency are directly testable. Never releases automatically — every
 * call is an explicit, confirmed admin action.
 */
import { type ReleaseRequest } from "@/lib/handoff-release-core";

export { validateReleaseInput, type ReleaseRequest } from "@/lib/handoff-release-core";

export async function performContactRelease(args: {
  request: ReleaseRequest;
  actorId: string;
  /** must resolve true only for an authenticated admin */
  isAdmin: () => Promise<boolean>;
}) {
  if (!(await args.isAdmin())) throw new Error("forbidden");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getLockSnapshot, releaseIfUnheld } = await import("@/lib/tamar-handoff-core.server");
  const { contactId, resetIntake, reason } = args.request;

  const before = await getLockSnapshot(contactId);

  // No automatic release: while a handoff is still open the manager MUST
  // record that contact occurred, the outcome and a summary. Tamar resumes
  // from the full conversation plus that summary.
  let outcome: import("@/lib/tamar-pilot/manager-outcome").ManagerOutcome | null = null;
  if (before && before.openHandoffs > 0) {
    const { validateManagerOutcome } = await import("@/lib/tamar-pilot/manager-outcome");
    outcome = validateManagerOutcome(args.request.managerOutcome ?? {});
  }
  // Idempotent: a thread nobody holds is reported, never "released" again.
  if (before && before.humanOwned === false && before.openHandoffs === 0) {
    return {
      released: false,
      already_released: true,
      decision: "already_released",
      resolved_handoffs: 0,
      contact_id: contactId,
      reset: null,
    };
  }

  const res = await releaseIfUnheld({
    contactId,
    actor: args.actorId,
    trigger: "manual_release_to_tamar",
    force: true,
  });

  if (outcome) {
    const { managerResumeBrief } = await import("@/lib/tamar-pilot/manager-outcome");
    await supabaseAdmin
      .from("manager_handoffs" as any)
      .update({
        contacted_at: outcome.contacted_at,
        outcome: outcome.outcome,
        manager_summary: managerResumeBrief(outcome),
      } as any)
      .eq("contact_id", contactId)
      .not("status", "eq", "resolved");
  }

  let reset: any = null;
  if (resetIntake && res.released) {
    const { data: rpc } = await supabaseAdmin.rpc("admin_reset_tamar" as any, {
      p_contact_id: contactId,
      p_reason: "return_to_tamar_with_intake_reset",
      p_reset_intake: true,
      p_actor: args.actorId,
    } as any);
    reset = rpc ?? null;
  }

  const after = await getLockSnapshot(contactId);
  const at = new Date().toISOString();

  await supabaseAdmin.from("tamar_admin_audit_log" as any).insert({
    actor: args.actorId,
    area: "handoff",
    action: "release_contact_to_tamar",
    target_id: contactId,
    before_value: { lock: before, at },
    after_value: {
      lock: after,
      reason,
      released: res.released,
      reset_intake: resetIntake,
      manager_outcome: outcome,
    },
  } as any);
  await supabaseAdmin.from("zero_loss_audit_log" as any).insert({
    actor_user_id: args.actorId,
    actor_label: "admin_console",
    action: "release_contact_to_tamar",
    target_kind: "contact",
    target_id: contactId,
    details: {
      reason,
      resolved_handoffs: res.resolved_handoffs,
      reset_intake: resetIntake,
      decision: res.decision,
      manager_outcome: outcome,
      at,
    },
  } as any);

  return { ...res, already_released: false, reset, manager_outcome: outcome };
}
