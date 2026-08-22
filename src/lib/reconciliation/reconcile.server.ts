/**
 * CANONICAL RECONCILIATION — SERVER RUNNER (dry-run first, idempotent).
 *
 * Loads the three state surfaces, asks the pure planner what diverges from the
 * canonical state, and (only when `apply` is true) writes the exact planned
 * `after` values. Every applied action is written to `zero_loss_audit_log`
 * with a full before/after snapshot.
 *
 * Hard guarantees: no WhatsApp send, no activation, no event re-processing,
 * no deletes, and contact 6058 is never touched.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_INTAKE_FIELDS } from "@/lib/onboarding/baseline-intake";
import { getNextMissingIntakeQuestion } from "@/lib/intake-next-question";
import { auditZeroLoss } from "@/lib/zero-loss/vault.server";
import {
  OPEN_HANDOFF_STATUSES,
  PROTECTED_CONTACT_IDS,
  isProtected,
  maskRowId,
  planReconciliation,
  summarize,
  type ContactSurface,
  type ReconcileAction,
} from "./plan";

export type ReconcileReport = {
  dry_run: boolean;
  scanned: { contacts: number; lite: number; handoffs: number; pending_events: number };
  summary: Record<string, number>;
  applied: number;
  failed: number;
  actions: Array<{
    kind: string;
    table: string;
    row_id_masked: string | null;
    contact_id_masked: string | null;
    reason: string;
    before: Record<string, any>;
    after: Record<string, any>;
    applied: boolean;
    error?: string;
  }>;
  audit_target: string;
};

function snapshotFor(contact: any) {
  const facts: Record<string, any> = {};
  const put = (k: string, v: any) => {
    if (v) facts[k] = { value_text: String(v), explicit_or_inferred: "explicit", confidence: 1 };
  };
  put("first_name", contact?.first_name ?? contact?.name);
  put("city", contact?.residence_city);
  put("region", contact?.region);
  put("interests", Array.isArray(contact?.interests) ? contact.interests.join(", ") : contact?.interests);
  put("primary_goal", contact?.primary_goal);
  return { facts, skipped: [] as string[] };
}

async function loadSurfaces(contactIds?: string[]) {
  const liteQuery = supabaseAdmin.from("tamar_lite_conversations" as any).select("*").limit(1000);
  const { data: liteRows } = contactIds?.length
    ? await liteQuery.in("contact_id", contactIds)
    : await liteQuery;
  const lite = ((liteRows as any[]) ?? []).filter((l) => !isProtected(l.contact_id));

  const { data: handoffRows } = await supabaseAdmin
    .from("manager_handoffs")
    .select("id, contact_id, status, resolved_at, updated_at, notes")
    .in("status", OPEN_HANDOFF_STATUSES)
    .limit(500);
  const handoffs = ((handoffRows as any[]) ?? []).filter((h) => !isProtected(h.contact_id));

  const ids = Array.from(
    new Set(
      [
        ...(contactIds ?? []),
        ...lite.map((l) => String(l.contact_id)),
        // handoff owners must be loaded too, or their canonical state is unknown
        ...handoffs.map((h) => (h.contact_id ? String(h.contact_id) : "")),
      ].filter(Boolean),
    ),
  ).filter((id) => !isProtected(id));

  const { data: contactRows } = ids.length
    ? await supabaseAdmin.from("contacts").select("*").in("id", ids)
    : { data: [] as any[] };
  const contacts = ((contactRows as any[]) ?? []);

  const { data: eventRows } = await supabaseAdmin
    .from("tamar_lite_events" as any)
    .select("id, contact_id, event_kind, processing_state, payload, error")
    .eq("processing_state", "pending")
    .limit(500);
  const pendingEvents = ((eventRows as any[]) ?? []).filter((e) => !isProtected(e.contact_id));

  return { contacts, lite, handoffs, pendingEvents };
}


async function sellableIds(): Promise<string[]> {
  try {
    const { loadCatalog } = await import("@/lib/offer-catalog/catalog.server");
    const { entries } = await loadCatalog();
    return entries.filter((e: any) => e.sellable).map((e: any) => String(e.id));
  } catch {
    return [];
  }
}

async function applyAction(action: ReconcileAction, now: string): Promise<void> {
  if (action.table === "tamar_lite_conversations") {
    const a = action.after as any;
    const { error } = await supabaseAdmin
      .from("tamar_lite_conversations" as any)
      .update({
        phase: a.phase,
        human_owned: a.human_owned,
        current_question_key: a.current_question_key,
        version: a.version,
        updated_at: now,
      } as any)
      .eq("contact_id", action.row_id);
    if (error) throw new Error(error.message);
    return;
  }
  if (action.table === "tamar_lite_events") {
    const a = action.after as any;
    const { error } = await supabaseAdmin
      .from("tamar_lite_events" as any)
      .update({ processing_state: a.processing_state, error: a.error, updated_at: now } as any)
      .eq("id", action.row_id)
      .eq("processing_state", "pending");
    if (error) throw new Error(error.message);
    return;
  }
  if (action.table === "contacts") {
    const a = action.after as any;
    const { error } = await supabaseAdmin
      .from("contacts")
      .update({ dynamic_profile_fields: a.dynamic_profile_fields } as any)
      .eq("id", action.row_id);
    if (error) throw new Error(error.message);
    return;
  }
  const a = action.after as any;
  const { error } = await supabaseAdmin
    .from("manager_handoffs")
    .update({
      status: a.status,
      resolved_at: a.resolved_at,
      notes: { ...(((action.before as any).notes as any) ?? {}), reconciliation: a.note },
      updated_at: now,
    } as any)
    .eq("id", action.row_id)
    .in("status", OPEN_HANDOFF_STATUSES);
  if (error) throw new Error(error.message);
}

export async function runCanonicalReconciliation(opts: {
  apply?: boolean;
  contactIds?: string[];
  actorLabel?: string;
  actorUserId?: string | null;
}): Promise<ReconcileReport> {
  const now = new Date().toISOString();
  const apply = !!opts.apply;
  const { contacts, lite, handoffs, pendingEvents } = await loadSurfaces(opts.contactIds);
  const sellable = await sellableIds();
  const liteByContact = new Map(lite.map((l) => [String(l.contact_id), l]));

  const surfaces: ContactSurface[] = contacts.map((contact) => {
    const next = getNextMissingIntakeQuestion(DEFAULT_INTAKE_FIELDS, snapshotFor(contact));
    return {
      contact,
      lite: liteByContact.get(String(contact.id)) ?? null,
      nextQuestionKey: next?.field_key ?? null,
      sellableOfferIds: sellable,
    };
  });

  const actions = planReconciliation({ contacts: surfaces, handoffs, pendingEvents, now });

  const reported: ReconcileReport["actions"] = [];
  let applied = 0;
  let failed = 0;
  for (const action of actions) {
    let ok = false;
    let err: string | undefined;
    if (apply) {
      try {
        await applyAction(action, now);
        await auditZeroLoss({
          action: "canonical_reconciliation",
          actorUserId: opts.actorUserId ?? null,
          actorLabel: opts.actorLabel ?? "admin",
          targetKind: action.table,
          targetId: action.row_id,
          details: {
            kind: action.kind,
            reason: action.reason,
            before: action.before,
            after: action.after,
          },
        });
        ok = true;
        applied++;
      } catch (e: any) {
        err = String(e?.message ?? e);
        failed++;
      }
    }
    reported.push({
      kind: action.kind,
      table: action.table,
      row_id_masked: maskRowId(action.row_id),
      contact_id_masked: maskRowId(action.contact_id),
      reason: action.reason,
      before: action.before,
      after: action.after,
      applied: ok,
      ...(err ? { error: err } : {}),
    });
  }

  await auditZeroLoss({
    action: apply ? "canonical_reconciliation_run" : "canonical_reconciliation_dry_run",
    actorUserId: opts.actorUserId ?? null,
    actorLabel: opts.actorLabel ?? "admin",
    targetKind: "reconciliation",
    targetId: null,
    details: {
      apply,
      protected_contacts: PROTECTED_CONTACT_IDS.length,
      scanned: { contacts: contacts.length, lite: lite.length, handoffs: handoffs.length, pending_events: pendingEvents.length },
      summary: summarize(actions),
      applied,
      failed,
    },
  });

  return {
    dry_run: !apply,
    scanned: {
      contacts: contacts.length,
      lite: lite.length,
      handoffs: handoffs.length,
      pending_events: pendingEvents.length,
    },
    summary: summarize(actions),
    applied,
    failed,
    actions: reported,
    audit_target: "zero_loss_audit_log(action=canonical_reconciliation*)",
  };
}
