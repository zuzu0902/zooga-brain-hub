import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronRight, Upload, ShieldCheck } from "lucide-react";
import { coreApi, CoreApiError } from "@/lib/hostinger-core/client";
import { maskPhone } from "@/lib/phone-bulk";
import {
  parseRows, parsePasted, mergeResults, renderScript,
  DEFAULT_OPENING_SCRIPT, TAMAR_FOLLOW_UP_INSTRUCTION, type AudienceResult,
} from "@/lib/campaign-audience";

export const Route = createFileRoute("/_app/campaign-manager")({
  head: () => ({ meta: [{ title: "מנהל קמפיינים — Zooga CRM" }] }),
  component: CampaignManagerPage,
});

const EMPTY: AudienceResult = { valid: [], invalid: [], duplicates: 0 };

const ERRORS: Record<string, string> = {
  not_signed_in: "אינך מחובר/ת — התחבר/י מחדש ונסה/י שוב.",
  admin_unauthorized: "אין הרשאת מנהל לפעולה זו.",
};

function describeError(e: unknown): string {
  if (e instanceof CoreApiError) {
    if (ERRORS[e.code]) return ERRORS[e.code];
    if (e.status === 401 || e.status === 403) return "השרת דחה את ההרשאה.";
    if (e.status === 400 || e.status === 422) return `השרת דחה את נתוני הקמפיין (${e.code}).`;
    if (e.status === 409) return `בקשה כפולה או מתנגשת (${e.code}).`;
    return `שגיאה מהשרת (${e.status} · ${e.code}).`;
  }
  return "לא ניתן להתחבר לשרת Hostinger Core.";
}

function CampaignManagerPage() {
  const [fileRes, setFileRes] = useState<AudienceResult>(EMPTY);
  const [fileName, setFileName] = useState("");
  const [pasted, setPasted] = useState("");
  const [name, setName] = useState("");
  const [script, setScript] = useState(DEFAULT_OPENING_SCRIPT);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ batch: string; count: number; status: string } | null>(null);

  const audience = useMemo(() => mergeResults(fileRes, pasted.trim() ? parsePasted(pasted) : EMPTY), [fileRes, pasted]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    try {
      let rows: unknown[][];
      if (/\.xlsx?$/i.test(f.name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false }) as unknown[][];
      } else {
        const Papa = (await import("papaparse")).default;
        rows = Papa.parse<string[]>(await f.text(), { skipEmptyLines: true }).data;
      }
      setFileRes(parseRows(rows));
    } catch {
      setFileRes(EMPTY);
      setError("לא ניתן לקרוא את הקובץ. ודא/י שזה CSV או XLSX תקין.");
    }
  }

  const canSubmit = !busy && confirmed && name.trim() && script.trim() && audience.valid.length > 0;

  async function submit() {
    setError(null); setResult(null); setBusy(true);
    try {
      const res = await coreApi.createOutboundCampaign({
        idempotency_key: crypto.randomUUID(),
        campaign_name: name.trim(),
        opening_script: script,
        tamar_follow_up_instruction: TAMAR_FOLLOW_UP_INSTRUCTION,
        recipients: audience.valid.map((r) => ({ name: r.name, phone: r.phone })),
      });
      const b = res?.campaign ?? res;
      setResult({
        batch: String(b?.batch_id ?? b?.id ?? res?.batch_id ?? "—"),
        count: Number(b?.recipient_count ?? res?.recipient_count ?? audience.valid.length),
        status: String(b?.status ?? res?.status ?? "held_for_approval"),
      });
      setConfirmed(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const samples = (audience.valid.length ? audience.valid : [{ name: "דנה", phone: "" }]).slice(0, 3);

  return (
    <div className="p-6 space-y-5 max-w-5xl" dir="rtl">
      <nav className="text-sm text-muted-foreground flex items-center gap-1">
        <Link to="/campaigns" className="hover:text-foreground">קמפיינים</Link>
        <ChevronRight className="h-3 w-3 rotate-180" />
        <span className="text-foreground">מנהל קמפיינים</span>
      </nav>
      <header>
        <h1 className="text-3xl font-bold tracking-tight">מנהל קמפיינים — פנייה אישית</h1>
        <p className="text-muted-foreground mt-1">יוצר טיוטות הממתינות לאישור בלבד. שום הודעה לא נשלחת מכאן.</p>
      </header>

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold">1. קהל יעד</h2>
        <label className="flex items-center gap-2 border border-dashed rounded-md p-4 cursor-pointer hover:bg-muted/40">
          <Upload className="h-4 w-4" />
          <span className="text-sm">{fileName || "העלאת קובץ CSV או XLSX (עמודות שם / טלפון)"}</span>
          <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <Textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)}
          placeholder={"או הדבק/י כאן — שורה לכל איש קשר:\nדנה, 054-1234567\n0521112222"} />
        <div className="flex gap-2 flex-wrap text-sm">
          <Badge variant="outline">תקינים: {audience.valid.length}</Badge>
          <Badge variant="outline">לא תקינים: {audience.invalid.length}</Badge>
          <Badge variant="outline">כפולים: {audience.duplicates}</Badge>
        </div>
        {audience.valid.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr className="text-right"><th className="p-2">שם</th><th className="p-2">טלפון</th></tr></thead>
            <tbody>
              {audience.valid.slice(0, 5).map((r) => (
                <tr key={r.phone} className="border-t"><td className="p-2">{r.name || "—"}</td><td className="p-2" dir="ltr">{maskPhone(r.phone)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {audience.invalid.length > 0 && (
          <p className="text-xs text-muted-foreground">לא תקינים: {audience.invalid.slice(0, 5).join(" · ")}{audience.invalid.length > 5 ? " …" : ""}</p>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">2. שם הקמפיין</h2>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: חברים חדשים — אוקטובר" maxLength={120} />
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">3. תסריט פתיחה של תמר</h2>
        <p className="text-xs text-muted-foreground">השתמש/י ב-[שם] כדי להכניס את שם איש הקשר.</p>
        <Textarea rows={8} value={script} onChange={(e) => setScript(e.target.value)} />
        <div className="space-y-2">
          <div className="text-sm font-medium">תצוגה מקדימה</div>
          {samples.map((s, i) => (
            <div key={i} className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{renderScript(script, s.name)}</div>
          ))}
        </div>
      </Card>

      <Card className="p-5 space-y-2">
        <h2 className="font-semibold">4. התנהגות המשך של תמר (הנחיה פנימית)</h2>
        <div className="rounded-md border bg-muted/40 p-3 text-sm">{TAMAR_FOLLOW_UP_INSTRUCTION}</div>
        <p className="text-xs text-muted-foreground">הנחיה לתמר בלבד — לא מתווספת להודעת הפתיחה ללקוח.</p>
      </Card>

      <Card className="p-5 space-y-4">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
          <span>
            אני מבין/ה שפעולה זו <strong>אינה שולחת הודעות</strong>. היא יוצרת רשומות במצב
            <span dir="ltr"> held_for_approval </span>בלבד, וכל נמען דורש בדיקת הסכמה ואישור לפני שליחה כלשהי.
          </span>
        </label>
        <Button disabled={!canSubmit} onClick={submit} className="gap-2">
          <ShieldCheck className="h-4 w-4" /> {busy ? "שולח…" : "שלח לתור אישור"}
        </Button>
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {result && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm space-y-1">
            <div>נוצר בהצלחה — לא נשלחה אף הודעה.</div>
            <div>מזהה אצווה: <span dir="ltr" className="font-mono">{result.batch}</span></div>
            <div>נמענים: {result.count}</div>
            <div>סטטוס: <Badge variant="outline" dir="ltr">{result.status}</Badge></div>
          </div>
        )}
      </Card>
    </div>
  );
}
