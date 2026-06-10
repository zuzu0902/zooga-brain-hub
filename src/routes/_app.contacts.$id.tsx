import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { TamarDecisionStrip } from "@/components/tamar-decision-strip";
import { ContactConversation } from "@/components/contact-conversation";

export const Route = createFileRoute("/_app/contacts/$id")({
  head: () => ({ meta: [{ title: "פרופיל איש קשר — Zooga CRM" }] }),
  component: ContactProfile,
});

function ContactProfile() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
  const [activeSection, setActiveSection] = useState<"memory" | "actions" | "timeline" | "edit">("memory");

  async function update(patch: any) {
    const { error } = await supabase.from("contacts").update(patch).eq("id", id);
    if (error) { toast.error("שגיאה: " + error.message); return; }
    toast.success("עודכן");
    qc.invalidateQueries({ queryKey: ["contact", id] });
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">טוען...</div>;
  if (!contact) return <div className="p-6">איש קשר לא נמצא</div>;

  const initials = (contact.full_name || contact.first_name || "?").trim().slice(0, 1);

  async function handleDelete() {
    setDeleting(true);
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    setDeleting(false);
    if (error) {
      toast.error("שגיאה במחיקה: " + error.message);
      return;
    }
    toast.success("איש הקשר נמחק");
    setDeleteOpen(false);
    qc.invalidateQueries({ queryKey: ["contacts-rich"] });
    navigate({ to: "/contacts" });
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--gradient-soft)" }}>
      <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
        <Link to="/contacts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
          <ArrowRight className="h-4 w-4" /> חזרה לרשימה
        </Link>

        {/* === IDENTITY HEADER === */}
        <IdentityHeader
          contact={contact}
          initials={initials}
          id={id}
          update={update}
          onMessage={() => setInteractionOpen(true)}
          onTask={() => setTaskOpen(true)}
          onDelete={() => setDeleteOpen(true)}
        />

        {/* === AI RELATIONSHIP SUMMARY === */}
        <AIRelationshipSummary contact={contact} />

        {/* === TAMAR DECISION STRIP === */}
        <TamarDecisionStrip contactId={id} contact={contact} />

        {/* === INTAKE PROGRESS (V1) === */}
        <IntakeProgressCard contact={contact} contactId={id} />

        {/* === LIVE CONVERSATION === */}
        <ContactConversation contactId={id} />

        {/* === MAIN GRID: left content + right insights rail === */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
          <div className="space-y-6 min-w-0">
            <ProfileNav active={activeSection} onChange={setActiveSection} />

            {activeSection === "memory" && (
              <RelationshipMemorySection contactId={id} />
            )}
            {activeSection === "actions" && (
              <SuggestedActionsSection
                contact={contact}
                contactId={id}
                tasks={tasks ?? []}
                openTask={() => setTaskOpen(true)}
                onTaskChange={() => qc.invalidateQueries({ queryKey: ["tasks", id] })}
                update={update}
              />
            )}
            {activeSection === "timeline" && (
              <UnifiedTimeline
                contactId={id}
                interactions={interactions ?? []}
                onAdd={() => setInteractionOpen(true)}
              />
            )}
            {activeSection === "edit" && (
              <div className="space-y-6">
                <SectionHeading>סקירה כללית</SectionHeading>
                <OverviewTab contact={contact} update={update} />
                <SectionHeading>תובנות AI</SectionHeading>
                <AITab contact={contact} update={update} />
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
              </div>
            )}
          </div>

          {/* === RIGHT RAIL: AI INSIGHTS PANEL === */}
          <AIInsightsRail contact={contact} contactId={id} />
        </div>

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
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>למחוק את איש הקשר?</AlertDialogTitle>
              <AlertDialogDescription>
                פעולה זו תמחק לצמיתות את {contact.full_name || "איש הקשר"} ואת כל הנתונים המקושרים (שיחות, משימות, זיכרון). לא ניתן לשחזר.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {deleting ? "מוחק..." : "מחק"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
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

/* ============================================================
 * Premium 5-section layout components
 * ============================================================ */

function IdentityHeader({ contact, initials, id, update, onMessage, onTask, onDelete }: any) {
  return (
    <Card className="p-6 shadow-[var(--shadow-elevated)] border-border/60 overflow-hidden relative">
      <div
        className="absolute inset-x-0 top-0 h-24 opacity-[0.06] pointer-events-none"
        style={{ background: "var(--gradient-warm)" }}
      />
      <div className="relative flex items-start justify-between gap-6 flex-wrap">
        <div className="flex items-start gap-5 flex-1 min-w-[280px]">
          <div
            className="h-20 w-20 rounded-2xl flex items-center justify-center text-3xl font-bold text-primary-foreground shrink-0 shadow-[var(--shadow-warm)]"
            style={{ background: "var(--gradient-warm)" }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight">{contact.full_name || "ללא שם"}</h1>
              {contact.manager_attention_required && (
                <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> דורש טיפול מנהל</Badge>
              )}
              {contact.vip_potential && (
                <Badge className="gap-1 bg-gradient-to-r from-[var(--gold)] to-[var(--primary-glow)] text-primary-foreground border-0">
                  <Sparkles className="h-3 w-3" /> VIP
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap text-sm text-muted-foreground">
              {contact.phone && <span className="inline-flex items-center gap-1.5" dir="ltr"><Phone className="h-3.5 w-3.5" />{contact.phone}</span>}
              {contact.email && <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{contact.email}</span>}
              {(contact.city || contact.region) && (
                <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{[contact.region, contact.city].filter(Boolean).join(" · ")}</span>
              )}
              {contact.age && <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{contact.age}</span>}
              <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{contact.last_interaction_at ? formatRelative(contact.last_interaction_at) : "ללא אינטראקציות"}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              <Badge variant="outline">{SOURCE_LABELS[contact.source] || contact.source}</Badge>
              <Badge variant="secondary">{STATUS_LABELS[contact.status] || contact.status}</Badge>
              {contact.sales_temperature && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${SALES_TEMP_TONE[contact.sales_temperature] || "border-border"}`}>
                  טמפ׳: {SALES_TEMP_LABELS[contact.sales_temperature]}
                </span>
              )}
              {contact.relationship_status && <Badge variant="outline" className="text-[10px]">{contact.relationship_status}</Badge>}
              {contact.consent_marketing
                ? <Badge className="gap-1 bg-success text-success-foreground hover:bg-success"><ShieldCheck className="h-3 w-3" /> הסכמה</Badge>
                : <Badge variant="outline" className="text-muted-foreground">ללא הסכמה</Badge>}
              {(contact.tags || []).slice(0, 6).map((t: string) => (
                <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2 min-w-[240px]">
          <Select value={contact.status} onValueChange={(v) => update({ status: v })}>
            <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onMessage}>
              <MessageSquare className="h-3.5 w-3.5" /> שלח
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onTask}>
              <CheckSquare className="h-3.5 w-3.5" /> משימה
            </Button>
            <Button
              size="sm"
              variant={contact.manager_attention_required ? "default" : "outline"}
              className="gap-1.5 col-span-2"
              onClick={() => update({ manager_attention_required: !contact.manager_attention_required })}
            >
              <Flag className="h-3.5 w-3.5" /> {contact.manager_attention_required ? "בטל סימון מנהל" : "סמן לטיפול מנהל"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 col-span-2 text-muted-foreground"
              onClick={() => window.open(`/contacts/${id}`, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-3.5 w-3.5" /> פתח להדפסה / PDF
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 col-span-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" /> מחק איש קשר
            </Button>
          </div>
        </div>
      </div>

      {/* Score row */}
      <div className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6 pt-5 border-t border-border/60">
        <ScorePill icon={Activity} label="פעילות" value={contact.activity_score ?? 0} />
        <ScorePill icon={Heart} label="מעורבות" value={contact.engagement_score ?? 0} />
        <ScorePill icon={Zap} label="פתיחות רגשית" value={contact.openness_score ?? 0} />
        <ScorePill icon={User} label="התאמה לקהילה" value={contact.community_fit_score ?? 0} />
        <ScorePill icon={TrendingUp} label="ביטחון AI" value={contact.ai_confidence_score ?? 0} />
        <ScorePill icon={Target} label="הכנסות" value={Number(contact.total_revenue) || 0} suffix="" raw />
      </div>

      <QuickFacts contact={contact} />
    </Card>
  );
}

function QuickFacts({ contact }: any) {
  const genderLabel: Record<string, string> = { male: "גבר", female: "אישה", other: "אחר", unknown: "לא ידוע" };
  const demographics: Array<[string, string | null | undefined]> = [
    ["מגדר", contact.gender ? genderLabel[contact.gender] || contact.gender : null],
    ["גיל", contact.age ? String(contact.age) : contact.age_range || null],
    ["סטטוס", contact.relationship_status],
    ["אזור", contact.region],
    ["עיר", contact.city],
    ["יום הולדת", contact.birthday_day && contact.birthday_month ? `${contact.birthday_day}/${contact.birthday_month}` : null],
  ].filter(([, v]) => v) as Array<[string, string]>;

  const interestGroups: Array<{ label: string; items: string[]; tone: string }> = [
    { label: "תחומי עניין", items: contact.interests || [], tone: "bg-primary/10 text-primary border-primary/20" },
    { label: "תחביבים", items: contact.hobbies || [], tone: "bg-accent/10 text-accent-foreground border-accent/20" },
    { label: "אופי", items: contact.personality_tags || [], tone: "bg-secondary/60 text-secondary-foreground border-border" },
    { label: "סגנון חיים", items: contact.lifestyle_tags || [], tone: "bg-muted text-foreground border-border" },
  ].filter((g) => g.items && g.items.length > 0);

  const profile: Array<[string, string | null | undefined]> = [
    ["תקשורת", contact.communication_style],
    ["רגשי", contact.emotional_profile],
    ["חברתי", contact.preferred_social_style],
    ["טיולים", contact.preferred_trip_style],
    ["רגישות מחיר", contact.budget_sensitivity || contact.price_sensitivity],
    ["כוונת רכישה", contact.purchase_intent],
    ["שפה", contact.preferred_language_style],
  ].filter(([, v]) => v) as Array<[string, string]>;

  const hasAny = demographics.length || interestGroups.length || profile.length;
  if (!hasAny) return null;

  return (
    <div className="relative mt-5 pt-5 border-t border-border/60 space-y-4">
      {demographics.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">דמוגרפיה</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            {demographics.map(([k, v]) => (
              <div key={k} className="inline-flex items-center gap-1.5">
                <span className="text-muted-foreground text-xs">{k}:</span>
                <span className="font-medium">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {interestGroups.map((g) => (
        <div key={g.label}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">{g.label}</div>
          <div className="flex flex-wrap gap-1.5">
            {g.items.slice(0, 12).map((item: string) => (
              <span key={item} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${g.tone}`}>
                {item}
              </span>
            ))}
            {g.items.length > 12 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] text-muted-foreground border border-border" title={g.items.slice(12).join(", ")}>
                +{g.items.length - 12}
              </span>
            )}
          </div>
        </div>
      ))}

      {profile.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">פרופיל מכירות ותקשורת</div>
          <div className="flex flex-wrap gap-1.5">
            {profile.map(([k, v]) => (
              <Badge key={k} variant="outline" className="text-[11px] font-normal">
                <span className="text-muted-foreground ms-1">{k}:</span> <span className="font-medium">{v}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScorePill({ icon: Icon, label, value, raw, suffix = "/100" }: any) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = raw ? "text-foreground" : v >= 70 ? "text-success" : v >= 40 ? "text-warning-foreground" : "text-muted-foreground";
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${tone}`}>
        {raw ? Number(value).toLocaleString("he-IL") : value}{!raw && <span className="text-xs text-muted-foreground font-normal">{suffix}</span>}
      </div>
      {!raw && (
        <div className="h-1 bg-muted rounded-full overflow-hidden mt-2">
          <div className={`h-full ${v >= 70 ? "bg-success" : v >= 40 ? "bg-warning" : "bg-muted-foreground/30"}`} style={{ width: `${v}%` }} />
        </div>
      )}
    </div>
  );
}

function AIRelationshipSummary({ contact }: any) {
  const summary = contact.ai_summary;
  const next = contact.ai_recommended_next_action;
  return (
    <Card className="p-5 border-primary/20 bg-gradient-to-br from-primary/[0.04] via-card to-card relative overflow-hidden">
      <div className="absolute -top-12 -left-12 h-32 w-32 rounded-full opacity-20 blur-3xl" style={{ background: "var(--gradient-warm)" }} />
      <div className="relative flex items-start gap-4">
        <div className="h-11 w-11 rounded-xl flex items-center justify-center bg-primary/10 text-primary shrink-0">
          <Brain className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">AI Relationship Summary</h2>
            {contact.ai_confidence_score != null && (
              <Badge variant="outline" className="text-[10px]">ביטחון {contact.ai_confidence_score}%</Badge>
            )}
          </div>
          {summary ? (
            <p className="text-base leading-relaxed text-foreground">{summary}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              אין עדיין סיכום AI. הוא ייווצר אוטומטית לאחר השיחות הראשונות עם תמר.
            </p>
          )}
          {next && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-info/10 border border-info/20">
              <Lightbulb className="h-4 w-4 text-info shrink-0 mt-0.5" />
              <div>
                <div className="text-[11px] uppercase font-semibold text-info mb-0.5">המלצה הבאה</div>
                <div className="text-sm">{next}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ProfileNav({ active, onChange }: { active: string; onChange: (v: any) => void }) {
  const items = [
    { id: "memory", label: "Relationship Memory", icon: Brain },
    { id: "actions", label: "Suggested Actions", icon: Lightbulb },
    { id: "timeline", label: "Timeline", icon: Clock },
    { id: "edit", label: "Edit Profile", icon: Settings2 },
  ];
  return (
    <div className="flex gap-1 p-1 rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-x-auto">
      {items.map((it) => {
        const Icon = it.icon;
        const on = active === it.id;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              on
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Icon className="h-4 w-4" />
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Relationship Memory ---------- */

const MEM_TYPE_LABEL: Record<string, string> = {
  fact: "עובדה",
  preference: "העדפה",
  warning: "אזהרה",
  observation: "תצפית",
  relationship_signal: "סיגנל יחסים",
  offer_signal: "סיגנל הצעה",
  // legacy fallbacks
  emotion: "רגש",
  event: "אירוע",
  relationship: "מערכת יחסים",
  goal: "מטרה",
};
const MEM_TYPE_TONE: Record<string, string> = {
  fact: "bg-info/10 text-info border-info/30",
  preference: "bg-primary/10 text-primary border-primary/30",
  warning: "bg-destructive/10 text-destructive border-destructive/30",
  observation: "bg-accent/40 text-foreground border-border",
  relationship_signal: "bg-success/10 text-success border-success/30",
  offer_signal: "bg-secondary text-secondary-foreground border-border",
  // legacy fallbacks
  emotion: "bg-warning/10 text-warning-foreground border-warning/30",
  event: "bg-accent/40 text-foreground border-border",
  relationship: "bg-success/10 text-success border-success/30",
  goal: "bg-secondary text-secondary-foreground border-border",
};

const CANONICAL_MEM_TYPES = [
  "fact",
  "preference",
  "warning",
  "observation",
  "relationship_signal",
  "offer_signal",
] as const;

function normalizeMemType(t: string | null | undefined): string {
  const k = String(t || "").toLowerCase();
  if ((CANONICAL_MEM_TYPES as readonly string[]).includes(k)) return k;
  // legacy mapping
  if (k === "emotion") return "warning";
  if (k === "event") return "observation";
  if (k === "relationship") return "relationship_signal";
  if (k === "goal") return "offer_signal";
  return "observation";
}

function RelationshipMemorySection({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data: memories } = useQuery({
    queryKey: ["contact-memories", contactId],
    refetchInterval: 20000,
    queryFn: async () => {
      const { data } = await supabase
        .from("contact_memories").select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase.channel(`mem-${contactId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contact_memories", filter: `contact_id=eq.${contactId}` },
        () => qc.invalidateQueries({ queryKey: ["contact-memories", contactId] }))
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
      toast.success(`הופקו ${j.memories || 0} זיכרונות חדשים`);
      qc.invalidateQueries({ queryKey: ["contact-memories", contactId] });
      qc.invalidateQueries({ queryKey: ["contact", contactId] });
    } catch (e: any) {
      toast.error("שגיאה: " + (e?.message || e));
    }
    setRunning(false);
  }

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    (memories || []).forEach((m: any) => {
      const k = normalizeMemType(m.memory_type);
      (g[k] = g[k] || []).push(m);
    });
    return g;
  }, [memories]);

  return (
    <Card className="p-6 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            זיכרון מערכת היחסים
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            זיכרון רגשי מובנה — נצבר אוטומטית מכל שיחה ב-WhatsApp
          </p>
        </div>
        <Button size="sm" onClick={runNow} disabled={running} className="gap-2">
          {running ? <Sparkles className="h-4 w-4 animate-pulse" /> : <Sparkles className="h-4 w-4" />}
          {running ? "מחלץ..." : "חלץ זיכרונות עכשיו"}
        </Button>
      </div>

      {(memories?.length ?? 0) === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <Brain className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <div className="text-sm">אין עדיין זיכרונות.</div>
          <div className="text-xs mt-1">הזיכרון ייצבר אוטומטית כשתמר תקיים שיחות.</div>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${MEM_TYPE_TONE[type] || "border-border"}`}>
                  {MEM_TYPE_LABEL[type] || type}
                </span>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {items.map((m: any) => (
                  <div key={m.id} className="p-3.5 rounded-xl border bg-card hover:shadow-sm transition-shadow">
                    <div className="text-sm font-semibold leading-snug">{m.memory_key}</div>
                    {m.memory_value && m.memory_value !== m.memory_key && (
                      <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{m.memory_value}</div>
                    )}
                    <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-border/60">
                      <span className="text-[10px] text-muted-foreground">{formatRelative(m.created_at)}</span>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
                        <span className={`h-1.5 w-1.5 rounded-full ${(m.confidence_score ?? 0) >= 75 ? "bg-success" : (m.confidence_score ?? 0) >= 50 ? "bg-warning" : "bg-muted-foreground/40"}`} />
                        {m.confidence_score ?? 0}%
                      </div>
                    </div>
                    {m.source_message && (
                      <div className="text-[10px] text-muted-foreground mt-1.5 italic line-clamp-2">"{m.source_message}"</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------- Suggested Actions ---------- */

function SuggestedActionsSection({ contact, contactId, tasks, openTask, onTaskChange, update }: any) {
  const { data: pending } = useQuery({
    queryKey: ["contact-pending", contactId],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pending_ai_insights").select("*")
        .eq("contact_id", contactId)
        .eq("status", "pending")
        .order("confidence_score", { ascending: false });
      return data ?? [];
    },
  });

  // Build derived suggestions from contact AI fields
  const aiSuggestions: any[] = [];
  if (contact.ai_recommended_next_action) {
    aiSuggestions.push({
      type: "next_action",
      title: contact.ai_recommended_next_action,
      reason: "המלצה מבוססת על פרופיל מצטבר",
      confidence: contact.ai_confidence_score ?? 70,
      urgency: contact.manager_attention_required ? "high" : "normal",
    });
  }
  if (contact.next_best_offer) {
    aiSuggestions.push({
      type: "offer",
      title: `הצע: ${contact.next_best_offer}`,
      reason: contact.ai_offer_fit || "מתאים לפרופיל",
      confidence: contact.ai_confidence_score ?? 70,
      urgency: "normal",
    });
  }
  if (contact.recommended_campaign) {
    aiSuggestions.push({
      type: "campaign",
      title: `שייך לקמפיין: ${contact.recommended_campaign}`,
      reason: "התאמה דמוגרפית/רגשית",
      confidence: 75,
      urgency: "normal",
    });
  }
  if (contact.manager_attention_required) {
    aiSuggestions.push({
      type: "escalate",
      title: "העבר למנהל אנושי",
      reason: contact.ai_risk_flags || "תמר זיהתה צורך בליווי אנושי",
      confidence: 90,
      urgency: "high",
    });
  }

  const openTasks = (tasks || []).filter((t: any) => t.status !== "done");

  async function approve(p: any) {
    const value = p.proposed_value?.value;
    const field = p.field_name;
    if (!field) return;
    const { data: cur } = await supabase.from("contacts").select(field).eq("id", contactId).maybeSingle();
    const oldVal = (cur as any)?.[field];
    const newVal = Array.isArray(value) && Array.isArray(oldVal)
      ? Array.from(new Set([...oldVal, ...value]))
      : value;
    await supabase.from("contacts").update({ [field]: newVal } as any).eq("id", contactId);
    await supabase.from("pending_ai_insights")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", p.id);
    toast.success("יושם בפרופיל");
  }
  async function reject(p: any) {
    await supabase.from("pending_ai_insights")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", p.id);
    toast.success("נדחה");
  }

  return (
    <div className="space-y-5">
      <Card className="p-6 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-primary" />
              פעולות מומלצות AI
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              מנוע ההמלצות מבוסס על פרופיל מצטבר ושיחות אחרונות
            </p>
          </div>
        </div>

        {aiSuggestions.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <div className="text-sm">אין עדיין המלצות פעולה.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {aiSuggestions.map((s, idx) => (
              <div key={idx} className={`p-4 rounded-xl border ${s.urgency === "high" ? "border-destructive/40 bg-destructive/5" : "bg-card"}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant={s.urgency === "high" ? "destructive" : "outline"} className="text-[10px]">
                        {s.urgency === "high" ? "דחוף" : "רגיל"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground tabular-nums">ביטחון {s.confidence}%</span>
                    </div>
                    <div className="text-base font-semibold">{s.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.reason}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={openTask}>צור משימה</Button>
                    {s.type === "escalate" && (
                      <Button size="sm" onClick={() => update({ manager_attention_required: false })}>טופל</Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {(pending?.length ?? 0) > 0 && (
        <Card className="p-6 border-warning/30 bg-warning/[0.03] shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="h-5 w-5 text-warning-foreground" />
            <h3 className="text-base font-bold">תובנות AI ממתינות לאישור ({pending!.length})</h3>
          </div>
          <div className="space-y-2.5">
            {pending!.map((p: any) => (
              <div key={p.id} className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-card border">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{p.field_name}</span>
                    <Badge variant="outline" className="text-[10px]">{p.confidence_score ?? 0}%</Badge>
                  </div>
                  <div className="text-sm mt-1 break-words">
                    <span className="text-muted-foreground">ערך מוצע: </span>
                    <span className="font-medium">{JSON.stringify(p.proposed_value?.value)}</span>
                  </div>
                  {p.reasoning && <div className="text-xs text-muted-foreground mt-1">{p.reasoning}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="outline" onClick={() => approve(p)}><CheckSquare className="h-4 w-4 text-success" /></Button>
                  <Button size="icon" variant="outline" onClick={() => reject(p)}><X className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-6 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-primary" />
            משימות פתוחות ({openTasks.length})
          </h3>
          <Button size="sm" variant="outline" onClick={openTask} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> משימה חדשה
          </Button>
        </div>
        {openTasks.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">אין משימות פתוחות</div>
        ) : (
          <div className="space-y-2">
            {openTasks.map((t: any) => (
              <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                <input
                  type="checkbox"
                  className="mt-1"
                  onChange={async () => {
                    await supabase.from("tasks").update({ status: "done" }).eq("id", t.id);
                    onTaskChange();
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{t.title}</div>
                  {t.description && <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>}
                  <div className="text-[10px] text-muted-foreground mt-1 flex gap-2">
                    <Badge variant="outline" className="text-[10px]">{TASK_PRIORITY_LABELS[t.priority]}</Badge>
                    {t.due_date && <span>יעד: {formatDate(t.due_date)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- Unified Timeline ---------- */

function UnifiedTimeline({ contactId, interactions, onAdd }: any) {
  const { data: history } = useQuery({
    queryKey: ["contact-history", contactId],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("contact_profile_history").select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const events = useMemo(() => {
    const all: any[] = [];
    (interactions || []).forEach((i: any) => {
      all.push({
        kind: "interaction",
        ts: i.timestamp,
        type: i.type,
        content: i.content,
        source: i.source,
        id: `i-${i.id}`,
      });
    });
    (history || []).forEach((h: any) => {
      all.push({
        kind: "ai_change",
        ts: h.created_at,
        field: h.field_name,
        oldVal: h.old_value,
        newVal: h.new_value,
        by: h.changed_by,
        confidence: h.confidence_score,
        id: `h-${h.id}`,
      });
    });
    return all.sort((a, b) => +new Date(b.ts) - +new Date(a.ts));
  }, [interactions, history]);

  return (
    <Card className="p-6 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            ציר זמן מאוחד
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            שיחות, העשרות AI, ושינויי פרופיל — בסדר כרונולוגי
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> אינטראקציה
        </Button>
      </div>

      {events.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">אין אירועים עדיין</div>
      ) : (
        <div className="relative pr-6">
          <div className="absolute right-2 top-2 bottom-2 w-px bg-border" />
          <div className="space-y-4">
            {events.map((e) => <TimelineRow key={e.id} event={e} />)}
          </div>
        </div>
      )}
    </Card>
  );
}

function TimelineRow({ event }: { event: any }) {
  const meta = event.kind === "interaction"
    ? { icon: MessageSquare, tone: "bg-info/15 text-info border-info/30", label: INTERACTION_TYPE_LABELS[event.type] || event.type }
    : { icon: Sparkles, tone: "bg-primary/15 text-primary border-primary/30", label: event.by === "ai_extraction" ? "עדכון AI" : "עדכון מנהל" };
  const Icon = meta.icon;
  return (
    <div className="relative">
      <div className={`absolute right-[-22px] top-1.5 h-7 w-7 rounded-full border-2 border-background flex items-center justify-center ${meta.tone.replace("border-", "bg-").split(" ")[0]}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="rounded-xl border bg-card p-3.5">
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${meta.tone}`}>
            {meta.label}
          </span>
          <span className="text-[11px] text-muted-foreground">{formatDate(event.ts)}</span>
        </div>
        {event.kind === "interaction" ? (
          <>
            {event.content && <div className="text-sm whitespace-pre-wrap break-words">{event.content}</div>}
            {event.source && <div className="text-[11px] text-muted-foreground mt-1">מקור: {event.source}</div>}
          </>
        ) : (
          <div className="text-sm">
            <span className="font-medium">{event.field}</span>
            <div className="text-xs text-muted-foreground mt-1">
              <span className="line-through opacity-60">{event.oldVal || "ריק"}</span>
              {" → "}
              <span className="text-foreground font-medium">{event.newVal}</span>
              {event.confidence != null && <span className="ml-2 text-[10px]">({event.confidence}%)</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- AI Insights right rail ---------- */

function AIInsightsRail({ contact, contactId }: any) {
  const insights = useMemo(() => {
    const out: { label: string; value: string; tone?: string }[] = [];
    if (contact.emotional_profile) out.push({ label: "פרופיל רגשי", value: contact.emotional_profile });
    if (contact.communication_style) out.push({ label: "סגנון תקשורת", value: contact.communication_style });
    if (contact.social_profile) out.push({ label: "פרופיל חברתי", value: contact.social_profile });
    if (contact.sales_profile) out.push({ label: "פרופיל מכירה", value: contact.sales_profile });
    if (contact.preferred_trip_style) out.push({ label: "סגנון טיול מועדף", value: contact.preferred_trip_style });
    if (contact.preferred_social_style) out.push({ label: "סגנון חברתי מועדף", value: contact.preferred_social_style });
    if (contact.budget_sensitivity) out.push({ label: "רגישות תקציב", value: contact.budget_sensitivity });
    if (contact.loneliness_signal) out.push({ label: "סיגנל בדידות", value: contact.loneliness_signal, tone: "border-warning/40 bg-warning/5" });
    if (contact.relationship_readiness) out.push({ label: "מוכנות לקשר", value: contact.relationship_readiness });
    if (contact.vip_potential) out.push({ label: "פוטנציאל VIP", value: contact.vip_potential });
    if (contact.purchase_intent) out.push({ label: "כוונת רכישה", value: contact.purchase_intent });
    return out;
  }, [contact]);

  return (
    <div className="xl:sticky xl:top-6 space-y-4">
      <Card className="p-5 shadow-[var(--shadow-elevated)] border-border/60">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl flex items-center justify-center bg-primary/10 text-primary">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">AI Insights</div>
              <div className="text-sm font-bold">דשבורד תובנות חי</div>
            </div>
          </div>
        </div>

        {insights.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6">
            תובנות יופיעו כאן ככל שתמר תלמד יותר על איש הקשר.
          </div>
        ) : (
          <div className="space-y-2">
            {insights.map((i, idx) => (
              <div key={idx} className={`p-3 rounded-lg border ${i.tone || "bg-card"}`}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{i.label}</div>
                <div className="text-sm mt-0.5 leading-snug">{i.value}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Likely needs / triggers / objections */}
      {(contact.likely_needs?.length || contact.decision_triggers?.length || contact.objections?.length) ? (
        <Card className="p-5 shadow-[var(--shadow-card)] space-y-3">
          {contact.likely_needs?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">צרכים סבירים</div>
              <div className="flex flex-wrap gap-1">
                {contact.likely_needs.map((n: string) => <Badge key={n} variant="secondary" className="text-[10px]">{n}</Badge>)}
              </div>
            </div>
          )}
          {contact.decision_triggers?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">טריגרים להחלטה</div>
              <div className="flex flex-wrap gap-1">
                {contact.decision_triggers.map((n: string) => <Badge key={n} variant="outline" className="text-[10px] border-success/40 text-success">{n}</Badge>)}
              </div>
            </div>
          )}
          {contact.objections?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">התנגדויות</div>
              <div className="flex flex-wrap gap-1">
                {contact.objections.map((n: string) => <Badge key={n} variant="outline" className="text-[10px] border-destructive/40 text-destructive">{n}</Badge>)}
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {/* Quick reference: full intelligence panel link */}
      <Card className="p-4 bg-gradient-to-br from-primary/5 to-card border-primary/20">
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          המנוע מנתח כל הודעת WhatsApp אוטומטית ומעדכן זיכרון, תובנות ופעולות מומלצות.
        </div>
      </Card>
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
/* ============================================================
 * Intake Progress (V1)
 * ============================================================ */
const INTAKE_FIELD_LABELS: Record<string, string> = {
  first_name: "שם פרטי",
  age_or_birth_date: "גיל / טווח גילים",
  city_or_region: "אזור מגורים",
  social_or_relationship_goal: "מטרה חברתית/זוגית",
  preferred_activity_type: "סוגי פעילות מועדפים",
  budget_sensitivity_or_range: "טווח תקציב",
  language_style_preference: "סגנון פנייה",
  source_attribution: "מקור הגעה",
};

const INTAKE_STATE_TONE: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  active: "bg-primary/15 text-primary",
  paused: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-800",
  blocked: "bg-rose-100 text-rose-800",
  handoff: "bg-rose-100 text-rose-800",
};

function IntakeProgressCard({ contact, contactId }: { contact: any; contactId: string }) {
  const state = contact?.intake_state ?? "not_started";
  const stage = contact?.intake_stage ?? "identity";
  const completed: string[] = Array.isArray(contact?.intake_completed_fields)
    ? contact!.intake_completed_fields
    : [];
  const missing: string[] = Array.isArray(contact?.intake_missing_fields)
    ? contact!.intake_missing_fields
    : [];
  const total = completed.length + missing.length || 8;
  const score = contact?.intake_completion_score ?? Math.round((completed.length / total) * 100);
  const nextField = missing.find((k) => k !== "source_attribution") ?? null;
  const birthdayKnown = !!(contact?.birth_date || (contact?.birthday_day && contact?.birthday_month));

  const { data: captures } = useQuery({
    queryKey: ["intake-captures", contactId],
    queryFn: async () => {
      const { data } = await supabase
        .from("intake_field_captures" as any)
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(10);
      return (data ?? []) as any[];
    },
  });

  return (
    <Card className="p-5 shadow-[var(--shadow-card)] space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-bold">Intake Workflow</h3>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${INTAKE_STATE_TONE[state] ?? INTAKE_STATE_TONE.not_started}`}>
            {state}
          </span>
          <Badge variant="outline">שלב: {stage}</Badge>
        </div>
        <div className="text-sm text-muted-foreground">
          {completed.length}/{total} שדות · {score}%
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${score}%` }} />
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {birthdayKnown ? (
          <Badge className="bg-pink-100 text-pink-800 border-pink-200">🎂 birthday trigger active</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">birthday trigger missing</Badge>
        )}
        {nextField && (
          <Badge variant="outline">השאלה הבאה: {INTAKE_FIELD_LABELS[nextField] ?? nextField}</Badge>
        )}
      </div>

      {completed.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">נאספו</div>
          <div className="flex flex-wrap gap-1.5">
            {completed.map((k) => (
              <Badge key={k} className="bg-emerald-100 text-emerald-800 border-emerald-200">
                {INTAKE_FIELD_LABELS[k] ?? k}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {missing.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">חסרים</div>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((k) => (
              <Badge key={k} variant="outline" className="text-muted-foreground">
                {INTAKE_FIELD_LABELS[k] ?? k}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground pt-2 border-t border-border/60">
        <div>
          <div className="font-medium">שאלה אחרונה</div>
          <div className="font-mono">{contact?.intake_last_question_key ?? "—"}</div>
          <div>{contact?.intake_last_question_at ? formatRelative(contact.intake_last_question_at) : ""}</div>
        </div>
        <div>
          <div className="font-medium">נקלט לאחרונה</div>
          <div className="font-mono">{contact?.intake_last_captured_field ?? "—"}</div>
          <div>{contact?.intake_last_captured_at ? formatRelative(contact.intake_last_captured_at) : ""}</div>
        </div>
      </div>

      {captures && captures.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            יומן קליטות אחרונות ({captures.length})
          </summary>
          <div className="mt-2 space-y-1">
            {captures.map((c: any) => (
              <div key={c.id} className="font-mono">
                [{new Date(c.created_at).toLocaleString()}] {c.field_key} = {c.value_text} (conf {c.confidence}, {c.source})
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
