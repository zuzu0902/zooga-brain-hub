import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Megaphone, Pause, Play, Square, RotateCcw, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  launchIntakeCampaign,
  sendCampaignBatch,
  setCampaignControl,
  retryCampaignFailures,
  getCampaignSummary,
  listTemplates,
  checkTemplate,
} from "@/lib/campaign-send.functions";
import { useT, useLanguage } from "@/lib/language-context";

export const Route = createFileRoute("/_app/intake-campaign")({
  head: () => ({ meta: [{ title: "קמפיין אינטייק — Zooga CRM" }] }),
  component: IntakeCampaignPage,
});

const SEND_STATE_LABELS: Record<string, string> = {
  queued: "בתור",
  sending: "בשליחה",
  sent: "נשלח",
  delivered: "נמסר",
  read: "נקרא",
  replied: "הגיב",
  failed: "כשל",
  opted_out: "ללא הסכמה",
  skipped: "דולג",
};

function IntakeCampaignPage() {
  const t = useT();
  const { dir } = useLanguage();
  const [campaignName, setCampaignName] = useState("Zooga Intake " + new Date().toLocaleDateString("he-IL"));
  const [template, setTemplate] = useState("");
  const [language, setLanguage] = useState("he");
  const [batchSize, setBatchSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "launch" | "batch" | "control">(null);
  const [templateCheck, setTemplateCheck] = useState<any>(null);

  const launchFn = useServerFn(launchIntakeCampaign);
  const batchFn = useServerFn(sendCampaignBatch);
  const controlFn = useServerFn(setCampaignControl);
  const retryFn = useServerFn(retryCampaignFailures);
  const summaryFn = useServerFn(getCampaignSummary);
  const templatesFn = useServerFn(listTemplates);
  const checkFn = useServerFn(checkTemplate);

  const { data: templates } = useQuery({
    queryKey: ["wa-templates"],
    queryFn: async () => (await templatesFn({} as any)) as any,
  });

  const { data: leads, refetch, isLoading } = useQuery({
    queryKey: ["ready_leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("imported_leads")
        .select("id, full_name, phone, source_campaign, whatsapp_template_status, import_status, send_state, consent_status, opted_out_at, last_message_at, sent_at, delivered_at, read_at, replied_at, last_error")
        .in("import_status", ["ready_for_intake", "sent_to_tamar", "replied", "failed", "opted_out"])
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: summary, refetch: refetchSummary } = useQuery({
    queryKey: ["campaign-summary", campaignId],
    enabled: !!campaignId,
    queryFn: async () => (await summaryFn({ data: { campaign_id: campaignId! } })) as any,
  });

  // Only consented, not-opted-out, ready leads may be selected for a send.
  const eligible = (leads ?? []).filter(
    (l: any) => l.import_status === "ready_for_intake" && l.consent_status === "approved" && !l.opted_out_at,
  );

  function toggle(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    if (selected.size === eligible.length) setSelected(new Set());
    else setSelected(new Set(eligible.map((l: any) => l.id)));
  }

  async function verifyTemplate() {
    if (!template) return;
    const res: any = await checkFn({ data: { template_name: template, language_code: language } });
    setTemplateCheck(res);
    if (res?.ok) toast.success(t("התבנית מאושרת לשליחה"));
    else toast.error(t("התבנית אינה מאושרת: ") + (res?.reason ?? ""));
  }

  async function launch() {
    if (!template) { toast.error(t("בחר תבנית מאושרת")); return; }
    if (selected.size === 0) { toast.error(t("בחר לפחות ליד אחד")); return; }
    setBusy("launch");
    try {
      const res: any = await launchFn({
        data: {
          campaign_name: campaignName,
          template_name: template,
          language_code: language,
          batch_size: batchSize,
          lead_ids: Array.from(selected),
        },
      });
      if (!res?.ok) { toast.error(t("שגיאה: ") + (res?.error ?? t("לא ידוע"))); return; }
      setCampaignId(res.campaign_id);
      setSelected(new Set());
      toast.success(`${t("קמפיין נוצר · בתור: ")}${res.queued}${t(" · נחסמו ללא הסכמה: ")}${res.blocked_no_consent}`);
      refetch();
    } finally {
      setBusy(null);
    }
  }

  async function runBatch() {
    if (!campaignId) return;
    setBusy("batch");
    try {
      const res: any = await batchFn({ data: { campaign_id: campaignId, batch_size: batchSize } });
      if (!res?.ok) toast.error(t("שגיאה: ") + (res?.error ?? ""));
      else toast.success(`${t("נשלחו ")}${res.sent}${t(" · כשלו ")}${res.failed}${t(" · נותרו ")}${res.remaining}`);
      refetchSummary();
      refetch();
    } finally {
      setBusy(null);
    }
  }

  async function control(next: "running" | "paused" | "stopped") {
    if (!campaignId) return;
    setBusy("control");
    try {
      await controlFn({ data: { campaign_id: campaignId, control: next } });
      toast.success(t("סטטוס עודכן"));
      refetchSummary();
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    if (!campaignId) return;
    const res: any = await retryFn({ data: { campaign_id: campaignId } });
    toast.success(`${res.requeued}${t(" הוחזרו לתור")}`);
    refetchSummary();
  }

  const approved = (templates?.templates ?? []).filter((tp: any) => tp.status === "APPROVED");

  return (
    <div className="p-6 space-y-5" dir={dir}>
      <header>
        <h1 className="text-3xl font-bold">{t("קמפיין אינטייק")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("שליחת תבנית WhatsApp מאושרת ללידים בעלי הסכמה, במנות מבוקרות, עם מעקב מלא לכל ליד")}
        </p>
      </header>

      <Card className="p-5 space-y-4 max-w-3xl">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>{t("שם קמפיין")}</Label>
            <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
          </div>
          <div>
            <Label>{t("תבנית WhatsApp מאושרת")}</Label>
            <Select value={template} onValueChange={(v) => { setTemplate(v); setTemplateCheck(null); }}>
              <SelectTrigger><SelectValue placeholder={t("בחר תבנית")} /></SelectTrigger>
              <SelectContent>
                {approved.map((tp: any) => (
                  <SelectItem key={`${tp.name}:${tp.language}`} value={tp.name}>
                    {tp.name} · {tp.language}
                  </SelectItem>
                ))}
                {approved.length === 0 && <SelectItem value="__none" disabled>{t("לא נמצאו תבניות מאושרות")}</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("שפה")}</Label>
            <Input dir="ltr" value={language} onChange={(e) => setLanguage(e.target.value)} />
          </div>
          <div>
            <Label>{t("גודל מנה (מקסימום 25)")}</Label>
            <Input
              type="number"
              min={1}
              max={25}
              value={batchSize}
              onChange={(e) => setBatchSize(Math.min(25, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="outline" onClick={verifyTemplate} disabled={!template}>{t("בדוק תבנית מול Meta")}</Button>
          {templateCheck && (
            <Badge variant={templateCheck.ok ? "secondary" : "destructive"} className="gap-1">
              {templateCheck.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {templateCheck.status ?? templateCheck.reason}
            </Badge>
          )}
          <div className="flex-1" />
          <div className="text-sm text-muted-foreground">
            {t("נבחרו ")}{selected.size}{t(" מתוך ")}{eligible.length}{t(" זכאים")}
          </div>
          <Button onClick={launch} disabled={busy !== null || selected.size === 0} className="gap-2">
            {busy === "launch" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            {t("צור קמפיין")}
          </Button>
        </div>
      </Card>

      {campaignId && (
        <Card className="p-5 space-y-4 max-w-3xl">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold">{summary?.campaign?.campaign_name ?? campaignName}</h2>
              <p className="text-xs text-muted-foreground">
                {t("מצב: ")}{summary?.campaign?.control_state ?? "—"} · {t("סה\"כ: ")}{summary?.total ?? 0}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => control("paused")} disabled={busy !== null} className="gap-1">
                <Pause className="h-3.5 w-3.5" />{t("השהה")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => control("running")} disabled={busy !== null} className="gap-1">
                <Play className="h-3.5 w-3.5" />{t("המשך")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => control("stopped")} disabled={busy !== null} className="gap-1">
                <Square className="h-3.5 w-3.5" />{t("עצור")}
              </Button>
              <Button size="sm" variant="outline" onClick={retry} disabled={busy !== null} className="gap-1">
                <RotateCcw className="h-3.5 w-3.5" />{t("נסה שוב כשלונות")}
              </Button>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {Object.entries(summary?.counts ?? {}).map(([k, v]: any) => (
              <Badge key={k} variant="secondary">{t(SEND_STATE_LABELS[k] ?? k)}: {v}</Badge>
            ))}
          </div>

          <Button onClick={runBatch} disabled={busy !== null} className="gap-2">
            {busy === "batch" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            {t("שלח מנה הבאה")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("כל לחיצה שולחת מנה אחת בלבד, עם השהיה בין הודעות. אפשר להשהות או לעצור בין מנות; ליד שכבר נשלח לא נשלח פעמיים.")}
          </p>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-3 w-10">
                  <Checkbox
                    checked={eligible.length > 0 && selected.size === eligible.length}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th className="p-3 font-medium">{t("שם")}</th>
                <th className="p-3 font-medium">{t("טלפון")}</th>
                <th className="p-3 font-medium">{t("הסכמה")}</th>
                <th className="p-3 font-medium">{t("סטטוס ייבוא")}</th>
                <th className="p-3 font-medium">{t("מצב שליחה")}</th>
                <th className="p-3 font-medium">{t("סטטוס וואטסאפ")}</th>
                <th className="p-3 font-medium">{t("נשלח / נמסר / נקרא / השיב")}</th>
                <th className="p-3 font-medium">{t("הודעה אחרונה")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">{t("טוען...")}</td></tr>
              )}
              {!isLoading && (leads?.length ?? 0) === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">{t("אין לידים להצגה")}</td></tr>
              )}
              {leads?.map((l: any) => {
                const isEligible =
                  l.import_status === "ready_for_intake" && l.consent_status === "approved" && !l.opted_out_at;
                return (
                  <tr key={l.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <Checkbox
                        disabled={!isEligible}
                        checked={selected.has(l.id)}
                        onCheckedChange={() => toggle(l.id)}
                      />
                    </td>
                    <td className="p-3 font-medium">{l.full_name || "—"}</td>
                    <td className="p-3 text-muted-foreground" dir="ltr">{l.phone}</td>
                    <td className="p-3">
                      {l.opted_out_at ? (
                        <Badge variant="destructive">{t("הוסר")}</Badge>
                      ) : l.consent_status === "approved" ? (
                        <Badge variant="secondary">{t("מאושר")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("ללא הסכמה")}</Badge>
                      )}
                    </td>
                    <td className="p-3"><Badge variant="secondary">{l.import_status}</Badge></td>
                    <td className="p-3"><Badge variant="outline">{t(SEND_STATE_LABELS[l.send_state] ?? l.send_state ?? "—")}</Badge></td>
                    <td className="p-3"><Badge variant="outline">{l.whatsapp_template_status}</Badge></td>
                    <td className="p-3 text-muted-foreground text-xs" dir="ltr" title={l.last_error ?? ""}>
                      {[l.sent_at, l.delivered_at, l.read_at, l.replied_at]
                        .map((ts: string | null) => (ts ? new Date(ts).toLocaleTimeString("he-IL") : "—"))
                        .join(" / ")}
                    </td>
                    <td className="p-3 text-muted-foreground text-xs" dir="ltr">
                      {l.last_message_at ? new Date(l.last_message_at).toLocaleString("he-IL") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}