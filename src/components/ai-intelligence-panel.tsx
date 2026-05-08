import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sparkles, RefreshCw, Check, X, Brain, History, AlertCircle } from "lucide-react";
import { formatRelative } from "@/lib/i18n";

const MEMORY_TYPE_LABELS: Record<string, string> = {
  fact: "עובדה",
  preference: "העדפה",
  emotion: "רגש",
  event: "אירוע",
  relationship: "מערכת יחסים",
  goal: "מטרה",
};

const MEMORY_TYPE_TONE: Record<string, string> = {
  fact: "bg-info/10 text-info border-info/30",
  preference: "bg-primary/10 text-primary border-primary/30",
  emotion: "bg-warning/10 text-warning-foreground border-warning/30",
  event: "bg-accent/40 text-foreground border-border",
  relationship: "bg-success/10 text-success border-success/30",
  goal: "bg-secondary text-secondary-foreground border-border",
};

const CATEGORY_LABELS: Record<string, string> = {
  demographics: "דמוגרפיה",
  personality: "אישיות",
  emotional_state: "מצב רגשי",
  interests: "תחומי עניין",
  lifestyle: "אורח חיים",
  relationships: "מערכות יחסים",
  communication_style: "סגנון תקשורת",
  travel_style: "סגנון נסיעות",
  social_style: "סגנון חברתי",
  sales_behavior: "התנהגות מכירה",
  engagement_behavior: "מעורבות",
  objections: "התנגדויות",
  event_preferences: "העדפות אירועים",
};

function ConfidenceDot({ score }: { score: number | null | undefined }) {
  const v = score ?? 0;
  const tone = v >= 75 ? "bg-success" : v >= 50 ? "bg-warning" : "bg-muted-foreground/40";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
      <span className={`h-1.5 w-1.5 rounded-full ${tone}`} />
      {v}%
    </span>
  );
}

export function AIIntelligencePanel({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data: memories } = useQuery({
    queryKey: ["contact-memories", contactId],
    refetchInterval: 20000,
    queryFn: async () => {
      const { data } = await supabase
        .from("contact_memories").select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const { data: history } = useQuery({
    queryKey: ["contact-history", contactId],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("contact_profile_history").select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(40);
      return data ?? [];
    },
  });

  const { data: pending } = useQuery({
    queryKey: ["contact-pending", contactId],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pending_ai_insights").select("*")
        .eq("contact_id", contactId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase.channel(`intel-${contactId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contact_memories", filter: `contact_id=eq.${contactId}` },
        () => qc.invalidateQueries({ queryKey: ["contact-memories", contactId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "contact_profile_history", filter: `contact_id=eq.${contactId}` },
        () => qc.invalidateQueries({ queryKey: ["contact-history", contactId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "pending_ai_insights", filter: `contact_id=eq.${contactId}` },
        () => qc.invalidateQueries({ queryKey: ["contact-pending", contactId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [contactId, qc]);

  async function runNow() {
    setRunning(true);
    try {
      const resp = await fetch("/api/public/intelligence/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error || "שגיאה");
      const applied = (j.applied || []).length;
      toast.success(`חילוץ הסתיים — ${applied} שדות עודכנו, ${j.pending || 0} ממתינים, ${j.memories || 0} זיכרונות`);
      qc.invalidateQueries({ queryKey: ["contact", contactId] });
      qc.invalidateQueries({ queryKey: ["contact-memories", contactId] });
      qc.invalidateQueries({ queryKey: ["contact-history", contactId] });
      qc.invalidateQueries({ queryKey: ["contact-pending", contactId] });
    } catch (e: any) {
      toast.error("שגיאה: " + (e?.message || e));
    }
    setRunning(false);
  }

  async function approvePending(row: any) {
    const value = row.proposed_value?.value;
    const field = row.field_name;
    if (!field) return;
    // simple application: overwrite
    const { data: cur } = await supabase.from("contacts").select(field).eq("id", contactId).maybeSingle();
    const oldVal = (cur as any)?.[field];
    const newVal = Array.isArray(value) && Array.isArray(oldVal)
      ? Array.from(new Set([...oldVal, ...value]))
      : value;
    const { error } = await supabase.from("contacts").update({ [field]: newVal } as any).eq("id", contactId);
    if (error) { toast.error("שגיאה: " + error.message); return; }
    await supabase.from("contact_profile_history").insert({
      contact_id: contactId, field_name: field,
      old_value: oldVal == null ? null : JSON.stringify(oldVal),
      new_value: JSON.stringify(newVal),
      changed_by: "manager_approval",
      confidence_score: row.confidence_score,
      source: "pending_insight",
    });
    await supabase.from("pending_ai_insights")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", row.id);
    toast.success("אושר ויושם");
    qc.invalidateQueries({ queryKey: ["contact", contactId] });
  }

  async function rejectPending(row: any) {
    await supabase.from("pending_ai_insights")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", row.id);
    toast.success("נדחה");
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-primary/10 text-primary">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">מנוע מודיעין שיחה</div>
            <div className="text-xs text-muted-foreground">
              רץ אוטומטית אחרי כל הודעת WhatsApp. ניתן להריץ ידנית.
            </div>
          </div>
        </div>
        <Button size="sm" onClick={runNow} disabled={running} className="gap-2">
          {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running ? "מחלץ..." : "הרץ חילוץ עכשיו"}
        </Button>
      </Card>

      {(pending?.length ?? 0) > 0 && (
        <Card className="p-4 border-warning/40 bg-warning/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-warning-foreground" />
            <h3 className="font-semibold">תובנות ממתינות לאישור ({pending!.length})</h3>
          </div>
          <div className="space-y-2">
            {pending!.map((p: any) => (
              <div key={p.id} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-background border">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{CATEGORY_LABELS[p.category] || p.category}</Badge>
                    <span className="text-sm font-medium">{p.field_name}</span>
                    <ConfidenceDot score={p.confidence_score} />
                  </div>
                  <div className="text-sm mt-1 break-words">
                    ערך מוצע: <span className="font-medium">{JSON.stringify(p.proposed_value?.value)}</span>
                  </div>
                  {p.reasoning && <div className="text-xs text-muted-foreground mt-1">{p.reasoning}</div>}
                  {p.source_message && (
                    <div className="text-xs text-muted-foreground mt-1 italic truncate">"{p.source_message}"</div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="outline" onClick={() => approvePending(p)} title="אישור">
                    <Check className="h-4 w-4 text-success" />
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => rejectPending(p)} title="דחייה">
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">זיכרונות AI</h3>
            <Badge variant="outline" className="text-[10px]">{memories?.length ?? 0}</Badge>
          </div>
          {(memories?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              עדיין אין זיכרונות. הרץ חילוץ או המתן להודעה הבאה.
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {memories!.map((m: any) => (
                <div key={m.id} className="p-2.5 rounded-lg border bg-card">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${MEMORY_TYPE_TONE[m.memory_type] || "border-border"}`}>
                      {MEMORY_TYPE_LABELS[m.memory_type] || m.memory_type}
                    </span>
                    <ConfidenceDot score={m.confidence_score} />
                  </div>
                  <div className="text-sm font-medium">{m.memory_key}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{m.memory_value}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">{formatRelative(m.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <History className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">היסטוריית שינויי פרופיל</h3>
            <Badge variant="outline" className="text-[10px]">{history?.length ?? 0}</Badge>
          </div>
          {(history?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              אין שינויים שתועדו עדיין.
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {history!.map((h: any) => (
                <div key={h.id} className="p-2.5 rounded-lg border bg-card">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium">{h.field_name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {h.changed_by === "ai_extraction" ? "AI" : h.changed_by === "manager_approval" ? "מנהל" : h.changed_by}
                      </Badge>
                      <ConfidenceDot score={h.confidence_score} />
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="line-through opacity-60">{h.old_value || "ריק"}</span>
                    {" → "}
                    <span className="text-foreground font-medium">{h.new_value}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">{formatRelative(h.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}