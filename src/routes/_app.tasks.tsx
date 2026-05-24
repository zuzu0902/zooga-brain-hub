import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Check, RotateCcw, Trash2, CheckSquare } from "lucide-react";
import { formatRelative, TASK_STATUS_LABELS, TASK_PRIORITY_LABELS } from "@/lib/i18n";

export const Route = createFileRoute("/_app/tasks")({
  head: () => ({ meta: [{ title: "משימות — Zooga CRM" }] }),
  component: TasksPage,
});

function TasksPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: tasks } = useQuery({
    queryKey: ["tasks-all", statusFilter],
    refetchInterval: 20000,
    queryFn: async () => {
      let q = supabase.from("tasks").select("*").order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data } = await q;
      return data ?? [];
    },
  });

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("עודכן");
    qc.invalidateQueries({ queryKey: ["tasks-all"] });
  }
  async function remove(id: string) {
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["tasks-all"] });
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CheckSquare className="h-6 w-6 text-primary" /> משימות
          </h1>
          <p className="text-sm text-muted-foreground">תור משימות תפעולי — מנהל ו-AI</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">הכל</SelectItem>
              <SelectItem value="open">פתוח</SelectItem>
              <SelectItem value="in_progress">בעבודה</SelectItem>
              <SelectItem value="done">הושלם</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> משימה חדשה
          </Button>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        {(tasks?.length ?? 0) === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">אין משימות בקטגוריה זו</div>
        ) : (
          <div className="divide-y">
            {tasks!.map((t: any) => (
              <div key={t.id} className="p-4 flex items-start justify-between gap-3 hover:bg-muted/30">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{t.title}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {TASK_STATUS_LABELS[t.status] || t.status}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {TASK_PRIORITY_LABELS[t.priority] || t.priority}
                    </Badge>
                    {t.contact_id && (
                      <Link
                        to="/contacts/$id"
                        params={{ id: t.contact_id }}
                        className="text-xs text-primary hover:underline"
                      >
                        איש קשר →
                      </Link>
                    )}
                  </div>
                  {t.description && (
                    <div className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap break-words">
                      {t.description}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    נוצר {formatRelative(t.created_at)}
                    {t.due_date && ` · יעד ${formatRelative(t.due_date)}`}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {t.status !== "done" ? (
                    <Button size="icon" variant="outline" onClick={() => setStatus(t.id, "done")} title="סמן כהושלם">
                      <Check className="h-4 w-4 text-success" />
                    </Button>
                  ) : (
                    <Button size="icon" variant="outline" onClick={() => setStatus(t.id, "open")} title="פתח מחדש">
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                  <Button size="icon" variant="outline" onClick={() => remove(t.id)} title="מחק">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => qc.invalidateQueries({ queryKey: ["tasks-all"] })} />
    </div>
  );
}

export function CreateTaskDialog({
  open, onOpenChange, onCreated, defaultTitle, defaultDescription, defaultContactId,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated?: () => void;
  defaultTitle?: string; defaultDescription?: string; defaultContactId?: string;
}) {
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [description, setDescription] = useState(defaultDescription ?? "");
  const [priority, setPriority] = useState("normal");

  async function save() {
    if (!title.trim()) return toast.error("נדרשת כותרת");
    const { error } = await supabase.from("tasks").insert({
      title: title.trim(),
      description: description.trim() || null,
      priority,
      status: "open",
      contact_id: defaultContactId ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success("נוצר");
    setTitle(""); setDescription(""); setPriority("normal");
    onOpenChange(false);
    onCreated?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>משימה חדשה</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="כותרת" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea placeholder="תיאור (לא חובה)" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">נמוכה</SelectItem>
              <SelectItem value="normal">רגילה</SelectItem>
              <SelectItem value="high">גבוהה</SelectItem>
              <SelectItem value="urgent">דחופה</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={save}>צור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}