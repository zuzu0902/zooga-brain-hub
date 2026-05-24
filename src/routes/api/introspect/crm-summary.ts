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
    const [contacts, interactions, memories, attrs, pending, manager, applied, pendingPending] = await Promise.all([
      countRows("contacts"),
      countRows("interactions"),
      countRows("contact_memories"),
      countRows("extracted_attributes"),
      countRows("pending_ai_insights"),
      countWhere("contacts","manager_attention_required",true),
      countWhere("extracted_attributes","applied",true),
      countWhere("pending_ai_insights","status","pending"),
    ]);
    return jsonResponse({
      generated_at: new Date().toISOString(),
      contacts: { total: contacts, manager_attention_required: manager },
      interactions: { total: interactions },
      memory_layer: { total_memories: memories },
      extraction: {
        total_attribute_records: attrs,
        applied: applied,
        pending_review_total: pending,
        pending_status_pending: pendingPending,
      },
      note: "Counts only. No contact identities, phone numbers, names, or message content are exposed.",
    });
  })},
});