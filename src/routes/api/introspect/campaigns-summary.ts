import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDebugAuth, jsonResponse, methodGuards, countRows } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/campaigns-summary")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    const [{ data: campaigns }, total, intakeTotal, ccTotal] = await Promise.all([
      supabaseAdmin.from("campaigns").select("status,intake_flow_type"),
      countRows("campaigns"),
      countRows("intake_campaigns"),
      countRows("campaign_contacts"),
    ]);
    const byStatus: Record<string, number> = {};
    const byFlow: Record<string, number> = {};
    for (const c of campaigns ?? []) {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      byFlow[c.intake_flow_type] = (byFlow[c.intake_flow_type] ?? 0) + 1;
    }
    const { data: stages } = await supabaseAdmin.from("campaign_contacts").select("conversion_stage");
    const byStage: Record<string, number> = {};
    for (const s of stages ?? []) {
      const k = s.conversion_stage ?? "unknown";
      byStage[k] = (byStage[k] ?? 0) + 1;
    }
    return jsonResponse({
      campaigns: { total, by_status: byStatus, by_intake_flow_type: byFlow },
      campaign_contacts: { total: ccTotal, by_conversion_stage: byStage },
      intake_campaigns: { total: intakeTotal },
      automation: {
        tamar_dispatch_enabled: true,
        autonomous_proposal: false,
        scheduling: false,
      },
    });
  })},
});