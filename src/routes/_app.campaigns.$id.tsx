import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Megaphone, Users, Activity, Flame, Trophy, AlertTriangle, ChevronRight,
  Pencil, Trash2, MessageCircle, Sparkles, Target, Tag,
} from "lucide-react";
import { CampaignForm } from "@/components/campaign-form";
import { INTAKE_FLOW_LABELS, INTAKE_FLOWS } from "@/lib/intake-flows";
import { formatRelative } from "@/lib/i18n";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/campaigns/$id")({
  head: () => ({ meta: [{ title: "פרופיל קמפיין — Zooga CRM" }] }),
  component: CampaignDetailPage,
});

const STATUS_LABELS: Record<string, string> = {
  draft: "טיוטה", active: "פעיל", paused: "מושהה", completed: "הסתיים", archived: "ארכיון",
};
const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  draft: "bg-muted text-muted-foreground border-border",
  paused: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  completed: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  archived: "bg-muted text-muted-foreground/60 border-border",
};

function SectionHeading({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-6 pb-2 border-b border-border/60 mb-4">
      <Icon className="h-4 w-4 text-primary" />
      <h2 className="text-base font-semibold text-foreground/90">{children}</h2>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: any; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${tone || "bg-primary/10 text-primary"}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground truncate">{label}</div>
          <div className="text-xl font-bold">{value}</div>
        </div>
      </div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return null;
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-sm">{Array.isArray(value) ? value.join(", ") : String(value)}</div>
    </div>
  );
}

function CampaignDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const { data: campaign, isLoading, refetch } = useQuery({
    queryKey: ["campaign", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaigns").select("*, offer:offer_id(id,title,price,category,status,description)").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: cc } = useQuery({
    queryKey: ["campaign_contacts", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("campaign_contacts")
        .select("*, contacts:contact_id(id, full_name, first_name, last_name, phone, manager_attention_required, sales_temperature)")
        .eq("campaign_id", id)
        .order("last_activity_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: interactions } = useQuery({
    queryKey: ["campaign_interactions", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("interactions")
        .select("*")
        .eq("campaign_id", id)
        .order("timestamp", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  if (isLoading) return <div className="p-10 text-center text-muted-foreground" dir="rtl">טוען...</div>;
  if (!campaign) return (
    <div className="p-10 text-center" dir="rtl">
      <p className="text-muted-foreground mb-4">קמפיין לא נמצא</p>
      <Link to="/campaigns"><Button variant="outline">חזרה לרשימה</Button></Link>
    </div>
  );

  const list = cc || [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const stats = {
    contacts: list.length,
    active: list.filter((r: any) => r.last_activity_at && new Date(r.last_activity_at) > sevenDaysAgo).length,
    hot: list.filter((r: any) => r.intent_level === "high").length,
    conversions: list.filter((r: any) => r.conversion_stage === "converted").length,
    escalations: list.filter((r: any) => r.contacts?.manager_attention_required).length,
    fitAvg: list.length ? Math.round(list.reduce((s: number, r: any) => s + (r.fit_score || 0), 0) / list.length) : 0,
  };

  async function remove() {
    if (!confirm("למחוק את הקמפיין?")) return;
    const { error } = await supabase.from("campaigns").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("נמחק");
    navigate({ to: "/campaigns" });
  }

  if (editing) {
    return (
      <div className="p-6 space-y-4" dir="rtl">
        <h1 className="text-3xl font-bold">עריכת קמפיין</h1>
        <CampaignForm initial={campaign} onSaved={() => { setEditing(false); refetch(); }} />
      </div>
    );
  }

  const flow = (campaign.intake_flow_type || "generic") as keyof typeof INTAKE_FLOWS;
  const flowDef = INTAKE_FLOWS[flow];

  return (
    <div className="p-6 space-y-2 max-w-6xl" dir="rtl">
      <nav className="text-sm text-muted-foreground flex items-center gap-1 mb-2">
        <Link to="/campaigns" className="hover:text-foreground">קמפיינים</Link>
        <ChevronRight className="h-3 w-3 rotate-180" />
        <span className="text-foreground truncate">{campaign.name}</span>
      </nav>

      {/* Header */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-14 w-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Megaphone className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
                <Badge variant="outline" className={STATUS_TONE[campaign.status]}>{STATUS_LABELS[campaign.status]}</Badge>
              </div>
              {campaign.objective && <p className="text-muted-foreground mt-1">{campaign.objective}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                {campaign.source_platform && <Badge variant="secondary">{campaign.source_platform}</Badge>}
                {campaign.category && <Badge variant="secondary">{campaign.category}</Badge>}
                <Badge variant="secondary">{INTAKE_FLOW_LABELS[flow]}</Badge>
                <span>· עודכן {formatRelative(campaign.updated_at)}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-1" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> ערוך</Button>
            <Button variant="outline" className="gap-1 text-destructive" onClick={remove}><Trash2 className="h-4 w-4" /> מחק</Button>
          </div>
        </div>
      </Card>

      <SectionHeading icon={Activity}>ביצועים</SectionHeading>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Users} label="אנשי קשר" value={stats.contacts} />
        <StatCard icon={Activity} label="שיחות פעילות" value={stats.active} tone="bg-emerald-500/10 text-emerald-700" />
        <StatCard icon={Flame} label="לידים חמים" value={stats.hot} tone="bg-red-500/10 text-red-700" />
        <StatCard icon={Trophy} label="המרות" value={stats.conversions} tone="bg-amber-500/10 text-amber-700" />
        <StatCard icon={AlertTriangle} label="הסלמות" value={stats.escalations} tone="bg-orange-500/10 text-orange-700" />
        <StatCard icon={Target} label="ציון התאמה ממוצע" value={stats.fitAvg} tone="bg-blue-500/10 text-blue-700" />
      </div>

      <SectionHeading icon={Tag}>הצעה מקושרת</SectionHeading>
      <Card className="p-5">
        {campaign.offer ? (
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Tag className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link to="/offers/$id" params={{ id: campaign.offer.id }} className="font-semibold text-base hover:text-primary">
                    {campaign.offer.title}
                  </Link>
                  {campaign.offer.price && <Badge>₪{campaign.offer.price}</Badge>}
                  <Badge variant="outline">{campaign.offer.status}</Badge>
                </div>
                {campaign.offer.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{campaign.offer.description}</p>}
              </div>
            </div>
            <Link to="/offers/$id" params={{ id: campaign.offer.id }}>
              <Button variant="outline" size="sm">פתח הצעה</Button>
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30">לא משויך להצעה</Badge>
              <span className="text-muted-foreground">קמפיין ללא הצעה לא יוכל להציע מוצר ספציפי בשיחה.</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>שייך עכשיו</Button>
          </div>
        )}
      </Card>

      <SectionHeading icon={Megaphone}>סקירה כללית</SectionHeading>
      <Card className="p-5 grid sm:grid-cols-2 gap-4">
        <Field label="תיאור" value={campaign.description} />
        <Field label="סוג" value={campaign.campaign_type} />
        <Field label="מספר WhatsApp" value={campaign.whatsapp_number} />
        <Field label="פעולת המרה" value={campaign.desired_conversion_action} />
        <Field label="פעיל מ" value={campaign.active_from ? new Date(campaign.active_from).toLocaleDateString("he-IL") : null} />
        <Field label="פעיל עד" value={campaign.active_until ? new Date(campaign.active_until).toLocaleDateString("he-IL") : null} />
        <Field label="טקסט מודעה" value={campaign.ad_copy} />
        <Field label="טקסט נחיתה" value={campaign.landing_text} />
      </Card>

      <SectionHeading icon={Sparkles}>התנהגות AI</SectionHeading>
      <Card className="p-5 grid sm:grid-cols-2 gap-4">
        <Field label="יעד AI" value={campaign.ai_goal} />
        <Field label="זווית רגשית" value={campaign.emotional_angle} />
        <Field label="סגנון טון" value={campaign.tone_style} />
        <Field label="התנגדויות" value={campaign.objections} />
        <Field label="אסור להבטיח" value={campaign.prohibited_promises} />
        {Array.isArray(campaign.ai_behavior_rules) && campaign.ai_behavior_rules.length > 0 && (
          <div className="sm:col-span-2">
            <div className="text-xs text-muted-foreground mb-1">חוקי התנהגות</div>
            <ul className="list-disc pr-5 space-y-1 text-sm">
              {campaign.ai_behavior_rules.map((r: any, i: number) => (<li key={i}>{typeof r === "string" ? r : JSON.stringify(r)}</li>))}
            </ul>
          </div>
        )}
      </Card>

      <SectionHeading icon={MessageCircle}>זרימת אינטייק — {INTAKE_FLOW_LABELS[flow]}</SectionHeading>
      <Card className="p-5 space-y-3">
        <div className="text-sm text-muted-foreground">{flowDef.system_addendum}</div>
        <div>
          <div className="text-xs font-semibold mb-2">שאלות שתמר תשאל:</div>
          <ol className="list-decimal pr-5 space-y-1 text-sm">
            {flowDef.questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </div>
      </Card>

      <SectionHeading icon={Target}>קהל יעד</SectionHeading>
      <Card className="p-5 grid sm:grid-cols-2 gap-4">
        <Field label="קהל" value={campaign.target_audience} />
        <Field label="טווחי גיל" value={campaign.target_age_ranges} />
        <Field label="אזורים" value={campaign.target_regions} />
        <Field label="סוגי אישיות" value={campaign.target_personality_types} />
      </Card>

      <SectionHeading icon={Users}>אנשי קשר מקושרים ({list.length})</SectionHeading>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-3 font-medium">שם</th>
                <th className="p-3 font-medium">ציון התאמה</th>
                <th className="p-3 font-medium">רמת כוונה</th>
                <th className="p-3 font-medium">שלב</th>
                <th className="p-3 font-medium">פעילות אחרונה</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (<tr><td colSpan={5} className="p-8 text-center text-muted-foreground">עדיין אין אנשי קשר בקמפיין הזה</td></tr>)}
              {list.map((r: any) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    {r.contacts?.id ? (
                      <Link to="/contacts/$id" params={{ id: r.contacts.id }} className="font-medium hover:text-primary">
                        {r.contacts.full_name || `${r.contacts.first_name || ""} ${r.contacts.last_name || ""}`.trim() || "ללא שם"}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="p-3">{r.fit_score ?? "—"}</td>
                  <td className="p-3"><Badge variant="outline">{r.intent_level || "—"}</Badge></td>
                  <td className="p-3 text-muted-foreground">{r.conversion_stage || "—"}</td>
                  <td className="p-3 text-muted-foreground text-xs">{formatRelative(r.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <SectionHeading icon={MessageCircle}>שיחות אחרונות</SectionHeading>
      <Card className="p-5 space-y-2">
        {(!interactions || interactions.length === 0) && <div className="text-sm text-muted-foreground text-center py-4">אין שיחות מקושרות</div>}
        {interactions?.map((i: any) => (
          <div key={i.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/50">
            <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">{formatRelative(i.timestamp)} · {i.source}</div>
              <div className="text-sm mt-0.5 line-clamp-2">{i.content || "—"}</div>
            </div>
          </div>
        ))}
      </Card>

      <SectionHeading icon={AlertTriangle}>הסלמות</SectionHeading>
      <Card className="p-5">
        {stats.escalations === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-2">אין הסלמות פעילות</div>
        ) : (
          <ul className="space-y-2">
            {list.filter((r: any) => r.contacts?.manager_attention_required).map((r: any) => (
              <li key={r.id} className="flex items-center justify-between p-3 rounded-md bg-orange-500/5 border border-orange-500/20">
                <Link to="/contacts/$id" params={{ id: r.contacts.id }} className="font-medium hover:text-primary">{r.contacts.full_name || "ללא שם"}</Link>
                <Badge variant="outline" className="bg-orange-500/10 text-orange-700 border-orange-500/30">דורש מנהל</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}