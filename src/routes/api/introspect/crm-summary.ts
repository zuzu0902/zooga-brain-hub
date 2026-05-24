import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDebugAuth, jsonResponse, methodGuards, countRows } from "@/lib/introspect-api.server";

async function countWhere(table: string, col: string, value: any): Promise<number | null> {
  const { count, error } = await supabaseAdmin.from(table as any)
    .select("*", { count: "exact", head: true }).eq(col, value);
  return error ? null : (count ?? null);
}

export const Route = createFileRoute("/api/introspect/crm-summary")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    const [contacts, interactions, memories, attrs, pending, manager, applied, pendingPending, tasksTotal, tasksOpen, tasksInProgress, tasksDone] = await Promise.all([
      countRows("contacts"),
      countRows("interactions"),
      countRows("contact_memories"),
      countRows("extracted_attributes"),
      countRows("pending_ai_insights"),
      countWhere("contacts","manager_attention_required",true),
      countWhere("extracted_attributes","applied",true),
      countWhere("pending_ai_insights","status","pending"),
      countRows("tasks"),
      countWhere("tasks","status","open"),
      countWhere("tasks","status","in_progress"),
      countWhere("tasks","status","done"),
    ]);

    const MEM_TYPES = ["fact","preference","warning","observation","relationship_signal","offer_signal"];
    const memoriesByCategory: Record<string, number | null> = {};
    for (const t of MEM_TYPES) memoriesByCategory[t] = await countWhere("contact_memories", "memory_type", t);

    const TASK_SOURCES = ["pending_insight","manager_attention","ai_assistant","manual"];
    const tasksBySource: Record<string, number | null> = {};
    for (const s of TASK_SOURCES) tasksBySource[s] = await countWhere("tasks", "source_kind", s);

    const INSIGHT_RES = ["pending","under_human","returned_to_ai","resolved"];
    const insightsByResolution: Record<string, number | null> = {};
    for (const r of INSIGHT_RES) insightsByResolution[r] = await countWhere("pending_ai_insights", "resolution_state", r);

    return jsonResponse({
      generated_at: new Date().toISOString(),
      contacts: { total: contacts, manager_attention_required: manager },
      interactions: { total: interactions },
      memory_layer: { total_memories: memories, by_category: memoriesByCategory, taxonomy: MEM_TYPES },
      extraction: {
        total_attribute_records: attrs,
        applied: applied,
        pending_review_total: pending,
        pending_status_pending: pendingPending,
        by_resolution_state: insightsByResolution,
      },
      tasks: {
        total: tasksTotal,
        open: tasksOpen,
        in_progress: tasksInProgress,
        done: tasksDone,
        by_source_kind: tasksBySource,
      },
      source_of_truth: {
        conversation: "zooga",
        memory: "zooga",
        tasks: "zooga",
        handoff: "zooga",
        tamar_backend_role: "channel_runtime_only",
      },
      note: "Counts only. No contact identities, phone numbers, names, or message content are exposed.",
    });
  })},
});