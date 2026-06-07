import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Megaphone, Plus, Search, Activity, Users, Flame, AlertTriangle } from "lucide-react";
import { INTAKE_FLOW_LABELS } from "@/lib/intake-flows";
import { formatRelative } from "@/lib/i18n";
import { ContextBanner } from "@/components/context-banner";
import { Tag } from "lucide-react";

export const Route = createFileRoute("/_app/campaigns")({
  head: () => ({ meta: [{ title: "קמפיינים — Zooga CRM" }] }),
  component: CampaignsRoute,
});

function CampaignsRoute() {
  const location = useLocation();
  if (location.pathname.startsWith("/campaigns/")) return <Outlet />;
  return <CampaignsListPage />;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "טיוטה", active: "פעיל", paused: "מושהה", completed: "הסתיים", archived: "ארכיון",
};
const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  draft: "bg-muted text-muted-foreground border-border",
  paused: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  completed: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  archived: "bg-muted text-muted-foreground/60 border-border",
};

function KpiCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${tone || "bg-primary/10 text-primary"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold">{value}</div>
        </div>
      </div>
    </Card>
  );
}

function CampaignsListPage() {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const offerIds = Array.from(new Set((campaigns || []).map((c: any) => c.offer_id).filter(Boolean)));
  const { data: offerMap } = useQuery({
    queryKey: ["offers-map", offerIds.join(",")],
    enabled: offerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("offers").select("id,title,price,currency").in("id", offerIds);
      const m: Record<string, any> = {};
      (data || []).forEach((o: any) => { m[o.id] = o; });
      return m;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["campaigns-overall-stats"],
    queryFn: async () => {
      const [{ data: cc }, { count: hotCount }, { count: escCount }] = await Promise.all([
        supabase.from("campaign_contacts").select("contact_id, last_activity_at, intent_level"),
        supabase.from("campaign_contacts").select("id", { count: "exact", head: true }).eq("intent_level", "high"),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("manager_attention_required", true),
      ]);
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
      const active = (cc || []).filter((r) => r.last_activity_at && new Date(r.last_activity_at) > sevenDaysAgo).length;
      return { acquired: (cc || []).length, active, hot: hotCount || 0, escalations: escCount || 0 };
    },
  });

  const filtered = (campaigns || []).filter((c: any) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (q && !`${c.name} ${c.objective || ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const activeCount = (campaigns || []).filter((c: any) => c.status === "active").length;

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">קמפיינים</h1>
          <p className="text-muted-foreground mt-1">מערכת בינת-קמפיינים המאפשרת לתמר להבין את ההקשר של כל פנייה</p>
        </div>
        <Link to="/campaigns/new">
          <Button className="gap-2"><Plus className="h-4 w-4" /> קמפיין חדש</Button>
        </Link>
      </header>

      <ContextBanner id="campaigns-list">
        <strong>קמפיינים</strong> = ערוץ השיווק שמביא אנשים אל <strong>הצעה</strong> מסוימת. כל קמפיין צריך להיות מקושר להצעה אחת.
      </ContextBanner>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Megaphone} label="קמפיינים פעילים" value={activeCount} />
        <KpiCard icon={Users} label="אנשי קשר שנרכשו" value={stats?.acquired ?? 0} tone="bg-blue-500/10 text-blue-700" />
        <KpiCard icon={Activity} label="שיחות פעילות (7ימים)" value={stats?.active ?? 0} tone="bg-emerald-500/10 text-emerald-700" />
        <KpiCard icon={Flame} label="לידים חמים" value={stats?.hot ?? 0} tone="bg-red-500/10 text-red-700" />
      </div>

      <Card className="p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש קמפיין..." className="pr-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-3 font-medium">שם</th>
                <th className="p-3 font-medium">סטטוס</th>
                <th className="p-3 font-medium">הצעה</th>
                <th className="p-3 font-medium">פלטפורמה</th>
                <th className="p-3 font-medium">זרימת אינטייק</th>
                <th className="p-3 font-medium">זווית רגשית</th>
                <th className="p-3 font-medium">עודכן</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (<tr><td colSpan={7} className="p-6 text-center text-muted-foreground">טוען...</td></tr>)}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">
                  אין קמפיינים. <Link to="/campaigns/new" className="text-primary hover:underline">צור את הראשון</Link>
                </td></tr>
              )}
              {filtered.map((c: any) => (
                <tr key={c.id} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="p-3">
                    <Link to="/campaigns/$id" params={{ id: c.id }} className="font-semibold hover:text-primary">
                      {c.name}
                    </Link>
                    {c.objective && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{c.objective}</div>}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className={STATUS_TONE[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                  </td>
                  <td className="p-3">
                    {(() => {
                      const o = c.offer_id ? offerMap?.[c.offer_id] : null;
                      if (o) return (
                        <Link to="/offers/$id" params={{ id: o.id }} className="inline-flex items-center gap-1.5 text-xs hover:text-primary">
                          <Tag className="h-3 w-3 text-primary" />
                          <span className="truncate max-w-[140px]">{o.title}</span>
                          {o.price && <span className="text-muted-foreground">· {formatPrice(o.price, o.currency)}</span>}
                        </Link>
                      );
                      return <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30 text-xs">לא משויך</Badge>;
                    })()}
                  </td>
                  <td className="p-3 text-muted-foreground">{c.source_platform || "—"}</td>
                  <td className="p-3"><Badge variant="secondary">{INTAKE_FLOW_LABELS[c.intake_flow_type as keyof typeof INTAKE_FLOW_LABELS] || c.intake_flow_type}</Badge></td>
                  <td className="p-3 text-muted-foreground text-xs">{c.emotional_angle || "—"}</td>
                  <td className="p-3 text-muted-foreground text-xs">{formatRelative(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}