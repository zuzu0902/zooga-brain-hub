/**
 * TAMAR V2 — handoff ownership resolution (I/O layer for handoff-activity.ts).
 *
 * Runs on EVERY inbound turn before the state machine derives the state, so
 * a stale human freeze can never become a permanent conversational lock.
 * Nothing here deletes history, CRM, memories, transcripts, notes or audit.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { OPEN_HANDOFF_STATUSES, releaseThreadToTamar } from "@/lib/tamar-handoff-core.server";
import { managerResumeBrief } from "@/lib/tamar-pilot/manager-outcome";
import {
  assessHumanHandling,
  decideHandoffTurn,
  type HandoffActivity,
  type HandoffTurnAction,
} from "./handoff-activity";

export const STATUS_ACK_KEY = "v2_handoff_status_ack_at";
export const MANAGER_BRIEF_KEY = "v2_manager_brief";

export type HandoffOwnershipOutcome = {
  contact: any;
  action: HandoffTurnAction;
  reason: string;
  activity: HandoffActivity | null;
  managerBrief: string | null;
};

export async function resolveHandoffOwnership(args: {
  contact: any;
  resetRequested: boolean;
  now?: Date;
}): Promise<HandoffOwnershipOutcome> {
  const contact = args.contact;
  const frozenFlag =
    contact?.human_owned === true ||
    contact?.conversation_state === "human_owned" ||
    contact?.conversation_state === "human_handoff_queued";
  if (!contact?.id || !frozenFlag) {
    return { contact, action: "none", reason: "not_frozen", activity: null, managerBrief: null };
  }

  const { data: rows } = await supabaseAdmin
    .from("manager_handoffs" as any)
    .select("status, created_at, claimed_at, contacted_at, resolved_at, manager_summary, outcome, notes")
    .eq("contact_id", contact.id)
    .order("created_at", { ascending: false })
    .limit(20);
  const all = (rows as any[]) ?? [];
  const open = all.filter((r) => (OPEN_HANDOFF_STATUSES as readonly string[]).includes(String(r?.status ?? "")));

  const dyn = (contact.dynamic_profile_fields ?? {}) as Record<string, any>;
  const activity = assessHumanHandling({
    humanOwned: contact.human_owned === true,
    humanOwnedBy: contact.human_owned_by ?? null,
    humanOwnedAt: contact.human_owned_at ?? null,
    openHandoffs: open,
    managerLastActivityAt: contact.manager_last_activity_at ?? null,
    now: args.now,
  });
  const decision = decideHandoffTurn({
    frozen: true,
    activity,
    resetRequested: args.resetRequested,
    lastStatusAckAt: dyn[STATUS_ACK_KEY] ?? null,
    now: args.now,
  });

  // The manager's recorded outcome is what Tamar resumes from.
  const resolvedWithSummary = all.find(
    (r) => String(r?.status ?? "") === "resolved" && String(r?.manager_summary ?? "").trim(),
  );
  const managerBrief = resolvedWithSummary
    ? managerResumeBrief({
        contacted_at: String(resolvedWithSummary.contacted_at ?? resolvedWithSummary.resolved_at ?? ""),
        outcome: resolvedWithSummary.outcome,
        manager_summary: String(resolvedWithSummary.manager_summary),
      } as any)
    : null;

  if (decision.action === "resume_tamar") {
    // An ACTIVE manager conversation keeps its open handoff row (the team is
    // still on it); a stale transfer is closed out as part of the release.
    await releaseThreadToTamar({
      contactId: contact.id,
      actor: args.resetRequested ? "customer_reengagement" : "system_stale_handoff",
      resolveHandoffs: !activity.active,
      trigger: decision.reason,
    }).catch(() => null);

    const nextDyn = { ...dyn };
    delete nextDyn[STATUS_ACK_KEY];
    if (managerBrief) nextDyn[MANAGER_BRIEF_KEY] = managerBrief;
    await supabaseAdmin
      .from("contacts")
      .update({ dynamic_profile_fields: nextDyn } as any)
      .eq("id", contact.id);

    await supabaseAdmin.from("webhook_logs").insert({
      source: "tamar_v2",
      status: "handoff_ownership_returned_to_tamar",
      payload: {
        contact_id: contact.id,
        reason: decision.reason,
        activity_reason: activity.reason,
        reset_requested: args.resetRequested,
        kept_open_handoff: activity.active,
      },
    } as any);

    return {
      contact: {
        ...contact,
        human_owned: false,
        human_owned_by: null,
        manager_attention_required: false,
        conversation_state: "consented",
        dynamic_profile_fields: nextDyn,
      },
      action: "resume_tamar",
      reason: decision.reason,
      activity,
      managerBrief,
    };
  }

  if (decision.action === "status_reply") {
    const nextDyn = { ...dyn, [STATUS_ACK_KEY]: new Date().toISOString() };
    await supabaseAdmin
      .from("contacts")
      .update({ dynamic_profile_fields: nextDyn } as any)
      .eq("id", contact.id);
    return {
      contact: { ...contact, dynamic_profile_fields: nextDyn },
      action: "status_reply",
      reason: decision.reason,
      activity,
      managerBrief,
    };
  }

  return { contact, action: decision.action, reason: decision.reason, activity, managerBrief };
}
