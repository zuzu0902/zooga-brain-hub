/**
 * PILOT CONTROL CENTER — the operator view of the canonical individual
 * pilot journey: which contacts are eligible (from an approved file), who got
 * the consent-first opener, who is awaiting a reply, who needs the single 48h
 * follow-up and who ended as "no answer". Read-only by default; every sending
 * action is explicit and one contact at a time.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, RefreshCw, Send, ListChecks } from "lucide-react";
import {
  getPilotStatus,
  importPilotBatch,
  runPilotLifecycleNow,
  sendPilotOpener,
  syncRelationshipStatusQuestion,
} from "@/lib/tamar-pilot.functions";
import { useLanguage } from "@/lib/language-context";

export const Route = createFileRoute("/_app/pilot")({
  head: () => ({
    meta: [
      { title: "מרכז פיילוט תמר — Zooga OS" },
      { name: "description", content: "ניהול מסע הפיילוט האישי של תמר: זכאות, הודעת פתיחה, מעקב ואי-מענה." },
      { property: "og:title", content: "מרכז פיילוט תמר — Zooga OS" },
      { property: "og:description", content: "ניהול מסע הפיילוט האישי של תמר בזוגה." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PilotPage,
});

function parseRows(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,\t;]/).map((p) => p.trim()).filter(Boolean);
      const phone = parts.find((p) => /\d{7,}/.test(p.replace(/\D/g, ""))) ?? parts[parts.length - 1] ?? "";
      const name = parts.filter((p) => p !== phone).join(" ");
      return { full_name: name || null, phone };
    });
}

const ACTION_BADGE: Record<string, string> = {
  none: "—",
  send_followup: "מעקב 48 שעות",
  raise_no_response_alert: "התראת אי-מענה",
};

function PilotPage() {
  const { dir, t } = useLanguage();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState("");
  const [fileName, setFileName] = useState("pilot_paste");

  const statusFn = useServerFn(getPilotStatus);
  const importFn = useServerFn(importPilotBatch);
  const openerFn = useServerFn(sendPilotOpener);
  const lifecycleFn = useServerFn(runPilotLifecycleNow);
  const syncFn = useServerFn(syncRelationshipStatusQuestion);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["pilot-status"],
    queryFn: () => statusFn({}) as Promise<any>,
  });

  const doImport = useMutation({
    mutationFn: (dryRun: boolean) =>
      importFn({ data: { rows: parseRows(paste), fileName, dryRun } }) as Promise<any>,
    onSuccess: (r) => {
      toast.success(
        r?.dry_run
          ? `${t("בדיקה יבשה: ")}${r.counts.eligible}${t(" זכאים מתוך ")}${r.counts.total}`
          : `${t("יובאו ")}${r.contacts_created + r.contacts_marked}${t(" אנשי קשר לפיילוט")}`,
      );
      if (!r?.dry_run) { setPaste(""); qc.invalidateQueries({ queryKey: ["pilot-status"] }); }
    },
    onError: (e: any) => toast.error(t("שגיאה: ") + String(e?.message ?? e)),
  });

  const sendOpener = useMutation({
    mutationFn: (contactId: string) => openerFn({ data: { contactId, dryRun: false } }) as Promise<any>,
    onSuccess: (r) => {
      r?.ok ? toast.success(t("הודעת הפתיחה נשלחה")) : toast.error(r?.reason_he ?? t("לא נשלח"));
      qc.invalidateQueries({ queryKey: ["pilot-status"] });
    },
    onError: (e: any) => toast.error(t("שגיאה: ") + String(e?.message ?? e)),
  });

  const lifecycle = useMutation({
    mutationFn: (dryRun: boolean) => lifecycleFn({ data: { dryRun } }) as Promise<any>,
    onSuccess: (r) => {
      toast.success(
        r?.dry_run
          ? `${t("בדיקה: ")}${r.items.filter((i: any) => i.decision.action !== "none").length}${t(" פעולות ממתינות")}`
          : `${t("נשלחו ")}${r.followups_sent}${t(" מעקבים · ")}${r.alerts_raised}${t(" התראות")}`,
      );
      qc.invalidateQueries({ queryKey: ["pilot-status"] });
    },
    onError: (e: any) => toast.error(t("שגיאה: ") + String(e?.message ?? e)),
  });

  const totals = data?.totals;

  return (
    <div className="p-6 space-y-5" dir={dir}>
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">{t("מרכז פיילוט תמר")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("זכאות מקובץ מאושר בלבד · פתיחה בבקשת הסכמה · מעקב יחיד אחרי 48 שעות · אחר כך התראה")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" />{t("רענון")}
          </Button>
          <Button variant="outline" onClick={() => syncFn({}).then(() => toast.success(t("שאלת המצב המשפחתי סונכרנה")))}>
            {t("סנכרן שאלת מצב משפחתי")}
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["זכאים", totals?.eligible],
          ["נשלחה פתיחה", totals?.opener_sent],
          ["ממתין לתשובה", totals?.awaiting_reply],
          ["נתנו הסכמה", totals?.consented],
          ["מעקב נדרש", totals?.followup_due],
          ["ללא מענה", totals?.no_response],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-4">
            <div className="text-xs text-muted-foreground">{t(String(label))}</div>
            <div className="text-2xl font-bold">{isLoading ? "…" : (value ?? 0)}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Upload className="h-4 w-4" />{t("ייבוא קובץ פיילוט מאושר")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("הכללה בקובץ היא סימן הזכאות התפעולי בלבד — היא אינה הסכמה שיווקית ואינה מתירה שליחה לקבוצות.")}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFileName(f.name);
            setPaste(await f.text());
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => fileRef.current?.click()}>{t("בחר קובץ")}</Button>
          <div className="text-xs text-muted-foreground self-center" dir="ltr">{fileName}</div>
        </div>
        <div className="space-y-1">
          <Label>{t("שורה לאיש קשר: שם, טלפון")}</Label>
          <Textarea rows={4} dir="ltr" value={paste} onChange={(e) => setPaste(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!paste.trim() || doImport.isPending} onClick={() => doImport.mutate(true)}>
            {t("בדיקה יבשה")}
          </Button>
          <Button disabled={!paste.trim() || doImport.isPending} onClick={() => doImport.mutate(false)}>
            {t("ייבא לפיילוט")}
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><ListChecks className="h-4 w-4" />{t("מחזור אי-מענה")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("מעקב יחיד ומאושר נשלח 48 שעות אחרי הפתיחה. אם עדיין אין מענה — האוטומציה נעצרת ונפתחת התראה ב-CRM.")}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={lifecycle.isPending} onClick={() => lifecycle.mutate(true)}>
            {t("בדיקה בלבד")}
          </Button>
          <Button disabled={lifecycle.isPending} onClick={() => lifecycle.mutate(false)}>
            {t("הרץ עכשיו")}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-3 font-medium">{t("שם")}</th>
                <th className="p-3 font-medium">{t("קובץ")}</th>
                <th className="p-3 font-medium">{t("פתיחה")}</th>
                <th className="p-3 font-medium">{t("מעקב")}</th>
                <th className="p-3 font-medium">{t("מצב")}</th>
                <th className="p-3 font-medium">{t("פעולה הבאה")}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{t("טוען...")}</td></tr>}
              {!isLoading && !data?.rows?.length && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{t("אין אנשי קשר בפיילוט")}</td></tr>
              )}
              {data?.rows?.map((r: any) => (
                <tr key={r.contact_id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3 text-xs text-muted-foreground">{r.file_name ?? "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{r.opener_sent_at?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{r.followup_sent_at?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                  <td className="p-3">
                    {r.opted_out ? <Badge variant="destructive">{t("הוסר")}</Badge>
                      : r.consent ? <Badge variant="secondary">{t("הסכים")}</Badge>
                      : r.no_response_at ? <Badge variant="outline">{t("ללא מענה")}</Badge>
                      : r.human_owned ? <Badge variant="outline">{t("בטיפול נציג")}</Badge>
                      : <Badge variant="outline">{t("ממתין")}</Badge>}
                  </td>
                  <td className="p-3 text-xs">{t(ACTION_BADGE[r.next_action] ?? r.next_action)} · {t(r.next_action_he)}</td>
                  <td className="p-3">
                    {!r.opener_sent_at && !r.opted_out && (
                      <Button size="sm" variant="outline" className="gap-1" disabled={sendOpener.isPending}
                        onClick={() => sendOpener.mutate(r.contact_id)}>
                        <Send className="h-3.5 w-3.5" />{t("שלח פתיחה")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
