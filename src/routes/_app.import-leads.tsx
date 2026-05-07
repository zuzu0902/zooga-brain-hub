import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import Papa from "papaparse";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, FileText } from "lucide-react";
import { normalizePhone, splitName } from "@/lib/phone";

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

type ImportSummary = {
  total: number;
  imported: number;
  duplicates: number;
  invalid: number;
  skipped: number;
};

function ImportLeadsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase(),
      });
      const rows = parsed.data;

      const sum: ImportSummary = { total: rows.length, imported: 0, duplicates: 0, invalid: 0, skipped: 0 };
      const toInsert: any[] = [];
      const seenPhones = new Set<string>();

      for (const row of rows) {
        const fullName = (row.full_name || row.name || "").trim();
        const phone = normalizePhone(row.phone || row.phone_number || row.whatsapp);
        if (!fullName || !phone) {
          sum.invalid++;
          continue;
        }
        if (seenPhones.has(phone)) {
          sum.skipped++;
          continue;
        }
        seenPhones.add(phone);
        const { first, last } = splitName(fullName);
        toInsert.push({
          full_name: fullName,
          first_name: first,
          last_name: last,
          phone,
          source_file_name: file.name,
          source_campaign: row.source_campaign || null,
          notes: row.notes || null,
          raw_row_data: row,
        });
      }

      // Check duplicates against contacts and existing imported_leads
      const phones = toInsert.map((r) => r.phone);
      const [{ data: existingContacts }, { data: existingLeads }] = await Promise.all([
        supabase.from("contacts").select("id, phone").in("phone", phones),
        supabase.from("imported_leads").select("phone").in("phone", phones),
      ]);

      const contactByPhone = new Map<string, string>();
      (existingContacts ?? []).forEach((c: any) => c.phone && contactByPhone.set(c.phone, c.id));
      const existingLeadPhones = new Set((existingLeads ?? []).map((l: any) => l.phone));

      const finalRows = toInsert
        .filter((r) => {
          if (existingLeadPhones.has(r.phone)) {
            sum.skipped++;
            return false;
          }
          return true;
        })
        .map((r) => {
          const matchedContact = contactByPhone.get(r.phone);
          if (matchedContact) {
            sum.duplicates++;
            return { ...r, import_status: "duplicate", contact_id: matchedContact };
          }
          sum.imported++;
          return { ...r, import_status: "imported" };
        });

      if (finalRows.length > 0) {
        const { error } = await supabase.from("imported_leads").insert(finalRows);
        if (error) throw error;
      }

      setSummary(sum);
      toast.success(`יובאו ${sum.imported} לידים, ${sum.duplicates} כפולים, ${sum.invalid} לא תקינים`);
      refetch();
    } catch (err: any) {
      toast.error("שגיאת ייבוא: " + (err?.message || String(err)));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function markReady() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const { error } = await supabase
      .from("imported_leads")
      .update({ import_status: "ready_for_intake" })
      .in("id", ids);
    if (error) {
      toast.error("שגיאה: " + error.message);
      return;
    }
    toast.success(`${ids.length} לידים סומנו כמוכנים לאינטייק`);
    setSelected(new Set());
    refetch();
  }

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <header>
        <h1 className="text-3xl font-bold">ייבוא לידים</h1>
        <p className="text-muted-foreground mt-1">העלאת קובץ CSV של לידים והכנתם לקמפיין אינטייק</p>
      </header>

      <Card className="p-5 space-y-3">
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
            {uploading ? "מעלה..." : "העלה CSV"}
          </Button>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <FileText className="h-3.5 w-3.5" />
            עמודות חובה: <code dir="ltr">full_name, phone</code> · אופציונלי:{" "}
            <code dir="ltr">email, city, region, source_campaign, notes</code>
          </div>
        </div>
        {summary && (
          <div className="flex gap-2 flex-wrap text-sm">
            <Badge variant="secondary">סה"כ שורות: {summary.total}</Badge>
            <Badge>יובאו: {summary.imported}</Badge>
            <Badge variant="outline">כפולים: {summary.duplicates}</Badge>
            <Badge variant="outline">לא תקינים: {summary.invalid}</Badge>
            <Badge variant="outline">דולגו: {summary.skipped}</Badge>
          </div>
        )}
      </Card>

      <Card className="p-4 flex items-center gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setSelected(new Set()); }}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <div className="text-sm text-muted-foreground">נבחרו {selected.size}</div>
        <Button onClick={markReady} disabled={selected.size === 0} variant="default">
          סמן כמוכן לאינטייק
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
                <th className="p-3 font-medium">שם</th>
                <th className="p-3 font-medium">טלפון</th>
                <th className="p-3 font-medium">סטטוס</th>
                <th className="p-3 font-medium">וואטסאפ</th>
                <th className="p-3 font-medium">קמפיין</th>
                <th className="p-3 font-medium">קובץ מקור</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">טוען...</td></tr>
              )}
              {!isLoading && leads?.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">אין לידים</td></tr>
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
                  <td className="p-3"><Badge variant="secondary">{STATUS_LABELS[l.import_status] ?? l.import_status}</Badge></td>
                  <td className="p-3 text-muted-foreground">{l.whatsapp_template_status}</td>
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