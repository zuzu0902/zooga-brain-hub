import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { coreApi, listAll } from "@/lib/hostinger-core/client";
import { buildDashboard } from "@/lib/hostinger-core/dashboard";
import { Card } from "@/components/ui/card";
import { Users, Sparkles, UserCheck, Heart, Crown, Pause, TrendingUp, Activity } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { STATUS_LABELS, INTEREST_LABELS, INTERACTION_TYPE_LABELS, formatDate } from "@/lib/i18n";
import { useT } from "@/lib/language-context";
import { ZoogaCoreCard } from "@/components/zooga-core-card";
import { MigrationVerificationPanel } from "@/components/migration-verification-panel";

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
  const t = useT();
  // MIGRATION: dashboard CRM data comes from Hostinger Core.
  const { session, loading: authLoading } = useAuth();
  const { data, isLoading: queryLoading, error, refetch } = useQuery({
    queryKey: ["core-dashboard"],
    enabled: !authLoading && !!session,
    retry: (n, e: any) => (e?.status === 401 ? n < 2 : n < 1),
    queryFn: async () => {
      const [overview, contacts] = await Promise.all([coreApi.overview(), listAll((p) => coreApi.listContacts(p), 5000)]);
      return buildDashboard(overview, contacts);
    },
  });
  const isLoading = authLoading || queryLoading;

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">{t("דשבורד")}</h1>
        <p className="text-muted-foreground mt-1">{t("מבט חי על קהילת זוגה")}</p>
      </header>

      <ZoogaCoreCard />

      <MigrationVerificationPanel />

      {isLoading ? (
        <div className="text-muted-foreground">{t("טוען נתונים...")}</div>
      ) : error || !data ? (
        <Card className="p-6 text-destructive">
          {t("לא ניתן לטעון נתוני CRM כרגע.")}{" "}
          <button className="underline" onClick={() => refetch()}>{t("נסה שוב")}</button>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Stat label={t("סה״כ אנשי קשר")} value={data!.total} icon={Users} tint="var(--gradient-warm)" />
            {data!.catalogTotal != null && <Stat label={t("פריטי קטלוג")} value={data!.catalogTotal} icon={Sparkles} tint="oklch(0.7 0.1 200)" />}
            <Stat label={t("לידים חדשים היום")} value={data!.newToday} icon={Sparkles} tint="oklch(0.78 0.13 85)" />
            <Stat label={t("חברים פעילים")} value={data!.counts.active_member} icon={UserCheck} tint="oklch(0.7 0.09 160)" />
            <Stat label={t("מתעניינים")} value={data!.counts.interested} icon={Heart} tint="oklch(0.65 0.18 320)" />
            <Stat label={t("לקוחות + VIP")} value={data!.counts.customer + data!.counts.VIP} icon={Crown} tint="oklch(0.55 0.12 250)" />
            <Stat label={t("לא פעילים")} value={data!.counts.inactive} icon={Pause} tint="oklch(0.5 0.025 50)" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-5 lg:col-span-1">
              <h3 className="font-semibold flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-primary" /> {t("תחומי עניין מובילים")}
              </h3>
              <div className="space-y-3">
                {data!.topInterests.length === 0 && (
                  <div className="text-sm text-muted-foreground">{t("אין נתונים עדיין")}</div>
                )}
                {data!.topInterests.map(([k, v]) => {
                  const max = data!.topInterests[0][1];
                  return (
                    <div key={k}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{t(INTEREST_LABELS[k] || k)}</span>
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
                <Activity className="h-4 w-4 text-primary" /> {t("אינטראקציות אחרונות")}
              </h3>
              <div className="space-y-2">
                {data!.recent.length === 0 && (
                  <div className="text-sm text-muted-foreground">{t("אין אינטראקציות עדיין")}</div>
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
                      <div className="text-sm font-medium truncate">{r.contacts?.full_name || t("ללא שם")}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t(INTERACTION_TYPE_LABELS[r.type] || r.type)} · {r.content || ""}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">{formatDate(r.timestamp)}</div>
                  </Link>
                ))}
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <h3 className="font-semibold mb-4">{t("אנשי קשר במעורבות גבוהה")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {data!.topEngaged.map((c: any) => (
                <Link
                  key={c.id}
                  to="/contacts/$id"
                  params={{ id: c.id }}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted transition-colors"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.full_name || t("ללא שם")}</div>
                    <div className="text-xs text-muted-foreground">{t(STATUS_LABELS[c.status])}</div>
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