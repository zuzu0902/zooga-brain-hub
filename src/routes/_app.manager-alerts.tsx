import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useT, useLanguage } from "@/lib/language-context";
import { useServerFn } from "@tanstack/react-start";
import {
  getHandoffChannelHealth,
  releaseContactToTamar,
  resolveHandoff,
  retryHandoffAlert,
} from "@/lib/handoff.functions";
import { AlertTriangle, RotateCcw, Undo2 } from "lucide-react";

export const Route = createFileRoute("/_app/manager-alerts")({
  head: () => ({ meta: [{ title: "Manager Alerts — Zooga CRM" }] }),
  component: ManagerAlertsPage,
});

function statusBadge(s: string | null) {
  const cls =
    s === "notified"
      ? "bg-sky-600 hover:bg-sky-600"
      : s === "claimed"
        ? "bg-amber-600 hover:bg-amber-600"
        : s === "resolved"
          ? "bg-emerald-600 hover:bg-emerald-600"
          : "bg-rose-600 hover:bg-rose-600";
  return <Badge className={cls}>{s || "open"}</Badge>;
}

function ManagerAlertsPage() {
  const t = useT();
  const { dir } = useLanguage();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const fetchHealth = useServerFn(getHandoffChannelHealth);
  const doRetry = useServerFn(retryHandoffAlert);
  const doResolve = useServerFn(resolveHandoff);
  const doRelease = useServerFn(releaseContactToTamar);
  const [releasing, setReleasing] = useState<string | null>(null);

  const { data: health } = useQuery({
    queryKey: ["handoff-channel-health"],
    refetchInterval: 60000,
    queryFn: async () => (await fetchHealth()) as any,
  });

  async function retryAlert(id: string) {
    setRetrying(id);
    try {
      const res: any = await doRetry({ data: { handoffId: id } });
      if (res?.alert_state === "sent") toast.success(t("ההתראה נשלחה למנהל"));
      else toast.error(`${t("ההתראה לא נשלחה")}: ${res?.alert_error ?? res?.alert_state}`);
      qc.invalidateQueries({ queryKey: ["manager-handoffs"] });
      qc.invalidateQueries({ queryKey: ["handoff-channel-health"] });
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setRetrying(null);
    }
  }

  const { data: managers } = useQuery({
    queryKey: ["managers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("managers" as any)
        .select("*")
        .order("created_at", { ascending: true });
      return (data ?? []) as any[];
    },
  });

  const { data: handoffs, refetch } = useQuery({
    queryKey: ["manager-handoffs"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await supabase
        .from("manager_handoffs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return (data ?? []) as any[];
    },
  });

  async function setStatus(id: string, status: string) {
    if (status === "resolved") {
      try {
        const res: any = await doResolve({ data: { handoffId: id } });
        toast.success(res?.released ? t("נסגר והשיחה הוחזרה לתמר") : t("עודכן"));
      } catch (e: any) {
        toast.error(String(e?.message ?? e));
      }
      qc.invalidateQueries({ queryKey: ["manager-handoffs"] });
      return;
    }
    const patch: any = { status };
    if (status === "claimed") patch.claimed_at = new Date().toISOString();
    const { error } = await supabase
      .from("manager_handoffs" as any)
      .update(patch)
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("עודכן"));
    qc.invalidateQueries({ queryKey: ["manager-handoffs"] });
  }

  async function returnToTamar(contactId: string) {
    setReleasing(contactId);
    try {
      const res: any = await doRelease({ data: { contactId } });
      if (res?.released) toast.success(t("השיחה הוחזרה לתמר"));
      else toast.error(`${t("לא הוחזר")}: ${res?.reason}`);
      qc.invalidateQueries({ queryKey: ["manager-handoffs"] });
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setReleasing(null);
    }
  }

  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  async function addManager() {
    if (!newName || !newPhone) return;
    const { error } = await supabase
      .from("managers" as any)
      .insert({ name: newName, phone: newPhone, active: true } as any);
    if (error) return toast.error(error.message);
    setNewName(""); setNewPhone("");
    qc.invalidateQueries({ queryKey: ["managers"] });
  }

  async function toggleActive(id: string, active: boolean) {
    const { error } = await supabase
      .from("managers" as any)
      .update({ active: !active })
      .eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["managers"] });
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto" dir={dir}>
      <div>
        <h1 className="text-2xl font-bold">Manager Alerts</h1>
        <p className="text-sm text-muted-foreground">
          {t("פניות handoff מתמר. Zooga מחליטה על escalation ומסמנת את הפנייה בתור (queued) עם משימה למנהל — אין העברה חיה.")}
        </p>
      </div>

      {health && !health.deliverable_now && (
        <Card className="p-4 border-destructive bg-destructive/10">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-1 text-sm">
              <div className="font-semibold text-destructive">
                {t("ערוץ ההתראות למנהל אינו זמין — התראות יישארו בתור ולא יישלחו")}
              </div>
              <ul className="text-xs space-y-0.5">
                {!health.manager_configured && <li>• {t("לא מוגדר מנהל פעיל עם מספר WhatsApp")}</li>}
                {!health.waba_id_present && <li>• {t("חסר WHATSAPP_WABA_ID — לא ניתן לאמת תבניות מול Meta")}</li>}
                {health.waba_id_present && !health.manager_template_approved && (
                  <li>• {t("התבנית zooga_manager_handoff אינה מאושרת בעברית")}</li>
                )}
                {health.template_lookup_error && (
                  <li className="font-mono" dir="ltr">• {health.template_lookup_error}</li>
                )}
                {!health.manager_window_open && <li>• {t("חלון 24 השעות מול המנהל סגור — נדרשת תבנית מאושרת")}</li>}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">{t("מנהלים מוגדרים")}</h3>
        <div className="space-y-2">
          {(managers ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-3 text-sm">
              <span className="font-medium">{m.name}</span>
              <span className="font-mono text-xs text-muted-foreground" dir="ltr">{m.phone}</span>
              <Badge variant={m.active ? "default" : "outline"}>{m.active ? "active" : "inactive"}</Badge>
              <Button size="sm" variant="ghost" onClick={() => toggleActive(m.id, m.active)}>
                {m.active ? t("השבת") : t("הפעל")}
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end pt-2 border-t">
          <div className="flex-1">
            <Label className="text-xs">{t("שם")}</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="flex-1">
            <Label className="text-xs">{t("טלפון WhatsApp")}</Label>
            <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} dir="ltr" placeholder="+972..." />
          </div>
          <Button onClick={addManager}>{t("הוסף מנהל")}</Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{t("Handoffs")}</h3>
            <Badge variant="outline">{handoffs?.length ?? 0}</Badge>
          </div>
          <Button size="sm" variant="ghost" onClick={() => refetch()}>{t("רענן")}</Button>
        </div>
        {(handoffs?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">{t("אין handoffs פעילים")}</div>
        ) : (
          <div className="divide-y">
            {handoffs!.map((h) => {
              const open = expanded === h.id;
              return (
                <div key={h.id} className="py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {statusBadge(h.status)}
                        {h.manager_notified ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600">notified ✓</Badge>
                        ) : (
                          <Badge variant="destructive">not notified</Badge>
                        )}
                        <span className="font-medium">{h.customer_name || t("ללא שם")}</span>
                        <span className="font-mono text-xs text-muted-foreground" dir="ltr">{h.customer_phone}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(h.created_at).toLocaleString()}
                        </span>
                        {h.notified_at && (
                          <span className="text-xs text-muted-foreground">
                            · {t("נשלח:")} {new Date(h.notified_at).toLocaleString()}
                          </span>
                        )}
                        {h.escalation_count > 1 && (
                          <Badge variant="destructive">{t("הסלמות:")} {h.escalation_count}</Badge>
                        )}
                        {h.alert_state && <Badge variant="outline">{h.alert_state}</Badge>}
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">{t("סיבה: ")}</span>
                        <span className="font-mono">{h.handoff_reason}</span>
                      </div>
                      {h.latest_inbound_message && (
                        <div className="text-sm">
                          <span className="text-muted-foreground">{t("הודעה: ")}</span>
                          {h.latest_inbound_message}
                        </div>
                      )}
                      {h.alert_error && (
                        <div className="text-sm text-destructive">alert_error: <span className="font-mono">{h.alert_error}</span></div>
                      )}
                      <div className="text-xs text-muted-foreground space-x-2 space-x-reverse">
                        {h.contact_id && (
                          <Link to="/contacts/$id" params={{ id: h.contact_id }} className="text-primary hover:underline">
                            {t("איש קשר →")}
                          </Link>
                        )}
                        {h.runtime_trace_id && (
                          <Link to="/runtime-trace" className="text-primary hover:underline">trace →</Link>
                        )}
                        {h.resolved_offer_id && <span>· offer: {String(h.resolved_offer_id).slice(0, 8)}</span>}
                        {h.resolved_campaign_id && <span>· campaign: {String(h.resolved_campaign_id).slice(0, 8)}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 flex-wrap">
                      {!h.manager_notified && (
                        <Button
                          size="sm"
                          variant="default"
                          className="gap-1"
                          disabled={retrying === h.id}
                          onClick={() => retryAlert(h.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {retrying === h.id ? t("שולח…") : t("שלח שוב למנהל")}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setStatus(h.id, "claimed")}>{t("סמן claimed")}</Button>
                      <Button size="sm" variant="outline" onClick={() => setStatus(h.id, "resolved")}>{t("סמן resolved")}</Button>
                      {h.contact_id && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="gap-1"
                          disabled={releasing === h.contact_id}
                          onClick={() => returnToTamar(h.contact_id)}
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          {releasing === h.contact_id ? t("מחזיר…") : t("החזר לתמר")}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setExpanded(open ? null : h.id)}>
                        {open ? t("הסתר") : "raw"}
                      </Button>
                    </div>
                  </div>
                  {open && (
                    <pre className="p-3 bg-muted rounded text-xs overflow-auto max-h-96" dir="ltr">
                      {JSON.stringify(h, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}