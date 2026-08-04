import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import Papa from "papaparse";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, FileText, ShieldCheck } from "lucide-react";
import { normalizePhone } from "@/lib/phone";
import { importLeads, markLeadsReady, type ImportLeadsResult } from "@/lib/leads.functions";
import { useT, useLanguage } from "@/lib/language-context";

export const Route = createFileRoute("/_app/import-leads")({
  head: () => ({ meta: [{ title: "ייבוא לידים — Zooga CRM" }] }),
  component: ImportLeadsPage,
});

const STATUS_LABELS: Record<string, string> = {
  imported: "יובא",
  duplicate: "כפול",
  ready_for_intake: "מוכן לאינטייק",
  sent_to_tamar: "נשלח לתמר",
  replied: "הגיב",
  converted_to_contact: "הומר לאיש קשר",
  failed: "כשל",
  opted_out: "הסיר הסכמה",
};

type LeadRow = {
  full_name?: string | null;
  phone: string;
  email?: string | null;
  city?: string | null;
  region?: string | null;
  source_campaign?: string | null;
  notes?: string | null;
};

/** Free-text paste: one lead per line, "name, phone" or just a phone. */
function parsePastedLines(text: string): LeadRow[] {
  const out: LeadRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const parts = raw.split(/[,\t;]/).map((p) => p.trim()).filter(Boolean);
    const phonePart = parts.find((p) => normalizePhone(p)) ?? parts[parts.length - 1];
    const namePart = parts.filter((p) => p !== phonePart).join(" ");
    if (!phonePart) continue;
    out.push({ full_name: namePart || null, phone: phonePart });
  }
  return out;
}

function ImportLeadsPage() {
  const t = useT();
  const { dir } = useLanguage();
  const runImport = useServerFn(importLeads);
  const runMarkReady = useServerFn(markLeadsReady);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState<ImportLeadsResult | null>(null);
  const [paste, setPaste] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentSource, setConsentSource] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: leads, refetch, isLoading } = useQuery({
    queryKey: ["imported_leads", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("imported_leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (statusFilter !== "all") q = q.eq("import_status", statusFilter as any);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    if (!leads) return;
    if (selected.size === leads.length) setSelected(new Set());
    else setSelected(new Set(leads.map((l: any) => l.id)));
  }

  /**
   * All normalization, de-duplication and consent recording happen server-side
   * (`importLeads`). The client only turns a file / paste into rows.
   */
  async function submitRows(rows: LeadRow[], fileName: string | null, dryRun: boolean) {
    if (!rows.length) { toast.error(t("לא נמצאו שורות")); return; }
    if (!consentSource.trim()) { toast.error(t("חובה לציין את מקור ההסכמה")); return; }
    setUploading(true);
    try {
      const res = await runImport({
        data: {
          rows,
          source_file_name: fileName,
          consent_marketing: consent,
          consent_source: consentSource.trim(),
          dry_run: dryRun,
        },
      });
      setSummary(res);
      if (!res.ok) { toast.error(res.error ?? t("שגיאת ייבוא")); return; }
      toast.success(
        dryRun
          ? `${t("בדיקה יבשה: ")}${res.imported}${t(" שורות תקינות")}`
          : `${t("יובאו ")}${res.imported}${t(" לידים, ")}${res.updated}${t(" עודכנו, ")}${res.invalid}${t(" לא תקינים")}`,
      );
      if (!dryRun) refetch();
    } catch (err: any) {
      toast.error(t("שגיאת ייבוא: ") + (err?.message || String(err)));
    } finally {
      setUploading(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
    });
    const rows: LeadRow[] = parsed.data
      .map((row) => ({
        full_name: (row.full_name || row.name || "").trim() || null,
        phone: (row.phone || row.phone_number || row.whatsapp || "").trim(),
        email: row.email || null,
        city: row.city || null,
        region: row.region || null,
        source_campaign: row.source_campaign || null,
        notes: row.notes || null,
      }))
      .filter((r) => !!r.phone);
    await submitRows(rows, file.name, false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function markReady() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const res: any = await runMarkReady({ data: { lead_ids: ids } });
    if (!res?.ok) { toast.error(t("שגיאה: ") + (res?.error ?? "")); return; }
    toast.success(`${ids.length}${t(" לידים סומנו כמוכנים לאינטייק")} · ${res.contacts_created}${t(" אנשי קשר נוצרו")}`);
    setSelected(new Set());
    refetch();
  }

  return (
    <div className="p-6 space-y-5" dir={dir}>
      <header>
        <h1 className="text-3xl font-bold">{t("ייבוא לידים")}</h1>
        <p className="text-muted-foreground mt-1">{t("העלאת קובץ CSV של לידים והכנתם לקמפיין אינטייק")}</p>
      </header>

      <Card className="p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="flex items-start gap-2 rounded-lg border p-3">
            <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(!!v)} className="mt-0.5" />
            <div>
              <Label htmlFor="consent" className="flex items-center gap-1.5 cursor-pointer">
                <ShieldCheck className="h-3.5 w-3.5" />
                {t("יש הסכמה שיווקית ללידים האלה")}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                {t("בלי סימון — הלידים ייובאו אך לא ייכללו בשליחה יזומה בוואטסאפ.")}
              </p>
            </div>
          </div>
          <div>
            <Label>{t("מקור ההסכמה *")}</Label>
            <Input
              value={consentSource}
              onChange={(e) => setConsentSource(e.target.value)}
              placeholder={t("לדוגמה: טופס לידים פייסבוק — קמפיין אלבניה")}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="hidden"
          />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
            <Upload className="h-4 w-4" />
            {uploading ? t("מעלה...") : t("העלה CSV")}
          </Button>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <FileText className="h-3.5 w-3.5" />
            {t("עמודות חובה: ")}<code dir="ltr">full_name, phone</code>{t(" · אופציונלי: ")}{" "}
            <code dir="ltr">email, city, region, source_campaign, notes</code>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t("או הדבקת רשימה — שורה לליד: שם, טלפון")}</Label>
          <Textarea rows={4} dir="ltr" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"ישראל ישראלי, 0501234567\n0529876543"} />
          <div className="flex gap-2">
            <Button variant="outline" disabled={uploading || !paste.trim()} onClick={() => submitRows(parsePastedLines(paste), null, true)}>
              {t("בדיקה יבשה")}
            </Button>
            <Button disabled={uploading || !paste.trim()} onClick={async () => { await submitRows(parsePastedLines(paste), null, false); setPaste(""); }}>
              {t("ייבא רשימה")}
            </Button>
          </div>
        </div>

        {summary && (
          <div className="flex gap-2 flex-wrap text-sm">
            {summary.dry_run && <Badge variant="outline">{t("בדיקה יבשה")}</Badge>}
            <Badge variant="secondary">{t("סה\"כ שורות: ")}{summary.total}</Badge>
            <Badge>{t("יובאו: ")}{summary.imported}</Badge>
            <Badge variant="outline">{t("עודכנו: ")}{summary.updated}</Badge>
            <Badge variant="outline">{t("כפולים בקובץ: ")}{summary.duplicates_in_file}</Badge>
            <Badge variant="outline">{t("לא תקינים: ")}{summary.invalid}</Badge>
            <Badge variant="outline">{t("אנשי קשר נוצרו: ")}{summary.contacts_created}</Badge>
          </div>
        )}
      </Card>

      <Card className="p-4 flex items-center gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setSelected(new Set()); }}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("כל הסטטוסים")}</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{t(v)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <div className="text-sm text-muted-foreground">{t("נבחרו ")}{selected.size}</div>
        <Button onClick={markReady} disabled={selected.size === 0} variant="default">
          {t("סמן כמוכן לאינטייק")}
        </Button>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-3 w-10">
                  <Checkbox
                    checked={!!leads && leads.length > 0 && selected.size === leads.length}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th className="p-3 font-medium">{t("שם")}</th>
                <th className="p-3 font-medium">{t("טלפון")}</th>
                <th className="p-3 font-medium">{t("סטטוס")}</th>
                <th className="p-3 font-medium">{t("וואטסאפ")}</th>
                <th className="p-3 font-medium">{t("הסכמה")}</th>
                <th className="p-3 font-medium">{t("קמפיין")}</th>
                <th className="p-3 font-medium">{t("קובץ מקור")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">{t("טוען...")}</td></tr>
              )}
              {!isLoading && leads?.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">{t("אין לידים")}</td></tr>
              )}
              {leads?.map((l: any) => (
                <tr key={l.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <Checkbox
                      checked={selected.has(l.id)}
                      onCheckedChange={() => toggle(l.id)}
                    />
                  </td>
                  <td className="p-3 font-medium">{l.full_name || "—"}</td>
                  <td className="p-3 text-muted-foreground" dir="ltr">{l.phone}</td>
                  <td className="p-3"><Badge variant="secondary">{t(STATUS_LABELS[l.import_status] ?? l.import_status)}</Badge></td>
                  <td className="p-3 text-muted-foreground">{l.whatsapp_template_status}</td>
                  <td className="p-3">
                    {l.opted_out_at ? (
                      <Badge variant="destructive">{t("הוסר")}</Badge>
                    ) : l.consent_status === "approved" ? (
                      <Badge variant="secondary">{t("מאושר")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("לא ידוע")}</Badge>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{l.source_campaign || "—"}</td>
                  <td className="p-3 text-muted-foreground text-xs">{l.source_file_name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}