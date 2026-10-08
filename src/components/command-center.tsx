import { Link } from "@tanstack/react-router";
import { Users, MessageSquare, Flag, CheckSquare, RefreshCw, CircleCheck, CirclePause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useControlCenter } from "@/lib/hostinger-core/use-control-center";
import { operatorLabel, operatorTime } from "@/lib/hostinger-core/control-center";
import { ConversationList, HandoffList, TaskList, CoreReadState } from "./operator-data";

export function CommandCenter() {
  const q = useControlCenter();
  const data = q.data?.control_center;
  const readiness = q.data?.readiness;
  const stats = data ? [
    { title: "אנשים", count: data.summary.contacts, icon: Users, to: "/contacts" },
    { title: "שיחות פעילות", count: data.summary.active_conversations, icon: MessageSquare, to: "/inbox" },
    { title: "פניות לטיפול מנהל", count: data.summary.open_handoffs, icon: Flag, to: "/handoff" },
    { title: "משימות פתוחות", count: data.summary.open_tasks, icon: CheckSquare, to: "/tasks" },
  ] as const : [];
  return <div className="max-w-[1500px] mx-auto p-4 md:p-6 space-y-7" dir="rtl">
    <header className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium text-primary mb-1">Zooga OS</p><h1 className="text-3xl font-bold">מרכז שליטה</h1><p className="text-xs text-muted-foreground mt-2">{q.dataUpdatedAt ? `עודכן ${operatorTime(new Date(q.dataUpdatedAt).toISOString())}` : "ממתין לנתונים"}</p></div><Button variant="outline" className="gap-2" onClick={() => q.refetch()} disabled={q.isFetching || q.waitingForAuth}><RefreshCw className="h-4 w-4" />רענון</Button></header>
    <CoreReadState loading={q.waitingForAuth || q.isPending} error={q.error} retry={() => q.refetch()} />
    {data && !q.error && <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">{stats.map(stat => <Card key={stat.title} className="rounded-md p-4 md:p-5"><Link to={stat.to} className="block"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">{stat.title}</span><stat.icon className="h-5 w-5 text-primary shrink-0" /></div><div className="text-3xl font-bold tabular-nums mt-3">{stat.count.toLocaleString("he-IL")}</div></Link></Card>)}</div>
      <section className="grid md:grid-cols-2 gap-5 border-y border-border py-5"><div><h2 className="font-semibold mb-2">תמר</h2><Status label="קליטת הודעות" value={readiness?.inbound_enabled} />{data.tamar?.status && <p className="text-sm mt-2">{operatorLabel(data.tamar.status)}</p>}<StateCounts values={data.tamar?.shadow_by_state} prefix="מצב בדיקה" /></div><div><h2 className="font-semibold mb-2">מצב מסירה</h2><Status label="שליחה" value={readiness?.outbound_enabled} /><StateCounts values={data.delivery?.outbound_by_state} />{data.delivery?.status && <p className="text-sm mt-2">{operatorLabel(data.delivery.status)}</p>}</div></section>
      <div className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-8"><section className="min-w-0"><SectionHeader title="שיחות אחרונות" to="/inbox" /><ConversationList rows={data.conversations} /></section><div className="min-w-0 space-y-7"><section><SectionHeader title="פניות לטיפול מנהל" to="/handoff" /><HandoffList rows={data.handoffs} /></section><section><SectionHeader title="משימות פתוחות" to="/tasks" /><TaskList rows={data.tasks} /></section></div></div>
      <section className="border-t border-border pt-5"><h2 className="font-semibold mb-4">מצב המערכת</h2>{readiness ? <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4"><Status label="תעבורה חיה" value={readiness.live_traffic} /><Status label="נתוני אנשי קשר" value={readiness.adapters?.crm?.configured} /><Status label="חיבור WhatsApp" value={readiness.adapters?.meta?.configured} /><Status label="מנוע תמר" value={readiness.adapters?.llm?.configured} /></div> : <p className="text-sm text-muted-foreground">מצב המערכת לא זמין כרגע.</p>}</section>
    </>}
  </div>;
}
function SectionHeader({ title, to }: { title: string; to: "/inbox" | "/handoff" | "/tasks" }) { return <div className="flex items-center justify-between gap-3 border-b pb-3"><h2 className="text-lg font-semibold">{title}</h2><Link to={to} className="text-xs text-primary hover:underline">לרשימה</Link></div>; }
function Status({ label, value }: { label: string; value: boolean | undefined }) { const Icon = value ? CircleCheck : CirclePause; return <div className="flex items-center gap-2 text-sm"><Icon className={`h-4 w-4 shrink-0 ${value ? "text-success" : "text-muted-foreground"}`} /><span>{label}</span><span className="text-muted-foreground">{value === undefined ? "לא ידוע" : value ? "פעיל" : "לא פעיל"}</span></div>; }
function StateCounts({ values, prefix }: { values?: Record<string, number>; prefix?: string }) { return <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 mt-2">{values ? Object.entries(values).map(([state, count]) => <span key={state}>{prefix && `${prefix}: `}{operatorLabel(state)} · {count}</span>) : <span>פירוט אינו זמין</span>}</div>; }