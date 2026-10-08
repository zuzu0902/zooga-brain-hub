import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { coreApi, toCorePatch } from "@/lib/hostinger-core/client";
import { useControlCenter } from "@/lib/hostinger-core/use-control-center";
import { operatorTime } from "@/lib/hostinger-core/control-center";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRight, Save, Pencil, X, RefreshCw } from "lucide-react";
import { CoreReadState, ConversationList, TaskList, HandoffList } from "./operator-data";
import { STATUS_LABELS, INTEREST_LABELS } from "@/lib/i18n";
import { toast } from "sonner";

export function OperatorContact({ id }: { id: string }) {
  const { session, loading } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ["core-contact", id, session?.user.id], queryFn: () => coreApi.getContact(id), enabled: !loading && !!session, retry: (n, e: any) => ![401, 403, 404].includes(e?.status) && n < 1 });
  const center = useControlCenter();
  const c = q.data;
  const fields = [["first_name", "שם פרטי"], ["last_name", "שם משפחה"], ["phone", "טלפון"], ["email", "אימייל"], ["city", "עיר"], ["region", "אזור"]] as const;
  async function save() {
    setSaving(true);
    try {
      await coreApi.patchContact(id, toCorePatch(draft));
      await Promise.all([qc.invalidateQueries({ queryKey: ["core-contact", id] }), qc.invalidateQueries({ queryKey: ["core-contacts"] })]);
      setEditing(false); toast.success("פרטי הקשר עודכנו");
    } catch { toast.error("לא ניתן לשמור כרגע. נסו שוב."); }
    finally { setSaving(false); }
  }
  return <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6" dir="rtl"><Link to="/contacts" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowRight className="h-4 w-4" />חזרה לאנשים</Link><CoreReadState loading={loading || !session || q.isPending} error={q.error} retry={() => q.refetch()} />{c && !q.error && <>
    <header className="flex items-start justify-between gap-3"><div><h1 className="text-2xl font-bold break-words">{c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "ללא שם"}</h1><p className="text-sm text-muted-foreground mt-1" dir="ltr">{c.phone || "—"}</p><Badge variant="secondary" className="mt-2">{STATUS_LABELS[c.status] || "לא ידוע"}</Badge></div><Button variant="outline" size="icon" aria-label="רענן איש קשר" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className="h-4 w-4" /></Button></header>
    <Tabs defaultValue="profile"><TabsList className="flex flex-wrap h-auto justify-start"><TabsTrigger value="profile">פרטי קשר</TabsTrigger><TabsTrigger value="conversations">שיחות</TabsTrigger><TabsTrigger value="tasks">משימות</TabsTrigger><TabsTrigger value="handoffs">טיפול מנהל</TabsTrigger><TabsTrigger value="memory">זיכרון ואינטייק</TabsTrigger></TabsList>
      <TabsContent value="profile" className="space-y-6 pt-4"><div className="flex justify-between items-center"><h2 className="font-semibold">פרטי קשר</h2>{editing ? <div className="flex gap-2"><Button variant="ghost" size="icon" aria-label="ביטול עריכה" disabled={saving} onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button><Button onClick={save} disabled={saving}><Save className="h-4 w-4" />{saving ? "שומר…" : "שמור"}</Button></div> : <Button variant="outline" onClick={() => { setDraft(Object.fromEntries(fields.map(([key]) => [key, String(c[key] ?? "")]))); setEditing(true); }}><Pencil className="h-4 w-4" />עריכה</Button>}</div><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">{fields.map(([key, label]) => <div key={key} className="space-y-2"><Label htmlFor={`contact-${key}`} className="text-muted-foreground">{label}</Label>{editing ? <Input id={`contact-${key}`} value={draft[key] ?? ""} disabled={saving} onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))} dir={key === "phone" || key === "email" ? "ltr" : "rtl"} /> : <p className="text-sm break-words">{c[key] || "—"}</p>}</div>)}</div><div className="border-t pt-5"><h2 className="font-semibold mb-3">תחומי עניין</h2><div className="flex gap-2 flex-wrap">{Array.isArray(c.interests) && c.interests.length ? c.interests.map((interest: string) => <Badge key={interest} variant="outline">{INTEREST_LABELS[interest] || interest}</Badge>) : <span className="text-sm text-muted-foreground">לא תועדו תחומי עניין</span>}</div><p className="text-xs text-muted-foreground mt-4">הצטרף: {operatorTime(c.created_at)}</p></div></TabsContent>
      <TabsContent value="conversations"><CoreReadState loading={center.waitingForAuth || center.isPending} error={center.error} retry={() => center.refetch()} />{center.data && !center.error && <><ConversationList rows={center.data.control_center.conversations.filter(row => row.contact_id === id)} /><p className="text-sm text-muted-foreground border-t pt-4">רצף השיחה המלא אינו זמין כרגע. מוצגות השיחות האחרונות שהתקבלו מ-Core.</p></>}</TabsContent>
      <TabsContent value="tasks"><CoreReadState loading={center.waitingForAuth || center.isPending} error={center.error} retry={() => center.refetch()} />{center.data && !center.error && <><TaskList rows={center.data.control_center.tasks.filter(row => row.contact_id === id)} /><p className="text-sm text-muted-foreground border-t pt-4">עריכת משימות אינה זמינה כרגע.</p></>}</TabsContent>
      <TabsContent value="handoffs"><CoreReadState loading={center.waitingForAuth || center.isPending} error={center.error} retry={() => center.refetch()} />{center.data && !center.error && <><HandoffList rows={center.data.control_center.handoffs.filter(row => row.contact_id === id)} /><p className="text-sm text-muted-foreground border-t pt-4">שחרור טיפול מנהל אינו זמין כאן כרגע.</p></>}</TabsContent>
      <TabsContent value="memory"><p className="py-8 text-sm text-muted-foreground">זיכרון, תשובות אינטייק והיסטוריה מלאה אינם זמינים כרגע ב-Core.</p></TabsContent>
    </Tabs>
  </>}</div>;
}