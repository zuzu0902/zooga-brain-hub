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
import { OfferPicker } from "@/components/offer-picker";
import { useT } from "@/lib/language-context";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground/80 pt-3 pb-1 border-b border-border/60 mb-3">{children}</h3>;
}

function csvToArr(s: string) { return s.split(",").map((x) => x.trim()).filter(Boolean); }
function arrToCsv(a: any) { return Array.isArray(a) ? a.join(", ") : ""; }

export function CampaignForm({ initial, onSaved }: { initial?: any; onSaved?: (id: string) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const defaults = {
    name: "", status: "draft", category: "", objective: "", description: "",
    campaign_type: "", source_platform: "Facebook", ad_copy: "", landing_text: "",
    whatsapp_number: "", target_audience: "", emotional_angle: "", tone_style: "",
    intake_flow_type: "generic", desired_conversion_action: "", ai_goal: "",
    target_age_ranges: [], target_regions: [], target_personality_types: [],
    objections: [], prohibited_promises: [], ai_behavior_rules: [], faq: [],
    active_from: null, active_until: null, manager_owner_id: "", offer_id: null,
  };
  const [f, setF] = useState<any>(initial?.id ? initial : { ...defaults, ...(initial || {}) });

  function set(k: string, v: any) { setF((p: any) => ({ ...p, [k]: v })); }

  async function save() {
    if (!f.name?.trim()) { toast.error(t("שם קמפיין נדרש")); return; }
    setSaving(true);
    const payload = { ...f };
    if (!payload.active_from) payload.active_from = null;
    if (!payload.active_until) payload.active_until = null;
    let id = initial?.id;
    if (id) {
      const { error } = await supabase.from("campaigns").update(payload).eq("id", id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success(t("נשמר"));
    } else {
      const { data, error } = await supabase.from("campaigns").insert(payload).select("id").single();
      if (error) { toast.error(error.message); setSaving(false); return; }
      id = data!.id;
      toast.success(t("הקמפיין נוצר"));
    }
    setSaving(false);
    if (onSaved && id) onSaved(id);
    else if (id) navigate({ to: "/campaigns/$id", params: { id } });
  }

  return (
    <Card className="p-6 space-y-4 max-w-4xl">
      <SectionHeading>{t("פרטים בסיסיים")}</SectionHeading>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>{t("שם קמפיין *")}</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div><Label>{t("סטטוס")}</Label>
          <Select value={f.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">{t("טיוטה")}</SelectItem>
              <SelectItem value="active">{t("פעיל")}</SelectItem>
              <SelectItem value="paused">{t("מושהה")}</SelectItem>
              <SelectItem value="completed">{t("הסתיים")}</SelectItem>
              <SelectItem value="archived">{t("ארכיון")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>{t("קטגוריה")}</Label><Input value={f.category || ""} onChange={(e) => set("category", e.target.value)} placeholder="trip, event, dating..." /></div>
        <div><Label>{t("סוג קמפיין")}</Label><Input value={f.campaign_type || ""} onChange={(e) => set("campaign_type", e.target.value)} placeholder="awareness / lead-gen / conversion" /></div>
        <div className="sm:col-span-2"><Label>{t("אובייקטיב")}</Label><Input value={f.objective || ""} onChange={(e) => set("objective", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label>{t("תיאור")}</Label><Textarea rows={3} value={f.description || ""} onChange={(e) => set("description", e.target.value)} /></div>
      </div>

      <SectionHeading>{t("הצעה מקושרת")}</SectionHeading>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t("בחר את ההצעה (המוצר/שירות) שהקמפיין מקדם. תמר תדע להציע אותה בשיחה.")}</p>
        <OfferPicker value={f.offer_id} onChange={(id) => set("offer_id", id)} />
      </div>

      <SectionHeading>{t("פלטפורמה ותוכן")}</SectionHeading>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>{t("פלטפורמת מקור")}</Label><Input value={f.source_platform || ""} onChange={(e) => set("source_platform", e.target.value)} placeholder="Facebook / Instagram / TikTok" /></div>
        <div><Label>{t("WhatsApp ייעודי")}</Label><Input dir="ltr" value={f.whatsapp_number || ""} onChange={(e) => set("whatsapp_number", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label>{t("טקסט מודעה")}</Label><Textarea rows={3} value={f.ad_copy || ""} onChange={(e) => set("ad_copy", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label>{t("טקסט דף נחיתה")}</Label><Textarea rows={3} value={f.landing_text || ""} onChange={(e) => set("landing_text", e.target.value)} /></div>
      </div>

      <SectionHeading>{t("קהל יעד")}</SectionHeading>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><Label>{t("תיאור קהל")}</Label><Input value={f.target_audience || ""} onChange={(e) => set("target_audience", e.target.value)} /></div>
        <div><Label>{t("טווחי גיל (פסיקים)")}</Label><Input value={arrToCsv(f.target_age_ranges)} onChange={(e) => set("target_age_ranges", csvToArr(e.target.value))} placeholder="25-34, 35-44" /></div>
        <div><Label>{t("אזורים")}</Label><Input value={arrToCsv(f.target_regions)} onChange={(e) => set("target_regions", csvToArr(e.target.value))} placeholder={t("מרכז, צפון")} /></div>
        <div className="sm:col-span-2"><Label>{t("סוגי אישיות")}</Label><Input value={arrToCsv(f.target_personality_types)} onChange={(e) => set("target_personality_types", csvToArr(e.target.value))} placeholder={t("חברותי, יצירתי")} /></div>
      </div>

      <SectionHeading>{t("אינטליגנציית AI")}</SectionHeading>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>{t("זרימת אינטייק")}</Label>
          <Select value={f.intake_flow_type} onValueChange={(v) => set("intake_flow_type", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(INTAKE_FLOW_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{t(v)}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div><Label>{t("סגנון טון")}</Label><Input value={f.tone_style || ""} onChange={(e) => set("tone_style", e.target.value)} placeholder={t("חם, מקצועי, קליל")} /></div>
        <div className="sm:col-span-2"><Label>{t("זווית רגשית")}</Label><Input value={f.emotional_angle || ""} onChange={(e) => set("emotional_angle", e.target.value)} placeholder={t("שייכות, חופש, ריגוש...")} /></div>
        <div className="sm:col-span-2"><Label>{t("יעד AI")}</Label><Textarea rows={2} value={f.ai_goal || ""} onChange={(e) => set("ai_goal", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label>{t("פעולת המרה רצויה")}</Label><Input value={f.desired_conversion_action || ""} onChange={(e) => set("desired_conversion_action", e.target.value)} /></div>
        <div><Label>{t("התנגדויות (פסיקים)")}</Label><Textarea rows={2} value={arrToCsv(f.objections)} onChange={(e) => set("objections", csvToArr(e.target.value))} /></div>
        <div><Label>{t("אסור להבטיח")}</Label><Textarea rows={2} value={arrToCsv(f.prohibited_promises)} onChange={(e) => set("prohibited_promises", csvToArr(e.target.value))} /></div>
      </div>

      <SectionHeading>{t("תקופת פעילות")}</SectionHeading>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>{t("פעיל מ")}</Label><Input type="datetime-local" value={f.active_from?.slice(0, 16) || ""} onChange={(e) => set("active_from", e.target.value ? new Date(e.target.value).toISOString() : null)} /></div>
        <div><Label>{t("פעיל עד")}</Label><Input type="datetime-local" value={f.active_until?.slice(0, 16) || ""} onChange={(e) => set("active_until", e.target.value ? new Date(e.target.value).toISOString() : null)} /></div>
        <div className="sm:col-span-2"><Label>{t("מנהל אחראי")}</Label><Input value={f.manager_owner_id || ""} onChange={(e) => set("manager_owner_id", e.target.value)} /></div>
      </div>

      <div className="flex justify-end gap-2 pt-3">
        <Button variant="outline" onClick={() => navigate({ to: "/campaigns" })}>{t("ביטול")}</Button>
        <Button onClick={save} disabled={saving}>{saving ? t("שומר...") : t("שמור")}</Button>
      </div>
    </Card>
  );
}