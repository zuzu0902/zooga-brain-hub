import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTamarLiteStatus } from "@/lib/tamar-lite.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/tamar-lite")({
  component: TamarLitePage,
  head: () => ({
    meta: [
      { title: "Tamar Lite — מצב צל | Zooga" },
      { name: "description", content: "מסך קריאה בלבד למצב הצל של Tamar Lite: backlog, החלטות וכשלים." },
      { property: "og:title", content: "Tamar Lite — מצב צל" },
      { property: "og:description", content: "מעקב קריאה בלבד אחר מנוע Tamar Lite במצב צל." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function TamarLitePage() {
  const fetchStatus = useServerFn(getTamarLiteStatus);
  const { data, isLoading } = useQuery({ queryKey: ["tamar-lite-status"], queryFn: () => fetchStatus({}) });

  return (
    <div className="space-y-6 p-6" dir="rtl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Tamar Lite</h1>
        <Badge variant="secondary">{data?.mode ?? "shadow"}</Badge>
        <Badge variant={data?.kill_switch ? "destructive" : "outline"}>
          kill switch: {String(data?.kill_switch ?? true)}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        מצב צל בלבד — אין נתיב שליחה. המערכת הקיימת ממשיכה לשלוח כרגיל.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="אירועים" value={data?.totals.total ?? (isLoading ? "…" : 0)} />
        <Stat label="Backlog" value={data?.totals.backlog ?? 0} />
        <Stat label="עובדו" value={data?.totals.processed ?? 0} />
        <Stat label="כשלים" value={data?.totals.failures ?? 0} />
        <Stat label="Outbox (לא נשלח)" value={data?.outbox_rows ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>החלטות אחרונות (shadow)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.decisions ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground">אין החלטות עדיין.</div>
          )}
          {(data?.decisions ?? []).map((d: any) => (
            <div key={d.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{d.action?.kind ?? "none"}</Badge>
                {(d.reason_codes ?? []).map((r: string) => (
                  <Badge key={r} variant="secondary">{r}</Badge>
                ))}
                <span className="text-xs text-muted-foreground">{d.created_at}</span>
              </div>
              {d.action?.question_text && <div className="mt-1">{d.action.question_text}</div>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}