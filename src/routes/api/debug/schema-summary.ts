/**
 * INTERNAL READ-ONLY DEBUG ENDPOINT
 * GET /api/debug/schema-summary — table names, estimated row counts, key columns.
 * Never returns raw row data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDebugAuth, jsonResponse } from "@/lib/debug-api.server";

const TABLES: { name: string; key_columns: string[]; purpose: string }[] = [
  { name: "contacts", key_columns: ["id", "full_name", "phone", "source", "stage", "created_at"], purpose: "Master contact profile" },
  { name: "interactions", key_columns: ["id", "contact_id", "type", "direction", "timestamp"], purpose: "Conversation/event log" },
  { name: "campaigns", key_columns: ["id", "name", "status", "objective", "created_at"], purpose: "Marketing/outreach campaigns" },
  { name: "campaign_contacts", key_columns: ["id", "campaign_id", "contact_id", "status"], purpose: "Campaign membership join" },
  { name: "intake_campaigns", key_columns: ["id", "name", "status", "flow_type"], purpose: "Tamar intake flows" },
  { name: "intake_inbox", key_columns: ["id", "parsed_phone", "parsed_name", "status", "created_at"], purpose: "Incoming intake queue" },
  { name: "extracted_attributes", key_columns: ["id", "contact_id", "field", "confidence", "source", "created_at"], purpose: "AI attribute extraction audit log" },
  { name: "contact_memories", key_columns: ["id", "contact_id", "kind", "created_at"], purpose: "Long-term unstructured memories" },
  { name: "contact_profile_history", key_columns: ["id", "contact_id", "field", "changed_at"], purpose: "Profile field change history" },
  { name: "pending_ai_insights", key_columns: ["id", "contact_id", "field", "confidence", "status"], purpose: "Low-confidence AI suggestions awaiting review" },
  { name: "imported_leads", key_columns: ["id", "source", "status", "created_at"], purpose: "Bulk import staging" },
  { name: "offers", key_columns: ["id", "title", "status", "created_at"], purpose: "Offer catalog" },
  { name: "messages", key_columns: ["id", "contact_id", "direction", "created_at"], purpose: "Message history" },
  { name: "tasks", key_columns: ["id", "contact_id", "status", "due_at"], purpose: "Manager tasks" },
  { name: "webhook_logs", key_columns: ["id", "source", "status", "created_at"], purpose: "Inbound webhook audit log" },
  { name: "api_settings", key_columns: ["id", "default_source", "facebook_page_id", "tamar_backend_url"], purpose: "Integration configuration (secrets redacted)" },
  { name: "user_roles", key_columns: ["id", "user_id", "role"], purpose: "RBAC roles (separated from profiles)" },
];

async function countRows(table: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from(table as any)
    .select("*", { count: "exact", head: true });
  return error ? null : (count ?? null);
}

const handler = async ({ request }: { request: Request }) => {
  const gate = checkDebugAuth(request);
  if (gate) return gate;

  const tables = await Promise.all(
    TABLES.map(async (t) => ({
      ...t,
      estimated_row_count: await countRows(t.name),
    })),
  );

  return jsonResponse({
    schema: "public",
    table_count: tables.length,
    tables,
    note: "Row counts are exact-at-read-time. Key columns are an allow-list; full schema is not exposed.",
  });
};

export const Route = createFileRoute("/api/debug/schema-summary")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PUT: handler,
      DELETE: handler,
      PATCH: handler,
    },
  },
});