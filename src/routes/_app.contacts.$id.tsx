import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowRight, Plus, Save, X, MessageSquare, StickyNote,
  CheckSquare, Flag, Phone, Mail, MapPin, Calendar, ShieldCheck,
  Sparkles, AlertCircle, Trash2, ExternalLink,
  Brain, Heart, Zap, Clock, User, Activity, TrendingUp, Target,
  Lightbulb, History as HistoryIcon, ChevronRight, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import {
  STATUS_LABELS, SOURCE_LABELS, INTEREST_LABELS, LIFESTYLE_LABELS,
  ALL_INTERESTS, ALL_LIFESTYLE, INTERACTION_TYPE_LABELS,
  SALES_TEMP_LABELS, SALES_TEMP_TONE,
  TASK_STATUS_LABELS, TASK_PRIORITY_LABELS,
  formatDate, formatRelative,
} from "@/lib/i18n";
import { AIIntelligencePanel } from "@/components/ai-intelligence-panel";

export const Route = createFileRoute("/_app/contacts/$id")({
  head: () => ({ meta: [{ title: "פרופיל איש קשר — Zooga CRM" }] }),
  component: ContactProfile,
});

function ContactProfile() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const { data: contact, isLoading } = useQuery({
    queryKey: ["contact", id],
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: interactions } = useQuery({
    queryKey: ["interactions", id],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await supabase
        .from("interactions")
        .select("*")
        .eq("contact_id", id)
        .order("timestamp", { ascending: false });
      return data ?? [];
    },
  });

  const { data: tasks } = useQuery({
    queryKey: ["tasks", id],
    queryFn: async () => {
      const { data } = await supabase.from("tasks").select("*").eq("contact_id", id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: webhookLogs } = useQuery({
    queryKey: ["webhook-logs-for", contact?.phone],
    enabled: !!contact?.phone,
    queryFn: async () => {
      const { data } = await supabase
        .from("webhook_logs").select("*")
        .order("created_at", { ascending: false }).limit(200);
      return (data ?? []).filter((l: any) => {
        const p = l.payload || {};
        const candidates = [p.phone, p.whatsapp_number, p?.from?.phone].filter(Boolean);
        return candidates.some((c: string) => normalizeP(c) === normalizeP(contact!.phone));
      });
    },
  });

  useEffect(() => {
    const ch = supabase.channel(`c-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts", filter: `id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["contact", id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "interactions", filter: `contact_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["interactions", id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  const [interactionOpen, setInteractionOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  async function update(patch: any) {
    const { error } = await supabase.from("contacts").update(patch).eq("id", id);
    if (error) { toast.error("שגיאה: " + error.message); return; }
    toast.success("עודכן");
    qc.invalidateQueries({ queryKey: ["contact", id] });
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">טוען...</div>;
  if (!contact) return <div className="p-6">איש קשר לא נמצא</div>;

  const initials = (contact.full_name || contact.first_name || "?").trim().slice(0, 1);

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <Link to="/contacts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowRight className="h-4 w-4" /> חזרה לרשימה
      </Link>

      {/* Header card */}
      <Card className="p-6 shadow-[var(--shadow-elevated)]">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-4 flex-1 min-w-[280px]">
            <div
              className="h-16 w-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-primary-foreground shrink-0 shadow-[var(--shadow-warm)]"
              style={{ background: "var(--gradient-warm)" }}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{contact.full_name || "ללא שם"}</h1>
                {contact.manager_attention_required && (
                  <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> דורש טיפול מנהל</Badge>
                )}
              </div>
              <div className="flex items-center gap-3 mt-2 flex-wrap text-sm text-muted-foreground">
                {contact.phone && <span className="inline-flex items-center gap-1.5" dir="ltr"><Phone className="h-3.5 w-3.5" />{contact.phone}</span>}
                {contact.email && <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{contact.email}</span>}
                {(contact.city || contact.region) && (
                  <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{[contact.region, contact.city].filter(Boolean).join(" · ")}</span>
                )}
                <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{contact.last_interaction_at ? `אחרון: ${formatRelative(contact.last_interaction_at)}` : "ללא אינטראקציות"}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                <Badge variant="outline">{SOURCE_LABELS[contact.source] || contact.source}</Badge>
                <Badge variant="secondary">{STATUS_LABELS[contact.status] || contact.status}</Badge>
                {contact.sales_temperature && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${SALES_TEMP_TONE[contact.sales_temperature] || "border-border"}`}>
                    טמפ׳: {SALES_TEMP_LABELS[contact.sales_temperature]}
                  </span>
                )}
                {contact.consent_marketing
                  ? <Badge className="gap-1 bg-success text-success-foreground hover:bg-success"><ShieldCheck className="h-3 w-3" /> הסכמה</Badge>
                  : <Badge variant="outline" className="text-muted-foreground">ללא הסכמה</Badge>}
                {(contact.tags || []).slice(0, 4).map((t: string) => (
                  <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2 min-w-[240px]">
            <Button
              size="sm"
              variant="default"
              className="gap-1.5"
              onClick={() => window.open(`/contacts/${id}`, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-4 w-4" />
              פתח בחלון חדש (להדפסה / PDF)
            </Button>
            <Select value={contact.status} onValueChange={(v) => update({ status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setInteractionOpen(true)}>
                <MessageSquare className="h-3.5 w-3.5" /> שלח הודעה
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setInteractionOpen(true)}>
                <StickyNote className="h-3.5 w-3.5" /> הוסף הערה
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTaskOpen(true)}>
                <CheckSquare className="h-3.5 w-3.5" /> פתח משימה
              </Button>
              <Button
                size="sm"
                variant={contact.manager_attention_required ? "default" : "outline"}
                className="gap-1.5"
                onClick={() => update({ manager_attention_required: !contact.manager_attention_required })}
              >
                <Flag className="h-3.5 w-3.5" /> {contact.manager_attention_required ? "בטל סימון" : "סמן לטיפול"}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <SectionHeading>סקירה כללית</SectionHeading>
      <OverviewTab contact={contact} update={update} />

      <SectionHeading>תובנות AI</SectionHeading>
      <AITab contact={contact} update={update} />

      <SectionHeading>מנוע מודיעין שיחה</SectionHeading>
      <AIIntelligencePanel contactId={id} />

      <SectionHeading>פרופיל אישי</SectionHeading>
      <PersonalTab contact={contact} update={update} />

      <SectionHeading>שיחות ואינטראקציות</SectionHeading>
      <ConversationsTab interactions={interactions ?? []} onAdd={() => setInteractionOpen(true)} />

      <SectionHeading>פעילות ומכירות</SectionHeading>
      <SalesTab contact={contact} update={update} />

      <SectionHeading>הערות ומשימות</SectionHeading>
      <NotesTasksTab
        contact={contact}
        update={update}
        tasks={tasks ?? []}
        onTaskChange={() => qc.invalidateQueries({ queryKey: ["tasks", id] })}
        contactId={id}
        openTask={() => setTaskOpen(true)}
      />

      <SectionHeading>נתונים גולמיים</SectionHeading>
      <RawTab contact={contact} webhookLogs={webhookLogs ?? []} />

      <AddInteractionDialog
        open={interactionOpen}
        onOpenChange={setInteractionOpen}
        contactId={id}
        onAdded={() => qc.invalidateQueries({ queryKey: ["interactions", id] })}
      />
      <AddTaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        contactId={id}
        onAdded={() => qc.invalidateQueries({ queryKey: ["tasks", id] })}
      />
    </div>
  );
}

/* ---------- shared building blocks ---------- */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-4 pb-1 border-b border-border/60">
      <h2 className="text-lg font-bold tracking-tight">{children}</h2>
    </div>
  );
}

function StatCard({ label, value, hint, tone }: { label: string; value: any; hint?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`text-xl font-semibold mt-1.5 ${tone || ""}`}>{value ?? "—"}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">{children}</div>;
}

function InfoRow({ label, value, dir }: { label: string; value: any; dir?: string }) {
  return (
    <div className="flex justify-between gap-3 py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right" dir={dir as any}>{value || "—"}</span>
    </div>
  );
}

function EditableField({ label, value, onSave, type = "text", dir, multiline }: any) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  const dirty = String(v) !== String(value ?? "");
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        {multiline
          ? <Textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} />
          : <Input value={v} type={type} dir={dir} onChange={(e) => setV(e.target.value)} />}
        {dirty && (
          <Button size="icon" variant="outline" onClick={() => onSave(v)}>
            <Save className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ChipPicker({ all, labels, selected, onChange }: any) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((k: string) => {
        const on = (selected || []).includes(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(on ? (selected || []).filter((x: string) => x !== k) : [...(selected || []), k])}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
              on ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
            }`}
          >
            {labels?.[k] || k}
          </button>
        );
      })}
    </div>
  );
}

function FreeChipEditor({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState("");
  const list = value || [];
  function add() {
    const t = input.trim();
    if (!t || list.includes(t)) return;
    onChange([...list, t]); setInput("");
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {list.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1 pr-2">
            {t}
            <button onClick={() => onChange(list.filter((x) => x !== t))}><X className="h-3 w-3" /></button>
          </Badge>
        ))}
        {list.length === 0 && <span className="text-xs text-muted-foreground">אין ערכים</span>}
      </div>
      <div className="flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); }}} />
        <Button size="sm" onClick={add}>הוסף</Button>
      </div>
    </div>
  );
}

/* ---------- Tabs ---------- */

function OverviewTab({ contact, update }: any) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="סטטוס לקוח" value={STATUS_LABELS[contact.status] || contact.status} />
        <StatCard label="מקור" value={SOURCE_LABELS[contact.source] || contact.source} />
        <StatCard label="מעורבות" value={`${contact.engagement_score ?? 0}/100`} />
        <StatCard label="טמפ׳ מכירה" value={SALES_TEMP_LABELS[contact.sales_temperature] || "—"} />
        <StatCard
          label="פעולה הבאה"
          value={contact.ai_recommended_next_action ? "המלצה זמינה" : "—"}
          hint={contact.ai_recommended_next_action || undefined}
        />
        <StatCard
          label="טיפול מנהל"
          value={contact.manager_attention_required ? "נדרש" : "לא נדרש"}
          tone={contact.manager_attention_required ? "text-destructive" : ""}
        />
      </div>

      <Card className="p-5">
        <SectionTitle>תחומי עניין עיקריים</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {(contact.interests || []).length === 0 && <span className="text-sm text-muted-foreground">לא תועדו תחומי עניין</span>}
          {(contact.interests || []).map((i: string) => (
            <Badge key={i} variant="secondary">{INTEREST_LABELS[i] || i}</Badge>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <SectionTitle>פרטי קשר</SectionTitle>
          <EditableField label="שם פרטי" value={contact.first_name} onSave={(v: string) => update({ first_name: v })} />
          <div className="h-3" />
          <EditableField label="שם משפחה" value={contact.last_name} onSave={(v: string) => update({ last_name: v })} />
          <div className="h-3" />
          <EditableField label="טלפון" value={contact.phone} dir="ltr" onSave={(v: string) => update({ phone: v || null })} />
          <div className="h-3" />
          <EditableField label="וואטסאפ" value={contact.whatsapp_number} dir="ltr" onSave={(v: string) => update({ whatsapp_number: v || null })} />
          <div className="h-3" />
          <EditableField label="אימייל" value={contact.email} dir="ltr" onSave={(v: string) => update({ email: v || null })} />
        </Card>

        <Card className="p-5">
          <SectionTitle>פרטים אישיים</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <EditableField label="עיר" value={contact.city} onSave={(v: string) => update({ city: v })} />
            <EditableField label="אזור" value={contact.region} onSave={(v: string) => update({ region: v })} />
            <EditableField label="גיל" type="number" value={contact.age} onSave={(v: string) => update({ age: v ? Number(v) : null })} />
            <EditableField label="טווח גיל" value={contact.age_range} onSave={(v: string) => update({ age_range: v })} />
            <EditableField label="תאריך לידה" type="date" value={contact.birth_date} onSave={(v: string) => update({ birth_date: v || null })} />
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">מגדר</Label>
              <Select value={contact.gender ?? ""} onValueChange={(v) => update({ gender: v || null })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">זכר</SelectItem>
                  <SelectItem value="female">נקבה</SelectItem>
                  <SelectItem value="other">אחר</SelectItem>
                  <SelectItem value="prefer_not_to_say">לא לציין</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <EditableField label="סטטוס משפחתי" value={contact.relationship_status} onSave={(v: string) => update({ relationship_status: v })} />
            <EditableField label="סגנון שפה" value={contact.preferred_language_style} onSave={(v: string) => update({ preferred_language_style: v })} />
          </div>
          <div className="flex items-center justify-between mt-4 p-3 rounded-lg border">
            <div>
              <div className="text-sm font-medium">הסכמה לשיווק</div>
              <div className="text-xs text-muted-foreground">
                {contact.consent_date ? `אושר ב-${formatDate(contact.consent_date)}` : "לא אושר"}
              </div>
            </div>
            <Switch
              checked={!!contact.consent_marketing}
              onCheckedChange={(v) => update({ consent_marketing: v, consent_date: v ? new Date().toISOString() : null })}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function ConversationsTab({ interactions, onAdd }: any) {
  const groups = useMemo(() => {
    const g: Record<string, any[]> = {};
    interactions.forEach((i: any) => {
      const key = new Date(i.timestamp).toLocaleDateString("he-IL");
      (g[key] = g[key] || []).push(i);
    });
    return Object.entries(g);
  }, [interactions]);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>ציר זמן שיחות</SectionTitle>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" /> אינטראקציה
        </Button>
      </div>
      {interactions.length === 0 && <div className="text-sm text-muted-foreground">אין שיחות עדיין</div>}
      <div className="space-y-6">
        {groups.map(([day, items]) => (
          <div key={day}>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">{day}</div>
            <div className="space-y-2">
              {items.map((i: any) => {
                const role = roleOf(i);
                return (
                  <div key={i.id} className="flex gap-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${roleTone(role)}`}>
                      {roleLabel(role).slice(0, 1)}
                    </div>
                    <div className="flex-1 min-w-0 rounded-lg border bg-card p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium">
                          {roleLabel(role)} · <span className="text-muted-foreground font-normal">{INTERACTION_TYPE_LABELS[i.type] || i.type}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">{formatDate(i.timestamp)}</div>
                      </div>
                      {i.content && <div className="text-sm mt-1.5 whitespace-pre-wrap break-words">{i.content}</div>}
                      {i.source && <div className="text-[11px] text-muted-foreground mt-1">מקור: {i.source}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function roleOf(i: any): "tamar" | "user" | "admin" {
  const s = (i.source || "").toLowerCase();
  if (s === "admin") return "admin";
  if (s.includes("tamar")) return i.type?.includes("admin") ? "tamar" : "user";
  if (i.type === "admin_note") return "admin";
  return "user";
}
function roleLabel(r: string) { return r === "tamar" ? "תמר" : r === "admin" ? "מנהל" : "משתמש"; }
function roleTone(r: string) {
  return r === "tamar" ? "bg-info/15 text-info"
    : r === "admin" ? "bg-primary/15 text-primary"
    : "bg-muted text-muted-foreground";
}

function AITab({ contact, update }: any) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm bg-info/10 text-info border border-info/30 p-3 rounded-lg">
        <Sparkles className="h-4 w-4" /> שדות פנימיים — לעיני המנהל בלבד.
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3">
          <SectionTitle>סיכום AI</SectionTitle>
          <EditableField label="סיכום כללי" multiline value={contact.ai_summary} onSave={(v: string) => update({ ai_summary: v })} />
          <EditableField label="הערות פרופיל" multiline value={contact.ai_profile_notes} onSave={(v: string) => update({ ai_profile_notes: v })} />
          <EditableField label="פעולה מומלצת" multiline value={contact.ai_recommended_next_action} onSave={(v: string) => update({ ai_recommended_next_action: v })} />
          <EditableField label="התאמה להצעות" multiline value={contact.ai_offer_fit} onSave={(v: string) => update({ ai_offer_fit: v })} />
          <EditableField label="סימוני סיכון" value={contact.ai_risk_flags} onSave={(v: string) => update({ ai_risk_flags: v })} />
          <EditableField label="ציון ביטחון (0-100)" type="number" value={contact.ai_confidence_score ?? ""} onSave={(v: string) => update({ ai_confidence_score: v === "" ? null : Number(v) })} />
        </Card>
        <Card className="p-5 space-y-3">
          <SectionTitle>פרופיל פסיכולוגי</SectionTitle>
          <EditableField label="פרופיל רגשי" value={contact.emotional_profile} onSave={(v: string) => update({ emotional_profile: v })} />
          <EditableField label="סגנון תקשורת" value={contact.communication_style} onSave={(v: string) => update({ communication_style: v })} />
          <EditableField label="פרופיל חברתי" value={contact.social_profile} onSave={(v: string) => update({ social_profile: v })} />
          <EditableField label="פרופיל מכירה" value={contact.sales_profile} onSave={(v: string) => update({ sales_profile: v })} />
          <EditableField label="רגישות מחיר" value={contact.price_sensitivity} onSave={(v: string) => update({ price_sensitivity: v })} />
          <EditableField label="סיגנל בדידות" value={contact.loneliness_signal} onSave={(v: string) => update({ loneliness_signal: v })} />
          <EditableField label="ציון פתיחות (0-100)" type="number" value={contact.openness_score ?? ""} onSave={(v: string) => update({ openness_score: v === "" ? null : Number(v) })} />
          <EditableField label="מוכנות לקשר" value={contact.relationship_readiness} onSave={(v: string) => update({ relationship_readiness: v })} />
          <EditableField label="התאמה לקהילה (0-100)" type="number" value={contact.community_fit_score ?? ""} onSave={(v: string) => update({ community_fit_score: v === "" ? null : Number(v) })} />
          <EditableField label="פוטנציאל VIP" value={contact.vip_potential} onSave={(v: string) => update({ vip_potential: v })} />
        </Card>
      </div>

      <Card className="p-5 space-y-4">
        <SectionTitle>צרכים ומכשולים</SectionTitle>
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">צרכים סבירים</Label>
          <FreeChipEditor value={contact.likely_needs || []} onChange={(v) => update({ likely_needs: v })} placeholder="צורך חדש" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">טריגרים להחלטה</Label>
          <FreeChipEditor value={contact.decision_triggers || []} onChange={(v) => update({ decision_triggers: v })} placeholder="טריגר חדש" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">התנגדויות</Label>
          <FreeChipEditor value={contact.objections || []} onChange={(v) => update({ objections: v })} placeholder="התנגדות חדשה" />
        </div>
      </Card>
    </div>
  );
}

function PersonalTab({ contact, update }: any) {
  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-5">
        <div>
          <SectionTitle>תחומי עניין</SectionTitle>
          <ChipPicker all={ALL_INTERESTS} labels={INTEREST_LABELS} selected={contact.interests}
            onChange={(v: string[]) => update({ interests: v })} />
        </div>
        <div>
          <SectionTitle>סגנון חיים</SectionTitle>
          <ChipPicker all={ALL_LIFESTYLE} labels={LIFESTYLE_LABELS} selected={contact.lifestyle_tags}
            onChange={(v: string[]) => update({ lifestyle_tags: v })} />
        </div>
        <div>
          <SectionTitle>תגיות חופשיות</SectionTitle>
          <FreeChipEditor value={contact.tags || []} onChange={(v) => update({ tags: v })} placeholder="תגית חדשה" />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 space-y-4">
          <SectionTitle>העדפות אירועים וטיולים</SectionTitle>
          <FreeField label="אירועים מועדפים" value={contact.preferred_events} onChange={(v) => update({ preferred_events: v })} />
          <FreeField label="תחביבים" value={contact.hobbies} onChange={(v) => update({ hobbies: v })} />
          <FreeField label="העדפות נסיעה" value={contact.travel_preferences} onChange={(v) => update({ travel_preferences: v })} />
          <FreeField label="סוגי פעילויות מועדפים" value={contact.favorite_activity_types} onChange={(v) => update({ favorite_activity_types: v })} />
          <FreeField label="זמינות" value={contact.availability_preferences} onChange={(v) => update({ availability_preferences: v })} />
          <EditableField label="סגנון טיולים מועדף" value={contact.preferred_trip_style} onSave={(v: string) => update({ preferred_trip_style: v })} />
          <EditableField label="סגנון חברתי מועדף" value={contact.preferred_social_style} onSave={(v: string) => update({ preferred_social_style: v })} />
          <EditableField label="רגישות תקציבית" value={contact.budget_sensitivity} onSave={(v: string) => update({ budget_sensitivity: v })} />
        </Card>
        <Card className="p-5 space-y-4">
          <SectionTitle>אישיות וצרכים רגשיים</SectionTitle>
          <FreeField label="תגיות אישיות" value={contact.personality_tags} onChange={(v) => update({ personality_tags: v })} />
          <FreeField label="צרכים רגשיים" value={contact.emotional_needs} onChange={(v) => update({ emotional_needs: v })} />
          <FreeField label="מטרות זוגיות" value={contact.relationship_goals} onChange={(v) => update({ relationship_goals: v })} />
          <FreeField label="מטרות חברתיות" value={contact.social_goals} onChange={(v) => update({ social_goals: v })} />
        </Card>
      </div>

      <Card className="p-5">
        <SectionTitle>שדות דינמיים (Dynamic Profile Fields)</SectionTitle>
        <DynamicFieldsEditor
          value={contact.dynamic_profile_fields || {}}
          onChange={(v) => update({ dynamic_profile_fields: v })}
        />
      </Card>
    </div>
  );
}

function FreeField({ label, value, onChange }: { label: string; value: any; onChange: (v: string[]) => void }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1.5 block">{label}</Label>
      <FreeChipEditor value={value || []} onChange={onChange} placeholder="הוסף ערך" />
    </div>
  );
}

function DynamicFieldsEditor({ value, onChange }: { value: Record<string, any>; onChange: (v: any) => void }) {
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const entries = Object.entries(value || {});
  function addOrUpdate() {
    if (!k.trim()) return;
    onChange({ ...(value || {}), [k.trim()]: v });
    setK(""); setV("");
  }
  return (
    <div className="space-y-3">
      {entries.length === 0 && <div className="text-sm text-muted-foreground">אין שדות דינמיים עדיין</div>}
      <div className="space-y-1.5">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-center gap-2 p-2 rounded-md bg-muted/40">
            <span className="text-sm font-medium min-w-[140px]">{key}</span>
            <span className="text-sm text-muted-foreground flex-1 break-all">
              {typeof val === "object" ? JSON.stringify(val) : String(val)}
            </span>
            <Button size="icon" variant="ghost" className="h-7 w-7"
              onClick={() => { const next = { ...value }; delete next[key]; onChange(next); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input placeholder="מפתח" value={k} onChange={(e) => setK(e.target.value)} className="flex-1" />
        <Input placeholder="ערך" value={v} onChange={(e) => setV(e.target.value)} className="flex-[2]" />
        <Button onClick={addOrUpdate}>הוסף / עדכן</Button>
      </div>
    </div>
  );
}

function SalesTab({ contact, update }: any) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="ציון פעילות" value={`${contact.activity_score ?? 0}/100`} />
        <StatCard label="ציון מעורבות" value={`${contact.engagement_score ?? 0}/100`} />
        <StatCard label="טמפרטורת מכירה" value={SALES_TEMP_LABELS[contact.sales_temperature] || "—"} />
        <StatCard label="כוונת רכישה" value={contact.purchase_intent || "—"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 space-y-4">
          <SectionTitle>פעילות</SectionTitle>
          <Meter label="פעילות" value={contact.activity_score ?? 0} />
          <Meter label="מעורבות" value={contact.engagement_score ?? 0} />
          <div>
            <Label className="text-xs text-muted-foreground">טמפרטורת מכירה</Label>
            <Select value={contact.sales_temperature ?? ""} onValueChange={(v) => update({ sales_temperature: v || null })}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {Object.entries(SALES_TEMP_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <EditableField label="כוונת רכישה" value={contact.purchase_intent} onSave={(v: string) => update({ purchase_intent: v })} />
          <EditableField label="הצעה אחרונה שנלחצה" value={contact.last_clicked_offer} onSave={(v: string) => update({ last_clicked_offer: v })} />
          <EditableField label="קמפיין אחרון" value={contact.last_campaign} onSave={(v: string) => update({ last_campaign: v })} />
        </Card>

        <Card className="p-5 space-y-4">
          <SectionTitle>הזדמנויות והכנסות</SectionTitle>
          <EditableField label="הצעה הבאה מומלצת" value={contact.next_best_offer} onSave={(v: string) => update({ next_best_offer: v })} />
          <EditableField label="קמפיין מומלץ" value={contact.recommended_campaign} onSave={(v: string) => update({ recommended_campaign: v })} />
          <EditableField label="סך הכנסות" type="number" value={contact.total_revenue ?? 0} onSave={(v: string) => update({ total_revenue: v ? Number(v) : 0 })} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <SectionTitle>קמפיינים והצעות</SectionTitle>
          <FreeField label="קמפיינים שהתקבלו" value={contact.campaigns_received} onChange={(v) => update({ campaigns_received: v })} />
          <div className="h-3" />
          <FreeField label="הצעות שנשלחו" value={contact.offers_sent} onChange={(v) => update({ offers_sent: v })} />
        </Card>
        <Card className="p-5">
          <SectionTitle>אירועים וטיולים</SectionTitle>
          <FreeField label="התעניין באירועים" value={contact.events_interested} onChange={(v) => update({ events_interested: v })} />
          <div className="h-3" />
          <FreeField label="השתתף באירועים" value={contact.events_joined} onChange={(v) => update({ events_joined: v })} />
          <div className="h-3" />
          <FreeField label="התעניין בטיולים" value={contact.trips_interested} onChange={(v) => update({ trips_interested: v })} />
        </Card>
      </div>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const v = Math.min(100, Math.max(0, value));
  const tone = v >= 70 ? "bg-success" : v >= 30 ? "bg-warning" : "bg-info";
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{v}/100</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function NotesTasksTab({ contact, update, tasks, onTaskChange, contactId, openTask }: any) {
  const [notes, setNotes] = useState(contact.notes || "");
  useEffect(() => { setNotes(contact.notes || ""); }, [contact.notes]);
  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <SectionTitle>הערות פנימיות</SectionTitle>
          <Button size="sm" onClick={() => update({ notes })}>שמור</Button>
        </div>
        <Textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערות פנימיות..." />
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>משימות</SectionTitle>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={openTask}>
            <Plus className="h-3.5 w-3.5" /> משימה חדשה
          </Button>
        </div>
        {tasks.length === 0 && <div className="text-sm text-muted-foreground">אין משימות</div>}
        <div className="space-y-2">
          {tasks.map((t: any) => (
            <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg border">
              <input
                type="checkbox"
                checked={t.status === "done"}
                onChange={async (e) => {
                  await supabase.from("tasks").update({ status: e.target.checked ? "done" : "open" }).eq("id", t.id);
                  onTaskChange();
                }}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className={`font-medium ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">{TASK_PRIORITY_LABELS[t.priority]}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{TASK_STATUS_LABELS[t.status]}</Badge>
                  </div>
                </div>
                {t.description && <div className="text-sm text-muted-foreground mt-1">{t.description}</div>}
                <div className="text-[11px] text-muted-foreground mt-1.5 flex gap-3">
                  {t.assigned_to && <span>אחראי: {t.assigned_to}</span>}
                  {t.due_date && <span>יעד: {formatDate(t.due_date)}</span>}
                  <span>נוצר: {formatRelative(t.created_at)}</span>
                </div>
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7"
                onClick={async () => { await supabase.from("tasks").delete().eq("id", t.id); onTaskChange(); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RawTab({ contact, webhookLogs }: any) {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <SectionTitle>שדות דינמיים</SectionTitle>
        <pre className="bg-muted/40 p-3 rounded-md text-xs overflow-auto max-h-64" dir="ltr">
{JSON.stringify(contact.dynamic_profile_fields || {}, null, 2)}
        </pre>
      </Card>
      <Card className="p-5">
        <SectionTitle>היסטוריית Payloads (raw_payloads)</SectionTitle>
        {(!contact.raw_payloads || contact.raw_payloads.length === 0) && (
          <div className="text-sm text-muted-foreground">אין נתונים גולמיים שמורים על איש הקשר</div>
        )}
        <div className="space-y-2 max-h-[500px] overflow-auto">
          {(contact.raw_payloads || []).slice().reverse().map((entry: any, idx: number) => (
            <details key={idx} className="rounded-md border bg-card">
              <summary className="cursor-pointer p-2 text-xs flex items-center justify-between">
                <span className="font-medium">#{(contact.raw_payloads.length - idx)}</span>
                <span className="text-muted-foreground">{formatDate(entry.at)}</span>
              </summary>
              <pre className="bg-muted/40 p-3 text-xs overflow-auto" dir="ltr">
{JSON.stringify(entry.payload ?? entry, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <SectionTitle>אירועי Webhook קשורים</SectionTitle>
        {webhookLogs.length === 0 && <div className="text-sm text-muted-foreground">לא נמצאו אירועים</div>}
        <div className="space-y-2 max-h-[400px] overflow-auto">
          {webhookLogs.map((l: any) => (
            <details key={l.id} className="rounded-md border bg-card">
              <summary className="cursor-pointer p-2 text-xs flex items-center justify-between">
                <span className="font-medium">{l.source} · {l.status}</span>
                <span className="text-muted-foreground">{formatDate(l.created_at)}</span>
              </summary>
              <pre className="bg-muted/40 p-3 text-xs overflow-auto" dir="ltr">
{JSON.stringify(l.payload, null, 2)}
              </pre>
              {l.error && <div className="p-2 text-xs text-destructive">{l.error}</div>}
            </details>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Dialogs ---------- */

function AddInteractionDialog({ open, onOpenChange, contactId, onAdded }: any) {
  const [type, setType] = useState("admin_note");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("interactions").insert({
      contact_id: contactId, type: type as any, content, source: "admin",
    });
    setSaving(false);
    if (error) { toast.error("שגיאה: " + error.message); return; }
    toast.success("נוסף");
    setContent(""); onOpenChange(false); onAdded?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>הוסף אינטראקציה</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>סוג</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(INTERACTION_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>תוכן</Label>
            <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={save} disabled={saving}>{saving ? "שומר..." : "שמור"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddTaskDialog({ open, onOpenChange, contactId, onAdded }: any) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) { toast.error("נדרש כותרת"); return; }
    setSaving(true);
    const { error } = await supabase.from("tasks").insert({
      contact_id: contactId, title, description, assigned_to: assignedTo || null,
      priority, due_date: dueDate ? new Date(dueDate).toISOString() : null, status: "open",
    });
    setSaving(false);
    if (error) { toast.error("שגיאה: " + error.message); return; }
    toast.success("המשימה נוצרה");
    setTitle(""); setDescription(""); setAssignedTo(""); setPriority("normal"); setDueDate("");
    onOpenChange(false); onAdded?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>משימה חדשה</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>כותרת *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><Label>תיאור</Label><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>אחראי</Label><Input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="שם / אימייל" /></div>
            <div>
              <Label>עדיפות</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_PRIORITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>תאריך יעד</Label><Input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={save} disabled={saving}>{saving ? "שומר..." : "צור משימה"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function normalizeP(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/[^\d]/g, "").replace(/^0+/, "");
}