/**
 * ZOOGA OS — הגדרות > חיבורי WhatsApp.
 * שתי זהויות נפרדות לחלוטין: תמר (Meta Cloud API) ו-Alex Personal (WhatsApp Web Bridge).
 * אין כאן שליחה ואין סודות — רק מטא-דאטה של נקודות קצה.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listWhatsappConnections, updateBridgeConnection } from "@/lib/whatsapp-broadcast.functions";
import {
  CAPABILITY_LABELS,
  CONNECTION_STATUS_LABELS,
  TRANSPORT_LABELS,
  canOwnGroupBroadcast,
  type WaConnection,
} from "@/lib/whatsapp-broadcast/core";

export const Route = createFileRoute("/_app/settings/whatsapp-connections")({
  component: WhatsappConnectionsPage,
  head: () => ({
    meta: [
      { title: "חיבורי WhatsApp · Zooga OS" },
      { name: "description", content: "ניהול שתי זהויות WhatsApp נפרדות: תמר (Meta API) ו-Alex Personal (Web Bridge)." },
      { property: "og:title", content: "חיבורי WhatsApp · Zooga OS" },
      { property: "og:description", content: "הפרדה מלאה בין שיחות אישיות של תמר לבין הפצה לקבוצות." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const BRIDGE_FIELDS = [
  { key: "bridge_base_url", label: "כתובת בסיס של הגשר (Bridge Base URL)" },
  { key: "connect_path", label: "נתיב חיבור" },
  { key: "status_path", label: "נתיב סטטוס" },
  { key: "groups_sync_path", label: "נתיב סנכרון קבוצות" },
  { key: "broadcast_path", label: "נתיב הפצה" },
];

function StatusBadge({ status }: { status: WaConnection["status"] }) {
  const tone =
    status === "connected"
      ? "bg-green-500/10 text-green-700 border-green-500/30"
      : status === "error"
        ? "bg-destructive/10 text-destructive border-destructive/30"
        : "bg-muted text-muted-foreground";
  return <Badge variant="outline" className={tone}>{CONNECTION_STATUS_LABELS[status]}</Badge>;
}

function BridgeCard({ conn, onSaved }: { conn: WaConnection; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState(conn.phone_label ?? "");

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of BRIDGE_FIELDS) next[f.key] = (conn.config?.[f.key] as string) ?? "";
    setForm(next);
    setPhone(conn.phone_label ?? "");
  }, [conn]);

  const save = useMutation({
    mutationFn: useServerFn(updateBridgeConnection),
    onSuccess: () => {
      toast.success("הגדרות הגשר נשמרו");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "שמירה נכשלה"),
  });

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-3">
          <span>{conn.display_name}</span>
          <StatusBadge status={conn.status} />
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          {TRANSPORT_LABELS[conn.transport]} · הפצה לקבוצות WhatsApp בלבד
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {conn.capabilities.map((c) => (
            <Badge key={c} variant="secondary">{CAPABILITY_LABELS[c] ?? c}</Badge>
          ))}
        </div>
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          זהות נפרדת לחלוטין מתמר. לעולם אינה משתמשת בפרטי Meta Cloud API. הגשר החיצוני עדיין לא מחובר —
          כל ההגדרות כאן הן מטא-דאטה בלבד, ואין שליחה בפועל מהמערכת.
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">תווית מספר (תצוגה בלבד)</div>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Alex Personal" />
          </div>
          {BRIDGE_FIELDS.map((f) => (
            <div key={f.key}>
              <div className="text-[11px] text-muted-foreground mb-1">{f.label}</div>
              <Input
                dir="ltr"
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.key === "bridge_base_url" ? "https://bridge.example.com" : "/path"}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>חובר לאחרונה: {conn.last_connected_at ?? "—"}</span>
          <span>סונכרן לאחרונה: {conn.last_sync_at ?? "—"}</span>
          <span>הפצה אוטומטית ע״י סוכן: {conn.allow_agent_broadcast ? "מופעלת" : "כבויה"}</span>
        </div>
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              data: {
                connection_id: conn.id,
                phone_label: phone || null,
                config: Object.fromEntries(BRIDGE_FIELDS.map((f) => [f.key, form[f.key] || null])),
              },
            })
          }
        >
          שמירת הגדרות גשר
        </Button>
      </CardContent>
    </Card>
  );
}

function MetaCard({ conn }: { conn: WaConnection }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-3">
          <span>{conn.display_name}</span>
          <StatusBadge status={conn.status} />
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          {TRANSPORT_LABELS[conn.transport]} · שיחות 1:1 של תמר
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {conn.capabilities.map((c) => (
            <Badge key={c} variant="secondary">{CAPABILITY_LABELS[c] ?? c}</Badge>
          ))}
        </div>
        <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
          חיבור קיים לקריאה בלבד. <strong>אינו משמש להפצה לקבוצות.</strong> ההגדרות והאישורים מנוהלים במסך הגדרות API.
        </div>
        <div className="text-xs text-muted-foreground">תווית מספר: {conn.phone_label ?? "—"}</div>
      </CardContent>
    </Card>
  );
}

function WhatsappConnectionsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWhatsappConnections);
  const q = useQuery({ queryKey: ["wa", "connections"], queryFn: () => listFn({}) });
  const conns = (q.data ?? []) as WaConnection[];

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">חיבורי WhatsApp</h1>
        <p className="text-sm text-muted-foreground mt-1">
          תמר = שיחות אישיות דרך Meta API · Alex Personal = הפצה לקבוצות דרך WhatsApp Web Bridge. שתי זהויות
          נפרדות לגמרי, ללא החלפה ביניהן.
        </p>
      </div>
      {q.isLoading && <div className="text-sm text-muted-foreground">טוען…</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {conns.map((c) =>
          canOwnGroupBroadcast(c) ? (
            <BridgeCard key={c.id} conn={c} onSaved={() => qc.invalidateQueries({ queryKey: ["wa"] })} />
          ) : (
            <MetaCard key={c.id} conn={c} />
          ),
        )}
      </div>
    </div>
  );
}
