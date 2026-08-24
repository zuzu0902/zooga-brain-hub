/**
 * ZOOGA OS — הפצה לקבוצות WhatsApp (Control Plane בלבד).
 * אין שליחה בפועל מהמערכת: הגשר החיצוני (WhatsApp Web Bridge) יבצע בעתיד.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createBroadcast,
  cancelBroadcast,
  listBroadcasts,
  listWhatsappConnections,
  listWhatsappGroups,
} from "@/lib/whatsapp-broadcast.functions";
import {
  BROADCAST_STATUS_LABELS,
  canOwnGroupBroadcast,
  validateBroadcastDraft,
  type WaConnection,
} from "@/lib/whatsapp-broadcast/core";
import { getBridgeStatus } from "@/lib/whatsapp-bridge.functions";
import { BRIDGE_STATE_LABELS, type BridgeStatus } from "@/lib/zooga-whatsapp-bridge/bridge-contract";
import { formatDate } from "@/lib/i18n";


export const Route = createFileRoute("/_app/broadcasts")({
  component: BroadcastsPage,
  head: () => ({
    meta: [
      { title: "הפצה לקבוצות WhatsApp · Zooga OS" },
      { name: "description", content: "ניהול קבוצות WhatsApp, חיבור הודעות והפצה מתוזמנת דרך Alex Personal." },
      { property: "og:title", content: "הפצה לקבוצות WhatsApp · Zooga OS" },
      { property: "og:description", content: "מרכז בקרה להפצות קבוצתיות בזוגה." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function BroadcastsPage() {
  const qc = useQueryClient();
  const connFn = useServerFn(listWhatsappConnections);
  const groupsFn = useServerFn(listWhatsappGroups);
  const historyFn = useServerFn(listBroadcasts);

  const connections = useQuery({ queryKey: ["wa", "connections"], queryFn: () => connFn({}) });
  const groupsQ = useQuery({ queryKey: ["wa", "groups"], queryFn: () => groupsFn({}) });
  const historyQ = useQuery({ queryKey: ["wa", "broadcasts"], queryFn: () => historyFn({}) });

  const bridgeStatusFn = useServerFn(getBridgeStatus);
  const bridgeStatusQ = useQuery({
    queryKey: ["wa", "bridge", "status"],
    queryFn: () => bridgeStatusFn({}),
    refetchInterval: 30_000,
  });
  const bridgeStatus = bridgeStatusQ.data as BridgeStatus | undefined;
  const bridge = ((connections.data ?? []) as WaConnection[]).find(canOwnGroupBroadcast) ?? null;

  const groups = useMemo(
    () => ((groupsQ.data ?? []) as any[]).filter((g) => bridge && g.connection_id === bridge.id),
    [groupsQ.data, bridge],
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [category, setCategory] = useState<string>("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");

  const categories = useMemo(
    () => Array.from(new Set(groups.map((g) => g.category).filter(Boolean))) as string[],
    [groups],
  );

  const create = useMutation({
    mutationFn: useServerFn(createBroadcast),
    onSuccess: (r: any) => {
      toast.success(`ההפצה נוצרה (${BROADCAST_STATUS_LABELS[r.status as "draft"]}) · ${r.targets} קבוצות. לא נשלחה הודעה.`);
      setSelected([]);
      setTitle("");
      setMessage("");
      setMediaUrl("");
      setScheduledFor("");
      qc.invalidateQueries({ queryKey: ["wa"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "יצירת הפצה נכשלה"),
  });

  const cancel = useMutation({
    mutationFn: useServerFn(cancelBroadcast),
    onSuccess: () => {
      toast.success("ההפצה בוטלה");
      qc.invalidateQueries({ queryKey: ["wa", "broadcasts"] });
    },
  });

  const submit = () => {
    if (!bridge) {
      toast.error("אין חיבור WhatsApp Web Bridge מוגדר");
      return;
    }
    const draft = {
      title,
      message_text: message,
      media_url: mediaUrl || null,
      group_ids: selected,
      scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
    };
    const check = validateBroadcastDraft(draft);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    create.mutate({ data: { connection_id: bridge.id, ...draft } });
  };

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">הפצה לקבוצות WhatsApp</h1>
        <p className="text-sm text-muted-foreground mt-1">
          הפצה לקבוצות מתבצעת אך ורק דרך Alex Personal (WhatsApp Web Bridge). תמר / Meta API אינה משמשת כאן.
        </p>
      </div>

      {!bridge && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm">
          לא הוגדר חיבור הפצה. יש להגדיר את Alex Personal במסך{" "}
          <Link to="/settings/whatsapp-connections" className="underline font-medium">
            הגדרות · חיבורי WhatsApp
          </Link>
          .
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
        <span className="font-semibold">גשר Alex Personal:</span>
        {!bridgeStatus?.configured ? (
          <Badge variant="outline" className="bg-muted text-muted-foreground">שרת הגשר אינו מוגדר</Badge>
        ) : (
          <Badge
            variant="outline"
            className={
              bridgeStatus.connected
                ? "bg-green-500/10 text-green-700 border-green-500/30"
                : "bg-destructive/10 text-destructive border-destructive/30"
            }
          >
            {BRIDGE_STATE_LABELS[bridgeStatus.state]}
          </Badge>
        )}
        <span>
          מצב Control Plane: יצירה או תזמון של הפצה אינם שולחים דבר. שליחה חיה תתאפשר רק כשהגשר מחובר ומופעל בשרת.
        </span>
      </div>


      <Tabs defaultValue="compose" dir="rtl">
        <TabsList>
          <TabsTrigger value="compose">הפצה חדשה</TabsTrigger>
          <TabsTrigger value="groups">קבוצות ({groups.length})</TabsTrigger>
          <TabsTrigger value="history">היסטוריה</TabsTrigger>
        </TabsList>

        <TabsContent value="compose" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">תוכן ההפצה</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="שם פנימי להפצה" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Textarea
                rows={6}
                placeholder="תוכן ההודעה לקבוצות…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  dir="ltr"
                  placeholder="קישור מדיה (https, אופציונלי)"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                />
                <Input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">בחירת קבוצות ({selected.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelected(groups.map((g) => g.id))}>
                  בחר הכל
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                  נקה בחירה
                </Button>
                {categories.map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    variant={category === c ? "default" : "outline"}
                    onClick={() => {
                      setCategory(c);
                      setSelected(groups.filter((g) => g.category === c).map((g) => g.id));
                    }}
                  >
                    {c}
                  </Button>
                ))}
              </div>
              {!groups.length && (
                <div className="text-sm text-muted-foreground">
                  אין קבוצות מסונכרנות. סנכרון הקבוצות יתבצע ע״י הגשר החיצוני לאחר חיבורו.
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-3 rounded-md border border-border p-2 text-sm"
                  >
                    <Checkbox
                      checked={selected.includes(g.id)}
                      disabled={!g.send_enabled}
                      onCheckedChange={(v) =>
                        setSelected((prev) => (v ? [...prev, g.id] : prev.filter((x) => x !== g.id)))
                      }
                    />
                    <span className="flex-1 truncate">{g.current_name}</span>
                    {g.category && <Badge variant="secondary">{g.category}</Badge>}
                    {!g.send_enabled && <Badge variant="outline">חסום לשליחה</Badge>}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Button disabled={!bridge || create.isPending} onClick={submit}>
            {scheduledFor ? "שמירה ותזמון (ללא שליחה)" : "שמירת טיוטה"}
          </Button>
        </TabsContent>

        <TabsContent value="groups" className="pt-4">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 text-start">שם קבוצה</th>
                    <th className="p-2 text-start">קטגוריה</th>
                    <th className="p-2 text-start">שליחה</th>
                    <th className="p-2 text-start">נראתה לאחרונה</th>
                    <th className="p-2 text-start">מקור</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className="border-t border-border">
                      <td className="p-2">{g.current_name}</td>
                      <td className="p-2">{g.category ?? "—"}</td>
                      <td className="p-2">{g.send_enabled ? "פעילה" : "כבויה"}</td>
                      <td className="p-2">{g.last_seen_at ? formatDate(g.last_seen_at) : "—"}</td>
                      <td className="p-2">{bridge?.display_name ?? "—"}</td>
                    </tr>
                  ))}
                  {!groups.length && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-muted-foreground">
                        אין קבוצות
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="pt-4 space-y-2">
          {((historyQ.data ?? []) as any[]).map((b) => (
            <Card key={b.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <Link
                  to="/broadcasts/$id"
                  params={{ id: b.id }}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {b.title}
                </Link>
                <Badge variant="outline">{BROADCAST_STATUS_LABELS[b.status as "draft"] ?? b.status}</Badge>
                <span className="text-muted-foreground">
                  סה״כ {b.total_groups} · נשלחו {b.success_count} · נכשלו {b.failed_count} · ממתינות {b.pending_count}
                </span>
                <span className="text-muted-foreground">{formatDate(b.created_at)}</span>
                {(b.status === "draft" || b.status === "queued") && (
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ data: { id: b.id } })}>
                    ביטול
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
          {!((historyQ.data ?? []) as any[]).length && (
            <div className="text-sm text-muted-foreground">עדיין אין הפצות</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
