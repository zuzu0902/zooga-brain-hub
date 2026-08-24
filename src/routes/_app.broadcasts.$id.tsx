/** ZOOGA OS — פירוט הפצה לקבוצות: יעד אחד לכל קבוצה. תצוגה בלבד. */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBroadcastDetails } from "@/lib/whatsapp-broadcast.functions";
import { BROADCAST_STATUS_LABELS } from "@/lib/whatsapp-broadcast/core";
import { formatDate } from "@/lib/i18n";

export const Route = createFileRoute("/_app/broadcasts/$id")({
  component: BroadcastDetailsPage,
  head: () => ({
    meta: [
      { title: "פירוט הפצה · Zooga OS" },
      { name: "description", content: "סטטוס הפצה לקבוצות WhatsApp לפי קבוצה." },
      { property: "og:title", content: "פירוט הפצה · Zooga OS" },
      { property: "og:description", content: "מעקב אחר יעדי הפצה בזוגה." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const TARGET_LABELS: Record<string, string> = {
  pending: "ממתינה",
  queued: "בתור",
  sent: "נשלחה",
  failed: "נכשלה",
  skipped: "דולגה",
};

function BroadcastDetailsPage() {
  const { id } = Route.useParams();
  const fn = useServerFn(getBroadcastDetails);
  const q = useQuery({ queryKey: ["wa", "broadcast", id], queryFn: () => fn({ data: { id } }) });
  const b = (q.data as any)?.broadcast;
  const targets = ((q.data as any)?.targets ?? []) as any[];

  return (
    <div className="p-6 space-y-4" dir="rtl">
      <Link to="/broadcasts" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
        ← חזרה להפצות
      </Link>
      {q.isLoading && <div className="text-sm text-muted-foreground">טוען…</div>}
      {b && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-3">
                {b.title}
                <Badge variant="outline">{BROADCAST_STATUS_LABELS[b.status as "draft"] ?? b.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3">
                {b.message_text}
              </div>
              {b.media_url && <div dir="ltr" className="text-xs text-muted-foreground">{b.media_url}</div>}
              <div className="text-xs text-muted-foreground">
                סה״כ {b.total_groups} · נשלחו {b.success_count} · נכשלו {b.failed_count} · ממתינות {b.pending_count}
              </div>
              <div className="text-xs text-muted-foreground">
                נוצרה {formatDate(b.created_at)}
                {b.scheduled_for ? ` · מתוזמנת ל-${formatDate(b.scheduled_for)}` : ""}
                {b.started_at ? ` · התחילה ${formatDate(b.started_at)}` : ""}
                {b.finished_at ? ` · הסתיימה ${formatDate(b.finished_at)}` : ""}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 text-start">#</th>
                    <th className="p-2 text-start">קבוצה</th>
                    <th className="p-2 text-start">מזהה צ׳אט</th>
                    <th className="p-2 text-start">סטטוס</th>
                    <th className="p-2 text-start">שגיאה</th>
                    <th className="p-2 text-start">נשלחה</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="p-2">{t.send_order + 1}</td>
                      <td className="p-2">{t.group_name_snapshot}</td>
                      <td className="p-2 font-mono text-xs" dir="ltr">{t.whatsapp_chat_id_snapshot}</td>
                      <td className="p-2">{TARGET_LABELS[t.status] ?? t.status}</td>
                      <td className="p-2 text-destructive">{t.error_text ?? "—"}</td>
                      <td className="p-2">{t.sent_at ? formatDate(t.sent_at) : "—"}</td>
                    </tr>
                  ))}
                  {!targets.length && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-muted-foreground">
                        אין יעדים
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
