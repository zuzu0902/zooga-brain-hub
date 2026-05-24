import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertCircle, Check, X, CheckSquare, Flag, ExternalLink } from "lucide-react";
import { formatRelative } from "@/lib/i18n";
import { CreateTaskDialog } from "./_app.tasks";

export const Route = createFileRoute("/_app/handoff")({
  head: () => ({ meta: [{ title: "Handoff Console — Zooga CRM" }] }),
  component: HandoffPage,
});

function HandoffPage() {
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
    toast.success("הוסר");
    qc.invalidateQueries({ queryKey: ["handoff-flagged"] });
  }

  async function reject(id: string) {
    const { error } = await supabase
      .from("pending_ai_insights")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
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
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", row.id);
    toast.success("אושר");
    qc.invalidateQueries({ queryKey: ["handoff-pending"] });
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Flag className="h-6 w-6 text-warning-foreground" /> Handoff Console
        </h1>
        <p className="text-sm text-muted-foreground">
          תור הסלמות מ-Tamar ל-מנהל: לידים מסומנים לטיפול + תובנות AI הממתינות לאישור.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <h3 className="font-semibold">לידים שסומנו לטיפול מנהל</h3>
          <Badge variant="outline">{flagged?.length ?? 0}</Badge>
        </div>
        {(flagged?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">אין לידים מסומנים כרגע</div>
        ) : (
          <div className="divide-y">
            {flagged!.map((c: any) => (
              <div key={c.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to="/contacts/$id" params={{ id: c.id }} className="font-medium hover:underline">
                      {c.full_name || "ללא שם"}
                    </Link>
                    {c.sales_temperature && (
                      <Badge variant="outline" className="text-[10px]">{c.sales_temperature}</Badge>
                    )}
                    {c.last_interaction_at && (
                      <span className="text-[10px] text-muted-foreground">{formatRelative(c.last_interaction_at)}</span>
                    )}
                  </div>
                  {c.ai_recommended_next_action && (
                    <div className="text-sm text-muted-foreground mt-1">פעולה מומלצת: {c.ai_recommended_next_action}</div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="outline" className="gap-1"
                    onClick={() => setTaskCtx({
                      title: `Follow up: ${c.full_name || c.phone || "לקוח"}`,
                      description: c.ai_recommended_next_action || "צריך טיפול מנהל",
                      contactId: c.id,
                    })}>
                    <CheckSquare className="h-3.5 w-3.5" /> צור משימה
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => clearFlag(c.id)}>הסר סימון</Button>
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
          <h3 className="font-semibold">תובנות AI ממתינות (גלובלי)</h3>
          <Badge variant="outline">{pending?.length ?? 0}</Badge>
        </div>
        {(pending?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">אין תובנות ממתינות</div>
        ) : (
          <div className="divide-y">
            {pending!.map((p: any) => (
              <div key={p.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <Badge variant="outline" className="text-[10px]">{p.category}</Badge>
                    <span className="font-medium">{p.field_name}</span>
                    <span className="text-muted-foreground">{p.confidence_score}%</span>
                    <Link to="/contacts/$id" params={{ id: p.contact_id }} className="text-xs text-primary hover:underline">
                      איש קשר →
                    </Link>
                  </div>
                  <div className="text-sm mt-1 break-words">
                    ערך מוצע: <span className="font-medium">{JSON.stringify(p.proposed_value?.value)}</span>
                  </div>
                  {p.reasoning && <div className="text-xs text-muted-foreground mt-1">{p.reasoning}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="outline" onClick={() => approve(p)} title="אישור">
                    <Check className="h-4 w-4 text-success" />
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => reject(p.id)} title="דחייה">
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1"
                    onClick={() => setTaskCtx({
                      title: `Review insight: ${p.field_name}`,
                      description: `${p.reasoning || ""}\nProposed: ${JSON.stringify(p.proposed_value?.value)}`,
                      contactId: p.contact_id,
                    })}>
                    <CheckSquare className="h-3.5 w-3.5" /> משימה
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
        onCreated={() => toast.success("נוצרה משימה")}
      />
    </div>
  );
}