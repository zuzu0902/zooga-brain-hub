import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertCircle, Check, X, CheckSquare, Flag, ExternalLink, UserCheck, RotateCcw } from "lucide-react";
import { formatRelative } from "@/lib/i18n";
import { useT, useLanguage } from "@/lib/language-context";
import { CreateTaskDialog } from "./_app.tasks";

export const Route = createFileRoute("/_app/handoff")({
  head: () => ({ meta: [{ title: "Handoff Console — Zooga CRM" }] }),
  component: HandoffPage,
});

function HandoffPage() {
  const t = useT();
  const { dir } = useLanguage();
  const qc = useQueryClient();
  const [taskCtx, setTaskCtx] = useState<{ title: string; description: string; contactId?: string } | null>(null);

  const { data: flagged } = useQuery({
    queryKey: ["handoff-flagged"],
    refetchInterval: 20000,
    queryFn: async () => {
      const { data } = await supabase
        .from("contacts")
        .select("id, full_name, phone, ai_recommended_next_action, last_interaction_at, sales_temperature")
        .eq("manager_attention_required", true)
        .order("last_interaction_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const { data: pending } = useQuery({
    queryKey: ["handoff-pending"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pending_ai_insights")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  async function clearFlag(id: string) {
    const { error } = await supabase.from("contacts").update({ manager_attention_required: false }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("הוסר"));
    qc.invalidateQueries({ queryKey: ["handoff-flagged"] });
  }

  async function reject(id: string) {
    const { error } = await supabase
      .from("pending_ai_insights")
      .update({ status: "rejected", resolution_state: "resolved", reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["handoff-pending"] });
  }

  async function setInsightResolution(id: string, resolution_state: string) {
    const { error } = await supabase
      .from("pending_ai_insights")
      .update({ resolution_state, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("עודכן"));
    qc.invalidateQueries({ queryKey: ["handoff-pending"] });
  }

  async function createLinkedTaskForInsight(row: any) {
    const { data: task, error } = await supabase.from("tasks").insert({
      title: `Review insight: ${row.field_name}`,
      description: `${row.reasoning || ""}\nProposed: ${JSON.stringify(row.proposed_value?.value)}`,
      contact_id: row.contact_id,
      priority: "normal",
      status: "open",
      source_kind: "pending_insight",
      source_ref_id: row.id,
      resolution_state: "open",
    } as any).select("id").maybeSingle();
    if (error || !task) return toast.error(error?.message || t("שגיאה"));
    await supabase.from("pending_ai_insights")
      .update({ linked_task_id: task.id, resolution_state: "under_human" })
      .eq("id", row.id);
    toast.success(t("נוצרה משימה משויכת"));
    qc.invalidateQueries({ queryKey: ["handoff-pending"] });
  }

  async function approve(row: any) {
    const field = row.field_name;
    const value = row.proposed_value?.value;
    if (!field) return;
    const { data: cur } = await supabase.from("contacts").select(field).eq("id", row.contact_id).maybeSingle();
    const oldVal = (cur as any)?.[field];
    const newVal = Array.isArray(value) && Array.isArray(oldVal)
      ? Array.from(new Set([...oldVal, ...value])) : value;
    const { error } = await supabase.from("contacts").update({ [field]: newVal } as any).eq("id", row.contact_id);
    if (error) return toast.error(error.message);
    await supabase.from("contact_profile_history").insert({
      contact_id: row.contact_id, field_name: field,
      old_value: oldVal == null ? null : JSON.stringify(oldVal),
      new_value: JSON.stringify(newVal),
      changed_by: "manager_approval",
      confidence_score: row.confidence_score,
      source: "handoff_console",
    });
    await supabase.from("pending_ai_insights")
      .update({ status: "approved", resolution_state: "resolved", reviewed_at: new Date().toISOString() })
      .eq("id", row.id);
    toast.success(t("אושר"));
    qc.invalidateQueries({ queryKey: ["handoff-pending"] });
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto" dir={dir}>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Flag className="h-6 w-6 text-warning-foreground" /> Handoff Console
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("תור הסלמות מ-Tamar ל-מנהל: לידים מסומנים לטיפול + תובנות AI הממתינות לאישור.")}
        </p>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <h3 className="font-semibold">{t("לידים שסומנו לטיפול מנהל")}</h3>
          <Badge variant="outline">{flagged?.length ?? 0}</Badge>
        </div>
        {(flagged?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">{t("אין לידים מסומנים כרגע")}</div>
        ) : (
          <div className="divide-y">
            {flagged!.map((c: any) => (
              <div key={c.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to="/contacts/$id" params={{ id: c.id }} className="font-medium hover:underline">
                      {c.full_name || t("ללא שם")}
                    </Link>
                    {c.sales_temperature && (
                      <Badge variant="outline" className="text-[10px]">{c.sales_temperature}</Badge>
                    )}
                    {c.last_interaction_at && (
                      <span className="text-[10px] text-muted-foreground">{formatRelative(c.last_interaction_at)}</span>
                    )}
                  </div>
                  {c.ai_recommended_next_action && (
                    <div className="text-sm text-muted-foreground mt-1">{t("פעולה מומלצת:")} {c.ai_recommended_next_action}</div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="outline" className="gap-1"
                    onClick={() => setTaskCtx({
                      title: `Follow up: ${c.full_name || c.phone || t("לקוח")}`,
                      description: c.ai_recommended_next_action || t("צריך טיפול מנהל"),
                      contactId: c.id,
                    })}>
                    <CheckSquare className="h-3.5 w-3.5" /> {t("צור משימה")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => clearFlag(c.id)}>{t("הסר סימון")}</Button>
                  <Link to="/contacts/$id" params={{ id: c.id }} className="inline-flex">
                    <Button size="icon" variant="ghost"><ExternalLink className="h-4 w-4" /></Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle className="h-4 w-4 text-warning-foreground" />
          <h3 className="font-semibold">{t("תובנות AI ממתינות (גלובלי)")}</h3>
          <Badge variant="outline">{pending?.length ?? 0}</Badge>
        </div>
        <div className="text-[11px] text-muted-foreground mb-3 flex flex-wrap gap-2">
          <Badge variant="outline" className="text-[10px]">pending</Badge>
          <Badge variant="outline" className="text-[10px]">under_human</Badge>
          <Badge variant="outline" className="text-[10px]">returned_to_ai</Badge>
          <Badge variant="outline" className="text-[10px]">resolved</Badge>
        </div>
        {(pending?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">{t("אין תובנות ממתינות")}</div>
        ) : (
          <div className="divide-y">
            {pending!.map((p: any) => (
              <div key={p.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <Badge variant="outline" className="text-[10px]">{p.category}</Badge>
                    <span className="font-medium">{p.field_name}</span>
                    <span className="text-muted-foreground">{p.confidence_score}%</span>
                    <Badge variant="secondary" className="text-[10px]">{p.resolution_state ?? "pending"}</Badge>
                    {p.linked_task_id && (
                      <Link to="/tasks" className="text-[10px] text-primary hover:underline">{t("משימה משויכת →")}</Link>
                    )}
                    <Link to="/contacts/$id" params={{ id: p.contact_id }} className="text-xs text-primary hover:underline">
                      {t("איש קשר →")}
                    </Link>
                  </div>
                  <div className="text-sm mt-1 break-words">
                    {t("ערך מוצע:")} <span className="font-medium">{JSON.stringify(p.proposed_value?.value)}</span>
                  </div>
                  {p.reasoning && <div className="text-xs text-muted-foreground mt-1">{p.reasoning}</div>}
                </div>
                <div className="flex gap-1 shrink-0 flex-wrap">
                  <Button size="icon" variant="outline" onClick={() => approve(p)} title={t("אישור")}>
                    <Check className="h-4 w-4 text-success" />
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => reject(p.id)} title={t("דחייה")}>
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1"
                    onClick={() => createLinkedTaskForInsight(p)}
                    title={t("צור משימה מקושרת + העבר לטיפול מנהל")}>
                    <CheckSquare className="h-3.5 w-3.5" /> {t("משימה מקושרת")}
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => setInsightResolution(p.id, "under_human")} title={t("סמן בטיפול מנהל")}>
                    <UserCheck className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => setInsightResolution(p.id, "returned_to_ai")} title={t("החזר ל-AI")}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <CreateTaskDialog
        open={!!taskCtx}
        onOpenChange={(v) => !v && setTaskCtx(null)}
        defaultTitle={taskCtx?.title}
        defaultDescription={taskCtx?.description}
        defaultContactId={taskCtx?.contactId}
        onCreated={() => toast.success(t("נוצרה משימה"))}
      />
    </div>
  );
}