import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, CheckCircle2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { coreApi, listAll, CoreApiError, type CatalogLifecycle, type CoreCatalogItem } from "@/lib/hostinger-core/client";
import { operatorHead } from "@/lib/hostinger-core/operator-head";
import { tamarEligibility, matchesFilter, lifecycleOf, emptyForm, formFromItem, formToInput, catalogCurrencyOptions, type CatalogFilter, type CatalogForm } from "@/lib/hostinger-core/catalog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CoreReadState, Empty } from "@/components/operator-data";

export const Route = createFileRoute("/_app/catalog")({ head: () => operatorHead("מוצרים ואירועים", "ניהול מוצרים ואירועים בקטלוג של זוגה."), component: Catalog });

const FILTERS: { key: CatalogFilter; label: string }[] = [
  { key: "all", label: "הכל" }, { key: "active", label: "פעיל" }, { key: "draft", label: "טיוטה" },
  { key: "archived", label: "בארכיון" }, { key: "needs_link", label: "חסר קישור" }, { key: "past_date", label: "תאריך עבר" },
];
const LIFE: Record<CatalogLifecycle, string> = { active: "פעיל", draft: "טיוטה", archived: "בארכיון" };
const fmtDate = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d.toLocaleDateString("he-IL"); };
const errText = (e: unknown) => e instanceof CoreApiError ? (e.status === 401 || e.status === 403 ? "אין הרשאה לפעולה" : e.status === 400 || e.status === 422 ? "הנתונים נדחו על ידי Core — בדקו את השדות" : "השמירה נכשלה, נסו שוב") : "השמירה נכשלה, נסו שוב";

function Catalog() {
  const { session, loading } = useAuth();
  const qc = useQueryClient();
  const key = ["operator-core-catalog", session?.user.id];
  const q = useQuery({ queryKey: key, enabled: !loading && !!session, queryFn: () => listAll(p => coreApi.listCatalog(p), 5000), retry: 1 });
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [editing, setEditing] = useState<CoreCatalogItem | "new" | null>(null);
  const status = useMutation({
    mutationFn: ({ id, s }: { id: string; s: CatalogLifecycle }) => coreApi.patchCatalogItem(id, { lifecycle_status: s }),
    onSuccess: () => { toast.success("הסטטוס עודכן"); qc.invalidateQueries({ queryKey: key }); },
    onError: e => toast.error(errText(e)),
  });
  const rows = (q.data ?? []).filter(i => matchesFilter(i, filter));
  return <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto" dir="rtl">
    <header className="flex flex-wrap justify-between gap-3 items-center"><h1 className="text-2xl font-bold">מוצרים ואירועים</h1>
      <div className="flex gap-2"><Button variant="outline" asChild><Link to="/campaign-manager">מנהל קמפיינים</Link></Button><Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" />הוספת מוצר/אירוע</Button></div></header>
    <div className="flex flex-wrap gap-2">{FILTERS.map(f => <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>{f.label}{q.data && <span className="ms-1 opacity-70">{q.data.filter(i => matchesFilter(i, f.key)).length}</span>}</Button>)}</div>
    <CoreReadState loading={loading || !session || q.isPending} error={q.error} retry={() => q.refetch()} />
    {q.data && !q.error && (!rows.length ? <Empty text="אין פריטים להצגה" /> :
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{rows.map(item => {
        const life = lifecycleOf(item); const el = tamarEligibility(item);
        const date = fmtDate(item.event_date); const end = fmtDate(item.event_end_date);
        return <Card key={item.id} className="rounded-md p-5 space-y-3 flex flex-col">
          <div className="flex justify-between gap-2"><h2 className="font-semibold break-words">{item.title || "ללא שם"}</h2><Badge variant={life === "active" ? "default" : "outline"}>{LIFE[life]}</Badge></div>
          <div className="text-sm text-muted-foreground space-y-1">
            {item.category && <div>{item.category}</div>}
            <div>{date ? `${date}${end && end !== date ? ` – ${end}` : ""}` : "ללא תאריך"}</div>
            {typeof item.price === "number" && <div className="text-foreground font-medium">{new Intl.NumberFormat("he-IL", { style: "currency", currency: /^[A-Z]{3}$/.test(item.currency ?? "") ? item.currency : "ILS" }).format(item.price)}</div>}
            {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="text-primary break-all block" dir="ltr">{item.url}</a> : <div>ללא קישור</div>}
          </div>
           {typeof item.event_knowledge === "string" && item.event_knowledge.trim() && <Badge variant="outline" className="self-start">יש מידע לתמר</Badge>}
           {el.ready ? <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" />מוכן לתמר</div>
            : <div className="text-sm text-warning-foreground flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span>לא מוכן לתמר: {el.reasons.join(" · ")}</span></div>}
          <div className="flex flex-wrap gap-2 mt-auto pt-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(item)}><Pencil className="h-3.5 w-3.5" />עריכה</Button>
            {(["active", "draft", "archived"] as CatalogLifecycle[]).filter(s => s !== life).map(s =>
              <Button key={s} size="sm" variant="ghost" disabled={status.isPending} onClick={() => status.mutate({ id: item.id, s })}>{s === "active" ? "הפעלה" : s === "draft" ? "העברה לטיוטה" : "העברה לארכיון"}</Button>)}
          </div>
        </Card>;
      })}</div>)}
    {editing && <EditDialog item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: key }); }} />}
  </div>;
}

function EditDialog({ item, onClose, onSaved }: { item: CoreCatalogItem | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<CatalogForm>(() => item ? formFromItem(item) : emptyForm());
  const [errors, setErrors] = useState<string[]>([]);
  const set = <K extends keyof CatalogForm>(k: K, v: CatalogForm[K]) => setF(p => ({ ...p, [k]: v }));
  const m = useMutation({
    mutationFn: (body: NonNullable<ReturnType<typeof formToInput>["body"]>) => item ? coreApi.patchCatalogItem(item.id, body) : coreApi.createCatalogItem(body),
    onSuccess: () => { toast.success(item ? "הפריט עודכן" : "הפריט נוסף"); onSaved(); },
    onError: e => setErrors([errText(e)]),
  });
  const submit = () => { const r = formToInput(f); setErrors(r.errors); if (r.body) m.mutate(r.body); };
  return <Dialog open onOpenChange={o => !o && onClose()}><DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-auto">
    <DialogHeader><DialogTitle>{item ? "עריכת מוצר/אירוע" : "הוספת מוצר/אירוע"}</DialogTitle></DialogHeader>
    <div className="grid gap-3">
      <div><Label>שם *</Label><Input value={f.title} onChange={e => set("title", e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3"><div><Label>קטגוריה</Label><Input value={f.category} onChange={e => set("category", e.target.value)} /></div>
        <div><Label>סטטוס</Label><select className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={f.lifecycle_status} onChange={e => set("lifecycle_status", e.target.value as CatalogLifecycle)}>{Object.entries(LIFE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div></div>
      <div><Label>קישור (https)</Label><Input dir="ltr" value={f.url} onChange={e => set("url", e.target.value)} placeholder="https://" /></div>
      <div><Label>תיאור</Label><Textarea rows={3} value={f.description} onChange={e => set("description", e.target.value)} /></div>
      <div><Label htmlFor="catalog-event-knowledge">מידע לתמר על האירוע</Label><Textarea id="catalog-event-knowledge" name="event_knowledge" rows={5} value={f.event_knowledge} onChange={e => set("event_knowledge", e.target.value)} placeholder="מה קורה באירוע, קהל יעד, מיקום ולו״ז, תנאים, ומה מותר או אסור להבטיח — עובדות מאומתות בלבד" /></div>
      <div className="grid grid-cols-2 gap-3"><div><Label>תאריך התחלה</Label><Input type="datetime-local" value={f.event_date} onChange={e => set("event_date", e.target.value)} /></div>
        <div><Label>תאריך סיום</Label><Input type="datetime-local" value={f.event_end_date} onChange={e => set("event_end_date", e.target.value)} /></div></div>
      <div className="grid grid-cols-2 gap-3"><div><Label>מחיר</Label><Input type="number" min={0} value={f.price} onChange={e => set("price", e.target.value)} /></div>
         <div><Label htmlFor="catalog-currency">מטבע</Label><Select dir="rtl" value={f.currency} onValueChange={v => set("currency", v)}><SelectTrigger id="catalog-currency"><SelectValue /></SelectTrigger><SelectContent>{catalogCurrencyOptions(f.currency).map(option => <SelectItem key={option.code} value={option.code}>{option.label}</SelectItem>)}</SelectContent></Select></div></div>
      <label className="flex items-center gap-3 text-sm"><Switch checked={f.sellable} onCheckedChange={v => set("sellable", v)} />זמין למכירה</label>
      {errors.length > 0 && <ul role="alert" className="text-sm text-destructive list-disc ps-5">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
    </div>
    <DialogFooter className="gap-2"><Button variant="outline" onClick={onClose}>ביטול</Button><Button disabled={m.isPending} onClick={submit}>{m.isPending ? "שומר…" : "שמירה"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
