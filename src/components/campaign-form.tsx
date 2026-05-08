import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTAKE_FLOW_LABELS } from "@/lib/intake-flows";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground/80 pt-3 pb-1 border-b border-border/60 mb-3">{children}</h3>;
}

function csvToArr(s: string) { return s.split(",").map((x) => x.trim()).filter(Boolean); }
function arrToCsv(a: any) { return Array.isArray(a) ? a.join(", ") : ""; }

export function CampaignForm({ initial, onSaved }: { initial?: any; onSaved?: (id: string) => void }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<any>(initial || {
    name: "", status: "draft", category: "", objective: "", description: "",
    campaign_type: "", source_platform: "Facebook", ad_copy: "", landing_text: "",
    whatsapp_number: "", target_audience: "", emotional_angle: "", tone_style: "",
    intake_flow_type: "generic", desired_conversion_action: "", ai_goal: "",
    target_age_ranges: [], target_regions: [], target_personality_types: [],
    objections: [], prohibited_promises: [], ai_behavior_rules: [], faq: [],
    active_from: null, active_until: null, manager_owner_id: "",
  });

  function set(k: string, v: any) { setF((p: any) => ({ ...p, [k]: v })); }

  async function save() {
    if (!f.name?.trim()) { toast.error("שם קמפיין נדרש"); return; }
    setSaving(true);
    const payload = { ...f };
    if (!payload.active_from) payload.active_from = null;
    if (!payload.active_until) payload.active_until = null;
    let id = initial?.id;
    if (id) {
      const { error } = await supabase.from("campaigns").update(payload).eq("id", id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("נשמר");
    } else {
      const { data, error } = await supabase.from("campaigns").insert(payload).select("id").single();
      if (error) { toast.error(error.message); setSaving(false); return; }
      id = data!.id;
      toast.success("הקמפיין נוצר");
    }
    setSaving(false);
    if (onSaved && id) onSaved(id);
    else if (id) navigate({ to: "/campaigns/$id", params: { id } });
  }

  return (
    <Card className="p-6 space-y-4 max-w-4xl">
      <SectionHeading>פרטים בסיסיים</SectionHeading>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>שם קמפיין *</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div><Label>סטטוס</Label>
          <Select value={f.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">טיוטה</SelectItem>
              <SelectItem value="active">פעיל</SelectItem>
              <SelectItem value="paused">מושהה</SelectItem>
              <SelectItem value="completed">הסתיים</SelectItem>
              <SelectItem value="archived">ארכיון</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>קטגוריה</Label><Input value={f.category || ""} onChange={(e) => set("category", e.target.value)} placeholder="trip, event, dating..." /></div>
        <div><Label>סוג קמפיין</Label><Input value={f.campaign_type || ""} onChange={(e) => set("campaign_type", e.target.value)} placeholder="awareness / lead-gen / conversion" /></div>
        <div className="sm:col-span-2"><Label>אובייקטיב</Label><Input value={f.objective || ""} onChange={(e) => set("objective", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label>תיאור</Label><Textarea rows={3} value={f.description || ""} onChange={(e) => set("description", e.target.value)} /></div>
      </div>

      <SectionHeading>פלטפורמה ותוכן</SectionHeading>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>פלטפורמת מקור</Label><Input value={f.source_platform || ""} onChange={(e) => set("source_platform", e.target.value)} placeholder="Facebook / Instagram / TikTok" /></div>
        <div><Label>WhatsApp ייעודי</Label><Input dir="ltr" value={f.whatsapp_number || ""} onChange={(e) => set("whatsapp_number", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label>טקסט מודעה</Label><Textarea rows={3} value={f.ad_copy || ""} onChange={(e) => set("ad_copy", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label>טקסט דף נחיתה</Label><Textarea rows={3} value={f.landing_text || ""} onChange={(e) => set("landing_text", e.target.value)} /></div>
      </div>

      <SectionHeading>קהל יעד</SectionHeading>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><Label>תיאור קהל</Label><Input value={f.target_audience || ""} onChange={(e) => set("target_audience", e.target.value)} /></div>
        <div><Label>טווחי גיל (פסיקים)</Label><Input value={arrToCsv(f.target_age_ranges)} onChange={(e) => set("target_age_ranges", csvToArr(e.target.value))} placeholder="25-34, 35-44" /></div>
        <div><Label>אזורים</Label><Input value={arrToCsv(f.target_regions)} onChange={(e) => set("target_regions", csvToArr(e.target.value))} placeholder="מרכז, צפון" /></div>
        <div className="sm:col-span-2"><Label>סוגי אישיות</Label><Input value={arrToCsv(f.target_personality_types)} onChange={(e) => set("target_personality_types", csvToArr(e.target.value))} placeholder="חברותי, יצירתי" /></div>
      </div>

      <SectionHeading>אינטליגנציית AI</SectionHeading>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>זרימת אינטייק</Label>
          <Select value={f.intake_flow_type} onValueChange={(v) => set("intake_flow_type", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(INTAKE_FLOW_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div><Label>סגנון טון</Label><Input value={f.tone_style || ""} onChange={(e) => set("tone_style", e.target.value)} placeholder="חם, מקצועי, קליל" /></div>
        <div className="sm:col-span-2"><Label>זווית רגשית</Label><Input value={f.emotional_angle || ""} onChange={(e) => set("emotional_angle", e.target.value)} placeholder="שייכות, חופש, ריגוש..." /></div>
        <div className="sm:col-span-2"><Label>יעד AI</Label><Textarea rows={2} value={f.ai_goal || ""} onChange={(e) => set("ai_goal", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label>פעולת המרה רצויה</Label><Input value={f.desired_conversion_action || ""} onChange={(e) => set("desired_conversion_action", e.target.value)} /></div>
        <div><Label>התנגדויות (פסיקים)</Label><Textarea rows={2} value={arrToCsv(f.objections)} onChange={(e) => set("objections", csvToArr(e.target.value))} /></div>
        <div><Label>אסור להבטיח</Label><Textarea rows={2} value={arrToCsv(f.prohibited_promises)} onChange={(e) => set("prohibited_promises", csvToArr(e.target.value))} /></div>
      </div>

      <SectionHeading>תקופת פעילות</SectionHeading>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>פעיל מ</Label><Input type="datetime-local" value={f.active_from?.slice(0, 16) || ""} onChange={(e) => set("active_from", e.target.value ? new Date(e.target.value).toISOString() : null)} /></div>
        <div><Label>פעיל עד</Label><Input type="datetime-local" value={f.active_until?.slice(0, 16) || ""} onChange={(e) => set("active_until", e.target.value ? new Date(e.target.value).toISOString() : null)} /></div>
        <div className="sm:col-span-2"><Label>מנהל אחראי</Label><Input value={f.manager_owner_id || ""} onChange={(e) => set("manager_owner_id", e.target.value)} /></div>
      </div>

      <div className="flex justify-end gap-2 pt-3">
        <Button variant="outline" onClick={() => navigate({ to: "/campaigns" })}>ביטול</Button>
        <Button onClick={save} disabled={saving}>{saving ? "שומר..." : "שמור"}</Button>
      </div>
    </Card>
  );
}