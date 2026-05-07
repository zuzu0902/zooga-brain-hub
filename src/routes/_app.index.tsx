import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Users, Sparkles, UserCheck, Heart, Crown, Pause, TrendingUp, Activity } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { STATUS_LABELS, INTEREST_LABELS, INTERACTION_TYPE_LABELS, formatDate } from "@/lib/i18n";

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "דשבורד — Zooga CRM" }] }),
  component: Dashboard,
});

function Stat({
  label,
  value,
  icon: Icon,
  tint,
}: {
  label: string;
  value: number | string;
  icon: any;
  tint: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="text-3xl font-bold mt-1">{value}</div>
        </div>
        <div className="h-11 w-11 rounded-xl flex items-center justify-center" style={{ background: tint }}>
          <Icon className="h-5 w-5 text-primary-foreground" />
        </div>
      </div>
    </Card>
  );
}

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [contacts, newToday, interactions] = await Promise.all([
        supabase.from("contacts").select("status, interests, engagement_score, full_name, id, last_interaction_at"),
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .gte("created_at", todayStart.toISOString())
          .eq("status", "new_lead"),
        supabase
          .from("interactions")
          .select("id, type, content, timestamp, contact_id, contacts(full_name)")
          .order("timestamp", { ascending: false })
          .limit(8),
      ]);

      const all = contacts.data ?? [];
      const counts: Record<string, number> = {
        new_lead: 0,
        active_member: 0,
        interested: 0,
        customer: 0,
        VIP: 0,
        inactive: 0,
      };
      const interestCounts: Record<string, number> = {};
      all.forEach((c: any) => {
        counts[c.status] = (counts[c.status] || 0) + 1;
        (c.interests || []).forEach((i: string) => {
          interestCounts[i] = (interestCounts[i] || 0) + 1;
        });
      });
      const topInterests = Object.entries(interestCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);
      const topEngaged = [...all]
        .sort((a: any, b: any) => (b.engagement_score || 0) - (a.engagement_score || 0))
        .slice(0, 6);

      return {
        total: all.length,
        newToday: newToday.count ?? 0,
        counts,
        topInterests,
        recent: interactions.data ?? [],
        topEngaged,
      };
    },
  });

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">דשבורד</h1>
        <p className="text-muted-foreground mt-1">מבט חי על קהילת זוגה</p>
      </header>

      {isLoading ? (
        <div className="text-muted-foreground">טוען נתונים...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Stat label="סה״כ אנשי קשר" value={data!.total} icon={Users} tint="var(--gradient-warm)" />
            <Stat label="לידים חדשים היום" value={data!.newToday} icon={Sparkles} tint="oklch(0.78 0.13 85)" />
            <Stat label="חברים פעילים" value={data!.counts.active_member} icon={UserCheck} tint="oklch(0.7 0.09 160)" />
            <Stat label="מתעניינים" value={data!.counts.interested} icon={Heart} tint="oklch(0.65 0.18 320)" />
            <Stat label="לקוחות + VIP" value={data!.counts.customer + data!.counts.VIP} icon={Crown} tint="oklch(0.55 0.12 250)" />
            <Stat label="לא פעילים" value={data!.counts.inactive} icon={Pause} tint="oklch(0.5 0.025 50)" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-5 lg:col-span-1">
              <h3 className="font-semibold flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-primary" /> תחומי עניין מובילים
              </h3>
              <div className="space-y-3">
                {data!.topInterests.length === 0 && (
                  <div className="text-sm text-muted-foreground">אין נתונים עדיין</div>
                )}
                {data!.topInterests.map(([k, v]) => {
                  const max = data!.topInterests[0][1];
                  return (
                    <div key={k}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{INTEREST_LABELS[k] || k}</span>
                        <span className="text-muted-foreground">{v}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${(v / max) * 100}%`,
                            background: "var(--gradient-warm)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-5 lg:col-span-2">
              <h3 className="font-semibold flex items-center gap-2 mb-4">
                <Activity className="h-4 w-4 text-primary" /> אינטראקציות אחרונות
              </h3>
              <div className="space-y-2">
                {data!.recent.length === 0 && (
                  <div className="text-sm text-muted-foreground">אין אינטראקציות עדיין</div>
                )}
                {data!.recent.map((r: any) => (
                  <Link
                    key={r.id}
                    to="/contacts/$id"
                    params={{ id: r.contact_id }}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors"
                  >
                    <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-xs font-medium">
                      {(r.contacts?.full_name || "?").slice(0, 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.contacts?.full_name || "ללא שם"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {INTERACTION_TYPE_LABELS[r.type] || r.type} · {r.content || ""}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">{formatDate(r.timestamp)}</div>
                  </Link>
                ))}
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <h3 className="font-semibold mb-4">אנשי קשר במעורבות גבוהה</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {data!.topEngaged.map((c: any) => (
                <Link
                  key={c.id}
                  to="/contacts/$id"
                  params={{ id: c.id }}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted transition-colors"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.full_name || "ללא שם"}</div>
                    <div className="text-xs text-muted-foreground">{STATUS_LABELS[c.status]}</div>
                  </div>
                  <div className="text-sm font-bold text-primary">{c.engagement_score}</div>
                </Link>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}