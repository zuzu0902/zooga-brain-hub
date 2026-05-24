import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards, countRows, isVerbose } from "@/lib/introspect-api.server";

const TABLES = [
  { name: "contacts", key_columns: ["id","full_name","phone","source","status","created_at"], purpose: "Master contact profile", relates_to: ["interactions","campaign_contacts","contact_memories"] },
  { name: "interactions", key_columns: ["id","contact_id","type","source","timestamp"], purpose: "Conversation/event log", relates_to: ["contacts","campaigns"] },
  { name: "campaigns", key_columns: ["id","name","status","objective","intake_flow_type","created_at"], purpose: "Marketing/outreach campaigns", relates_to: ["campaign_contacts","offers"] },
  { name: "campaign_contacts", key_columns: ["id","campaign_id","contact_id","conversion_stage","fit_score"], purpose: "Campaign membership join", relates_to: ["campaigns","contacts"] },
  { name: "intake_campaigns", key_columns: ["id","campaign_name","template_name","status","sent_count"], purpose: "Tamar intake flows", relates_to: [] },
  { name: "intake_inbox", key_columns: ["id","parsed_phone","parsed_name","source","status","created_at"], purpose: "Incoming intake queue", relates_to: ["contacts"] },
  { name: "extracted_attributes", key_columns: ["id","contact_id","attribute_name","confidence_score","source","applied"], purpose: "AI attribute extraction audit log", relates_to: ["contacts","interactions"] },
  { name: "contact_memories", key_columns: ["id","contact_id","memory_type","memory_key","confidence_score"], purpose: "Long-term unstructured memories", relates_to: ["contacts"] },
  { name: "contact_profile_history", key_columns: ["id","contact_id","field_name","changed_by","created_at"], purpose: "Profile field change history", relates_to: ["contacts"] },
  { name: "pending_ai_insights", key_columns: ["id","contact_id","category","field_name","confidence_score","status"], purpose: "Low-confidence AI suggestions awaiting review", relates_to: ["contacts"] },
  { name: "imported_leads", key_columns: ["id","import_status","consent_status","created_at"], purpose: "Bulk import staging", relates_to: ["contacts"] },
  { name: "offers", key_columns: ["id","title","status","category","price"], purpose: "Offer catalog", relates_to: ["campaigns"] },
  { name: "messages", key_columns: ["id","contact_id","channel","status","created_at"], purpose: "Message history", relates_to: ["contacts","offers"] },
  { name: "tasks", key_columns: ["id","contact_id","status","priority","due_date"], purpose: "Manager tasks", relates_to: ["contacts"] },
  { name: "webhook_logs", key_columns: ["id","source","status","created_at"], purpose: "Inbound webhook audit log", relates_to: [] },
  { name: "api_settings", key_columns: ["id","default_source","facebook_page_id","tamar_backend_url"], purpose: "Integration configuration (secrets redacted)", relates_to: [] },
  { name: "user_roles", key_columns: ["id","user_id","role"], purpose: "RBAC roles (separated from profiles)", relates_to: [] },
];

export const Route = createFileRoute("/api/introspect/schema-summary")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    const verbose = isVerbose(request);
    const tables = await Promise.all(TABLES.map(async (t) => ({
      ...t, estimated_row_count: await countRows(t.name),
      ...(verbose ? {} : { relates_to: undefined }),
    })));
    return jsonResponse({
      schema: "public", table_count: tables.length, tables,
      rls: "Enabled on all tables. Writes gated by is_admin(); offers also has public SELECT.",
      note: "Row counts exact-at-read. Key columns are an allow-list; full schema not exposed.",
    });
  })},
});