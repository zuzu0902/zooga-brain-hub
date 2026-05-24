import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Compass, Route as RouteIcon, Sparkles } from "lucide-react";

export function TamarDecisionStrip({ contactId, contact }: { contactId: string; contact: any }) {
  const { data: lastInteraction } = useQuery({
    queryKey: ["last-interaction", contactId],
    refetchInterval: 20000,
    queryFn: async () => {
      const { data } = await supabase
        .from("interactions")
        .select("id, campaign_id, type, timestamp")
        .eq("contact_id", contactId)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
  });

  const { data: activeCampaign } = useQuery({
    queryKey: ["active-campaign", lastInteraction?.campaign_id],
    enabled: !!lastInteraction?.campaign_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("campaigns")
        .select("id, name, intake_flow_type, status, ai_goal")
        .eq("id", lastInteraction!.campaign_id as string)
        .maybeSingle();
      return data ?? null;
    },
  });

  const { data: pendingCount } = useQuery({
    queryKey: ["pending-count", contactId],
    refetchInterval: 20000,
    queryFn: async () => {
      const { count } = await supabase
        .from("pending_ai_insights")
        .select("*", { count: "exact", head: true })
        .eq("contact_id", contactId)
        .eq("status", "pending");
      return count ?? 0;
    },
  });

  const flowLabel = activeCampaign?.intake_flow_type ?? "qualification";
  const recent = lastInteraction?.timestamp
    ? Date.now() - new Date(lastInteraction.timestamp).getTime() < 24 * 60 * 60 * 1000
    : false;

  let routingReason = "idle";
  if (contact?.manager_attention_required) routingReason = "escalated_to_manager";
  else if ((pendingCount ?? 0) > 0) routingReason = "low_confidence_review";
  else if (recent) routingReason = "active_conversation";

  const nextAction =
    contact?.ai_recommended_next_action ||
    (contact?.manager_attention_required
      ? "Review manager-flagged contact"
      : (pendingCount ?? 0) > 0
      ? `Review ${pendingCount} pending insight(s)`
      : recent
      ? "Continue conversation"
      : "Create follow-up task or send offer");

  return (
    <Card className="p-4 border-primary/30 bg-gradient-to-l from-primary/5 to-transparent">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-primary" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Tamar Decision
          </span>
        </div>
        {contact?.manager_attention_required && (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" /> manager attention required
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
        <Cell label="Active mode / flow" value={flowLabel} sub={activeCampaign?.name ?? "no active campaign"} />
        <Cell label="Routing reason" value={routingReason} icon={<RouteIcon className="h-3.5 w-3.5" />} />
        <Cell label="Pending insights" value={String(pendingCount ?? 0)} />
        <Cell label="Suggested next action" value={nextAction} icon={<Sparkles className="h-3.5 w-3.5" />} />
      </div>
    </Card>
  );
}

function Cell({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-background/60 border">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="text-sm font-medium break-words">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}