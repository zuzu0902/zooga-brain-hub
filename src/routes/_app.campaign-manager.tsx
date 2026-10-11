import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, ShieldCheck, RefreshCw, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { coreApi, CoreApiError, listAll } from "@/lib/hostinger-core/client";
import { operatorHead } from "@/lib/hostinger-core/operator-head";
import { contactDisplayName, contactMatchesSearch } from "@/lib/hostinger-core/contact-search";
import { maskPhone } from "@/lib/phone-bulk";
import { parseRows } from "@/lib/campaign-audience";
import { CoreReadState } from "@/components/operator-data";
import {
  buildRecipients, draftBlockers, renderTemplatePreview, giftLaunchBlocked, canLaunch, isPending,
  deliveryLabel, responseLabel, campaignStatusLabel, normalizeIlMobile, CAMPAIGN_ERROR_TEXT, GIFT_TEMPLATE, MAX_RECIPIENTS,
  type TemplateCampaign,
} from "@/lib/hostinger-core/template-campaigns";

export const Route = createFileRoute("/_app/campaign-manager")({
  head: () => operatorHead("מנהל קמפיינים", "קמפיינים אישיים בתבניות WhatsApp מאושרות דרך Core."),
  component: CampaignManagerPage,
});

export function campaignErrorText(e: unknown): string {
  if (e instanceof CoreApiError) {
    if (CAMPAIGN_ERROR_TEXT[e.code]) return CAMPAIGN_ERROR_TEXT[e.code];
    if (e.status === 401 || e.status === 403) return "אין הרשאה לפעולה זו";
    return `Core דחה את הבקשה (${e.code})`;
  }
  if (e instanceof Error && e.message.startsWith("template_campaign_malformed")) return "הנתונים אינם תקינים — בדקו את הטופס";
  return "לא ניתן להתחבר ל-Core כרגע";
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);

function parsePastedEntries(text: string) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split(/[,\t;]/).map(p => p.trim());
    const pi = parts.findIndex(p => normalizeIlMobile(p));
    return pi >= 0 ? { phone: parts[pi], name: parts.filter((_, i) => i !== pi).join(" ") } : { phone: l, name: "" };
  });
}

function CampaignManagerPage() {
  const qc = useQueryClient();
  const { session, loading } = useAuth();
  const authed = !loading && !!session;
  const uid = session?.user.id;

  const templatesQ = useQuery({ queryKey: ["core-templates", uid], queryFn: () => coreApi.listTemplates(), enabled: authed, retry: 1 });
  const contactsQ = useQuery({ queryKey: ["core-contacts", uid], queryFn: () => listAll(p => coreApi.listContacts(p), 5000), enabled: authed, retry: 1 });
  const campaignsQ = useQuery({ queryKey: ["core-template-campaigns", uid], queryFn: () => coreApi.listTemplateCampaigns(), enabled: authed, retry: 1,
    refetchInterval: q => (q.state.data?.some(isPending) ? 10000 : false) });

  const [name, setName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [pasted, setPasted] = useState("");
  const [fileRows, setFileRows] = useState<{ phone: string; name: string }[]>([]);
  const [fileName, setFileName] = useState("");
  const [permission, setPermission] = useState(false);
  const [basis, setBasis] = useState("");
  const [idemKey, setIdemKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [launching, setLaunching] = useState<Set<string>>(new Set());

  const giftReady = templatesQ.data?.gift_ready === true;
  const template = templatesQ.data?.templates.find(t => t.name === templateName) ?? null;
  const built = useMemo(() => buildRecipients([
    ...Object.entries(selected).map(([phone, nm]) => ({ phone, name: nm })),
    ...fileRows,
    ...parsePastedEntries(pasted),
  ]), [selected, pasted, fileRows]);
  const blockers = draftBlockers({ name, template_name: templateName, permission_confirmed: permission, consent_basis: basis, recipients: built.recipients });

  const contacts = useMemo(() => (contactsQ.data ?? []).filter((c: any) => normalizeIlMobile(c.phone) && contactMatchesSearch(c, search)).slice(0, 200), [contactsQ.data, search]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name); setError(null);
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
      setFileRows(parseRows(rows).valid);
    } catch { setFileRows([]); setError("לא ניתן לקרוא את הקובץ. ודאו שזה CSV או XLSX תקין."); }
  }

  async function createDraft() {
    setBusy(true); setError(null);
    try {
      const r = await coreApi.createTemplateCampaign({ name, template_name: templateName, idempotency_key: idemKey, permission_confirmed: permission, consent_basis: basis, recipients: built.recipients });
      toast.success(r.duplicate ? "הטיוטה כבר קיימת — לא נוצרה כפולה" : "הטיוטה נוצרה. לא נשלח דבר עד לחיצה על \"שלח\".");
      setIdemKey(newKey()); setSelected({}); setPasted(""); setFileRows([]); setFileName(""); setName(""); setPermission(false); setBasis("");
      setOpenId(r.campaign.id);
      await qc.invalidateQueries({ queryKey: ["core-template-campaigns"] });
    } catch (e) { setError(campaignErrorText(e)); }
    finally { setBusy(false); }
  }

  async function launch(c: TemplateCampaign) {
    if (launching.has(c.id) || !canLaunch(c, giftReady)) return;
    setLaunching(prev => new Set(prev).add(c.id));
    try {
      const r = await coreApi.launchTemplateCampaign(c.id);
      toast.success(r.duplicate ? "הקמפיין כבר שוגר — לא נשלח שוב" : `נכנס לתור: ${r.queued} · הושמטו: ${r.blocked}`);
      await Promise.all([qc.invalidateQueries({ queryKey: ["core-template-campaigns"] }), qc.invalidateQueries({ queryKey: ["core-template-campaign", c.id] })]);
    } catch (e) { toast.error(campaignErrorText(e)); }
    finally { setLaunching(prev => { const n = new Set(prev); n.delete(c.id); return n; }); }
  }

  return <div className="p-4 md:p-6 max-w-[1300px] mx-auto space-y-6" dir="rtl">
    <header>
      <h1 className="text-2xl font-bold">מנהל קמפיינים</h1>
      <p className="text-sm text-muted-foreground mt-1">פנייה אישית בתבנית WhatsApp מאושרת. יוצרים טיוטה, בודקים, ולוחצים "שלח". Core בודק שוב אישור תבנית, הסרות ושיחות בטיפול אנושי, ושולח אחד-אחד בהפרש 5 שניות.</p>
    </header>

    <Card className="p-5 space-y-5">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2"><Label htmlFor="cm-name">שם הקמפיין</Label><Input id="cm-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} /></div>
        <div className="space-y-2">
          <Label>תבנית מאושרת</Label>
          <CoreReadState loading={!authed || templatesQ.isPending} error={templatesQ.error} retry={() => templatesQ.refetch()} />
          {templatesQ.data && <Select value={templateName} onValueChange={setTemplateName}>
            <SelectTrigger aria-label="תבנית"><SelectValue placeholder="בחרו תבנית" /></SelectTrigger>
            <SelectContent>{templatesQ.data.templates.map(t => <SelectItem key={t.id} value={t.name}>{t.name}{t.category ? ` · ${t.category}` : ""}</SelectItem>)}
              {!templatesQ.data.templates.length && <SelectItem value="__none" disabled>אין תבניות מאושרות</SelectItem>}</SelectContent>
          </Select>}
        </div>
      </div>

      {template && <div className="rounded-md border p-3 space-y-1">
        <div className="text-xs text-muted-foreground">תצוגה מקדימה ({built.recipients[0]?.name ? "לנמען הראשון" : "שם לדוגמה"})</div>
        <p className="text-sm whitespace-pre-wrap">{renderTemplatePreview(template.body, built.recipients[0]?.name ?? "")}</p>
      </div>}
      {templateName === GIFT_TEMPLATE && giftLaunchBlocked(templateName, giftReady) && <p role="note" className="flex gap-2 text-sm text-warning-foreground bg-warning/15 rounded-md p-3"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />אפשר ליצור טיוטה ולצפות בתבנית המתנה, אבל השליחה חסומה עד שיוגדרו מנפיק קוד וקישור אמיתיים למתנה. אין להבטיח ללקוחות מתנה פעילה.</p>}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>אנשי קשר מ-Core</Label>
          <Input placeholder="חיפוש לפי שם או טלפון" value={search} onChange={e => setSearch(e.target.value)} />
          <CoreReadState loading={!authed || contactsQ.isPending} error={contactsQ.error} retry={() => contactsQ.refetch()} />
          {contactsQ.data && <div className="max-h-64 overflow-auto border rounded-md divide-y">
            {contacts.map((c: any) => { const p = normalizeIlMobile(c.phone)!; const nm = contactDisplayName(c) ?? ""; return <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
              <Checkbox checked={p in selected} onCheckedChange={v => setSelected(prev => { const n = { ...prev }; if (v === true) n[p] = nm; else delete n[p]; return n; })} />
              <span className="flex-1">{nm || "ללא שם"}</span><span dir="ltr" className="text-muted-foreground text-xs">{maskPhone(p)}</span></label>; })}
            {!contacts.length && <p className="p-3 text-sm text-muted-foreground">אין אנשי קשר תואמים</p>}
          </div>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="cm-paste">מספרים נוספים (שורה לכל נמען: טלפון, שם)</Label>
          <div className="flex items-center gap-2 text-sm"><Label htmlFor="cm-file" className="cursor-pointer text-primary">העלאת CSV / XLSX</Label><input id="cm-file" type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={e => onFile(e.target.files?.[0])} />{fileName && <span className="text-muted-foreground text-xs">{fileName} · {fileRows.length} שורות</span>}</div>
          <Textarea id="cm-paste" dir="ltr" rows={10} value={pasted} onChange={e => setPasted(e.target.value)} placeholder={"0541234567, דנה\n+972521112222, יוסי"} className="font-mono text-sm" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{built.recipients.length} נמענים תקינים · {built.invalid} לא תקינים · {built.duplicates} כפולים הוסרו{built.recipients.length > MAX_RECIPIENTS && <span className="text-destructive"> · מקסימום {MAX_RECIPIENTS}</span>}</p>

      <div className="rounded-md border p-3 space-y-2">
        <label className="flex items-start gap-2 text-sm"><Checkbox checked={permission} onCheckedChange={v => setPermission(v === true)} /><span><ShieldCheck className="inline h-4 w-4 ml-1" />אני מאשר/ת שלנמענים יש בסיס הרשאה לקבלת פנייה שיווקית. זהו אישור מפעיל — אינו אישור אישי של כל לקוח.</span></label>
        <Label htmlFor="cm-basis">מקור ההרשאה (חובה)</Label>
        <Textarea id="cm-basis" rows={2} maxLength={1000} value={basis} onChange={e => setBasis(e.target.value)} placeholder="לדוגמה: נרשמו בטופס האתר עם סימון הסכמה לדיוור, ספטמבר 2026" />
      </div>

      {blockers.length > 0 && <ul className="text-xs text-muted-foreground space-y-0.5">{blockers.map(b => <li key={b}>{b}</li>)}</ul>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy || blockers.length > 0} onClick={createDraft}>{busy ? "יוצר…" : "צור טיוטה"}</Button>
    </Card>

    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-semibold">קמפיינים</h2><Button variant="outline" size="icon" aria-label="רענן" onClick={() => campaignsQ.refetch()}><RefreshCw className="h-4 w-4" /></Button></div>
      <CoreReadState loading={!authed || campaignsQ.isPending} error={campaignsQ.error} retry={() => campaignsQ.refetch()} />
      {campaignsQ.data && !campaignsQ.data.length && <p className="text-sm text-muted-foreground">עדיין אין קמפיינים</p>}
      {campaignsQ.data && <div className="divide-y">{campaignsQ.data.map(c => <div key={c.id} className="py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button className="font-medium hover:text-primary" onClick={() => setOpenId(openId === c.id ? null : c.id)}>{c.name || "ללא שם"}</button>
          <Badge variant="outline">{campaignStatusLabel(c.status)}</Badge><span className="text-xs text-muted-foreground">{c.template_name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{c.recipient_count} נמענים · {c.sent_count} נשלחו לספק · {c.failed_count} נכשלו · {c.pending_count} ממתינים</span>
          {c.status === "draft" && <Button size="sm" className="ms-auto" disabled={launching.has(c.id) || !canLaunch(c, giftReady)} onClick={() => launch(c)}><Send className="h-4 w-4" />{launching.has(c.id) ? "שולח…" : "שלח"}</Button>}
        </div>
        {c.status === "draft" && giftLaunchBlocked(c.template_name, giftReady) && <p className="text-xs text-warning-foreground">שליחה חסומה: המתנה עדיין לא הוגדרה ב-Core.</p>}
        {openId === c.id && <CampaignDetail id={c.id} uid={uid} authed={authed} />}
      </div>)}</div>}
    </Card>
  </div>;
}

function CampaignDetail({ id, uid, authed }: { id: string; uid?: string; authed: boolean }) {
  const q = useQuery({ queryKey: ["core-template-campaign", id, uid], queryFn: () => coreApi.getTemplateCampaign(id), enabled: authed, retry: 1,
    refetchInterval: qq => (qq.state.data && isPending(qq.state.data.campaign) ? 10000 : false) });
  return <div className="border rounded-md p-3">
    <CoreReadState loading={q.isPending} error={q.error} retry={() => q.refetch()} />
    {q.data && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-right text-xs text-muted-foreground"><th className="p-2">טלפון</th><th className="p-2">שם</th><th className="p-2">מסירה</th><th className="p-2">תגובה</th><th className="p-2">נשלח</th></tr></thead>
      <tbody>{q.data.recipients.map(r => <tr key={r.phone} className="border-t"><td className="p-2" dir="ltr">{maskPhone(r.phone)}</td><td className="p-2">{r.display_name || "—"}</td><td className="p-2">{deliveryLabel(r.delivery_state)}{r.failure_code ? ` · ${r.failure_code}` : ""}</td><td className="p-2">{responseLabel(r.response_state)}</td><td className="p-2 text-xs text-muted-foreground">{r.sent_at ? new Date(r.sent_at).toLocaleString("he-IL") : "—"}</td></tr>)}</tbody></table></div>}
  </div>;
}
