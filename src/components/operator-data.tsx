import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, RefreshCw, MessageSquare, Flag, CheckSquare } from "lucide-react";
import { contactLabel, operatorLabel, operatorTime, type CoreConversation, type CoreHandoff, type CoreTask } from "@/lib/hostinger-core/control-center";
import { useControlCenter } from "@/lib/hostinger-core/use-control-center";

export function CoreReadState({ loading, error, retry }: { loading: boolean; error: unknown; retry: () => void }) {
  if (loading) return <div role="status" className="py-16 text-center text-muted-foreground">טוען נתונים…</div>;
  if (error) return <div role="alert" className="flex flex-col items-center gap-3 border border-destructive/25 rounded-md p-8 text-center"><AlertCircle className="h-6 w-6 text-destructive" /><h2 className="font-semibold">הנתונים אינם זמינים כרגע</h2><p className="text-sm text-muted-foreground">לא ניתן לקבל נתונים מ-Core. נסו שוב בעוד רגע.</p><Button variant="outline" onClick={retry}><RefreshCw className="h-4 w-4" />נסה שוב</Button></div>;
  return null;
}

export function ConversationList({ rows }: { rows: CoreConversation[] }) {
  if (!rows.length) return <Empty text="אין שיחות להצגה" />;
  return <div className="divide-y divide-border">{rows.map(row => <div key={row.id} className="flex flex-wrap items-center gap-3 py-4">
    <div className="h-9 w-9 rounded-md bg-info/10 text-info flex items-center justify-center shrink-0"><MessageSquare className="h-4 w-4" /></div>
    <div className="min-w-0 flex-1"><ContactName row={row} /><div className="flex gap-2 flex-wrap text-xs text-muted-foreground mt-1"><span>אחראי: {operatorLabel(row.ownership)}</span><span>{operatorLabel(row.direction)}</span><span>{operatorLabel(row.delivery_state)}</span></div></div>
    <time className="text-xs text-muted-foreground tabular-nums">{operatorTime(row.occurred_at || row.updated_at)}</time>
  </div>)}</div>;
}

function ContactName({ row }: { row: CoreConversation | CoreHandoff }) {
  return row.contact_id ? <Link to="/contacts/$id" params={{ id: row.contact_id }} className="font-medium break-words hover:text-primary">{contactLabel(row)}</Link> : <span className="font-medium break-words">{contactLabel(row)}</span>;
}
export function HandoffList({ rows }: { rows: CoreHandoff[] }) {
  if (!rows.length) return <Empty text="אין פניות פתוחות לטיפול מנהל" />;
  return <div className="divide-y divide-border">{rows.map(row => <div key={row.id} className="flex items-start gap-3 py-4"><Flag className="h-4 w-4 mt-1 text-warning-foreground shrink-0" /><div className="flex-1 min-w-0"><ContactName row={row} />{row.reason && <p className="text-sm text-muted-foreground break-words mt-1">{row.reason}</p>}<div className="text-xs text-muted-foreground mt-1">{operatorLabel(row.status)} · {operatorTime(row.updated_at || row.created_at)}</div></div></div>)}</div>;
}
export function TaskList({ rows }: { rows: CoreTask[] }) {
  if (!rows.length) return <Empty text="אין משימות פתוחות" />;
  return <div className="divide-y divide-border">{rows.map(row => <div key={row.id} className="flex items-start gap-3 py-4"><CheckSquare className="h-4 w-4 mt-1 text-primary shrink-0" /><div className="flex-1 min-w-0"><div className="flex flex-wrap gap-2 items-center"><span className="font-medium break-words">{row.title}</span><Badge variant="outline">{operatorLabel(row.priority)}</Badge></div>{row.description && <p className="text-sm text-muted-foreground break-words mt-1">{row.description}</p>}<div className="flex gap-3 flex-wrap text-xs text-muted-foreground mt-2"><span>{operatorLabel(row.status)} · {operatorTime(row.created_at)}</span>{row.contact_id && <Link to="/contacts/$id" params={{ id: row.contact_id }} className="text-primary">איש קשר</Link>}</div></div></div>)}</div>;
}
export function Empty({ text }: { text: string }) { return <p className="py-10 text-sm text-muted-foreground text-center">{text}</p>; }

export function OperatorQueuePage({ kind }: { kind: "conversations" | "tasks" | "handoffs" }) {
  const q = useControlCenter();
  const titles = { conversations: "שיחות", tasks: "משימות", handoffs: "טיפול מנהל" };
  return <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6" dir="rtl"><header className="flex items-center justify-between gap-3"><h1 className="text-2xl font-bold">{titles[kind]}</h1><Button variant="outline" size="icon" aria-label="רענן נתונים" disabled={q.isFetching || q.waitingForAuth} onClick={() => q.refetch()}><RefreshCw className="h-4 w-4" /></Button></header><CoreReadState loading={q.waitingForAuth || q.isPending} error={q.error} retry={() => q.refetch()} />{q.data && !q.error && <section className="border-t border-border">{kind === "conversations" ? <ConversationList rows={q.data.control_center.conversations} /> : kind === "tasks" ? <TaskList rows={q.data.control_center.tasks} /> : <HandoffList rows={q.data.control_center.handoffs} />}{kind === "tasks" && <p className="text-sm text-muted-foreground border-t pt-4">עריכת משימות אינה זמינה כרגע.</p>}</section>}</div>;
}