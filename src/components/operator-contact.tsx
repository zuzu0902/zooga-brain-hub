import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { coreApi, toCorePatch } from "@/lib/hostinger-core/client";
import { mergeOlderMessages, type WorkflowMessage } from "@/lib/hostinger-core/contact-workflow";
import { WorkflowConversation, WorkflowKnowledge, WorkflowHandoffs, WorkflowTasks } from "./contact-workflow-panels";
import { operatorTime } from "@/lib/hostinger-core/control-center";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRight, Save, Pencil, X, RefreshCw } from "lucide-react";
import { CoreReadState } from "./operator-data";
import { STATUS_LABELS, INTEREST_LABELS } from "@/lib/i18n";
import { toast } from "sonner";

export function OperatorContact({ id }: { id: string }) {
  const { session, loading } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ["core-contact", id, session?.user.id], queryFn: () => coreApi.getContact(id), enabled: !loading && !!session, retry: (n, e: any) => ![401, 403, 404].includes(e?.status) && n < 1 });
  const wfKey = ["core-contact-workflow", id, session?.user.id];
  const wf = useQuery({ queryKey: wfKey, queryFn: () => coreApi.getContactWorkflow(id), enabled: !loading && !!session, refetchInterval: (qq) => (qq.state.error ? false : 30000), retry: (n, e: any) => ![401, 403, 404].includes(e?.status) && !String(e?.message).startsWith("contact_workflow_malformed") && n < 1 });
  const [older, setOlder] = useState<{ messages: WorkflowMessage[]; cursor: string | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scopeKey = `${id}|${session?.user.id ?? ""}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  useEffect(() => { setOlder(null); setLoadingOlder(false); }, [scopeKey]);
  const messages = useMemo(() => mergeOlderMessages(older?.messages ?? [], wf.data?.messages ?? []), [older, wf.data]);
  const cursor = older ? older.cursor : wf.data?.next_cursor ?? null;
  async function loadOlder() {
    if (!cursor) return;
    const startedFor = scopeKey;
    setLoadingOlder(true);
    try { const page = await coreApi.getContactWorkflow(id, cursor); if (scopeRef.current !== startedFor) return; setOlder(prev => ({ messages: mergeOlderMessages(page.messages, prev?.messages ?? []), cursor: page.next_cursor })); }
    catch { if (scopeRef.current === startedFor) toast.error("לא ניתן לטעון הודעות קודמות כרגע"); }
    finally { if (scopeRef.current === startedFor) setLoadingOlder(false); }
  }
  const refreshAll = () => Promise.all([qc.invalidateQueries({ queryKey: ["core-contact", id] }), qc.invalidateQueries({ queryKey: ["core-contact-workflow", id] })]);
  const wfState = <CoreReadState loading={loading || !session || wf.isPending} error={wf.error} retry={() => wf.refetch()} />;
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
    <header className="flex items-start justify-between gap-3"><div><h1 className="text-2xl font-bold break-words">{c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "ללא שם"}</h1><p className="text-sm text-muted-foreground mt-1" dir="ltr">{c.phone || "—"}</p><Badge variant="secondary" className="mt-2">{STATUS_LABELS[c.status] || "לא ידוע"}</Badge></div><Button variant="outline" size="icon" aria-label="רענן איש קשר" onClick={() => { void refreshAll(); }} disabled={q.isFetching || wf.isFetching}><RefreshCw className="h-4 w-4" /></Button></header>
    <Tabs defaultValue="profile"><TabsList className="flex flex-wrap h-auto justify-start"><TabsTrigger value="profile">פרטי קשר</TabsTrigger><TabsTrigger value="conversations">שיחות</TabsTrigger><TabsTrigger value="tasks">משימות</TabsTrigger><TabsTrigger value="handoffs">טיפול מנהל</TabsTrigger><TabsTrigger value="memory">הסכמה, אינטייק וזיכרון</TabsTrigger></TabsList>
      <TabsContent value="profile" className="space-y-6 pt-4"><div className="flex justify-between items-center"><h2 className="font-semibold">פרטי קשר</h2>{editing ? <div className="flex gap-2"><Button variant="ghost" size="icon" aria-label="ביטול עריכה" disabled={saving} onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button><Button onClick={save} disabled={saving}><Save className="h-4 w-4" />{saving ? "שומר…" : "שמור"}</Button></div> : <Button variant="outline" onClick={() => { setDraft(Object.fromEntries(fields.map(([key]) => [key, String(c[key] ?? "")]))); setEditing(true); }}><Pencil className="h-4 w-4" />עריכה</Button>}</div><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">{fields.map(([key, label]) => <div key={key} className="space-y-2"><Label htmlFor={`contact-${key}`} className="text-muted-foreground">{label}</Label>{editing ? <Input id={`contact-${key}`} value={draft[key] ?? ""} disabled={saving} onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))} dir={key === "phone" || key === "email" ? "ltr" : "rtl"} /> : <p className="text-sm break-words">{c[key] || "—"}</p>}</div>)}</div><div className="border-t pt-5"><h2 className="font-semibold mb-3">תחומי עניין</h2><div className="flex gap-2 flex-wrap">{Array.isArray(c.interests) && c.interests.length ? c.interests.map((interest: string) => <Badge key={interest} variant="outline">{INTEREST_LABELS[interest] || interest}</Badge>) : <span className="text-sm text-muted-foreground">לא תועדו תחומי עניין</span>}</div><p className="text-xs text-muted-foreground mt-4">הצטרף: {operatorTime(c.created_at)}</p></div></TabsContent>
      <TabsContent value="conversations">{wfState}{wf.data && !wf.error && <WorkflowConversation messages={messages} hasOlder={!!cursor} loadingOlder={loadingOlder} onLoadOlder={loadOlder} />}</TabsContent>
      <TabsContent value="tasks">{wfState}{wf.data && !wf.error && <WorkflowTasks w={wf.data} />}</TabsContent>
      <TabsContent value="handoffs">{wfState}{wf.data && !wf.error && <WorkflowHandoffs w={wf.data} />}</TabsContent>
      <TabsContent value="memory">{wfState}{wf.data && !wf.error && <WorkflowKnowledge w={wf.data} />}</TabsContent>
    </Tabs>
  </>}</div>;
}