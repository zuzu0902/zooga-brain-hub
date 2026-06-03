import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Bot, Loader2, Save, RotateCw, Sparkles, FileText, Activity } from "lucide-react";

export const Route = createFileRoute("/_app/settings/tamar")({
  head: () => ({ meta: [{ title: "Tamar Behavior — Zooga CRM" }] }),
  component: TamarBehaviorPage,
});

type Settings = {
  tone_preset: string;
  confidence_auto_apply_min: number;
  confidence_pending_max: number;
  confidence_high_min: number;
  confidence_medium_min: number;
  memory_write_policy: string;
  memory_kinds_enabled: string[];
  handoff_on_factual_doubt: boolean;
  handoff_confidence_threshold: number;
  handoff_keywords: string[];
  routing_mode: string;
  routing_allow_autonomous_offers: boolean;
  routing_allow_autonomous_campaigns: boolean;
  sales_aggressiveness: string;
  sales_max_followups_per_week: number;
  warmth_level: string;
  verbosity_level: string;
  emoji_policy: string;
  naturalness_level: string;
  gender_language_sensitivity: boolean;
  therapist_mode_disabled: boolean;
  dating_counselor_mode_disabled: boolean;
  consent_timing_rule: string;
  create_contact_on_first_unknown_phone: boolean;
  service_inquiry_is_lead: boolean;
  internal_inference_visibility: string;
  no_invention_rule: boolean;
  updated_at?: string;
};

const ALL_KINDS = ["fact","preference","warning","observation","relationship_signal","offer_signal"];

function TamarBehaviorPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("tamar_behavior_settings" as any)
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) toast.error(error.message);
    setS((data as any) ?? null);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!s) return;
    setSaving(true);
    const { error } = await supabase
      .from("tamar_behavior_settings" as any)
      .update({ ...s, id: 1 })
      .eq("id", 1);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("נשמר");
  }

  async function runBackfill() {
    setRunning(true);
    try {
      const tokenInput = window.prompt("הזן DEBUG_READ_ONLY_TOKEN להפעלת backfill (פעולה אדמיניסטרטיבית)");
      if (!tokenInput) return;
      const resp = await fetch("/api/public/admin/backfill-memories", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-debug-token": tokenInput },
        body: JSON.stringify({ limit_contacts: 500 }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error || `HTTP ${resp.status}`);
      toast.success(`Backfill הסתיים. נוספו ${j.inserted_total} זיכרונות (W:${j.inserted_by_kind?.warning ?? 0} O:${j.inserted_by_kind?.observation ?? 0} R:${j.inserted_by_kind?.relationship_signal ?? 0} S:${j.inserted_by_kind?.offer_signal ?? 0})`);
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally { setRunning(false); }
  }

  if (loading) return <div className="p-6" dir="rtl">טוען…</div>;
  if (!s) return <div className="p-6" dir="rtl">לא נמצאו הגדרות.</div>;

  const u = (patch: Partial<Settings>) => setS({ ...s, ...patch });

  return (
    <div className="p-6 space-y-6 max-w-[1100px] mx-auto" dir="rtl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" /> Tamar Behavior Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            מדיניות התנהגות מבצעית של Tamar. זוגה היא ה-source-of-truth; שינויים כאן משפיעים על routing, memory writes, handoff ו-AI proposals.
          </p>
        </div>
        <Button onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          שמור שינויים
        </Button>
      </div>

      <Card className="p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4" /> Tone & language</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Tone preset</Label>
            <Select value={s.tone_preset} onValueChange={(v) => u({ tone_preset: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="warm-professional-hebrew">warm-professional-hebrew (ברירת מחדל)</SelectItem>
                <SelectItem value="warm-casual-hebrew">warm-casual-hebrew</SelectItem>
                <SelectItem value="formal-hebrew">formal-hebrew</SelectItem>
                <SelectItem value="energetic-hebrew">energetic-hebrew</SelectItem>
                <SelectItem value="empathetic-hebrew">empathetic-hebrew</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sales aggressiveness</Label>
            <Select value={s.sales_aggressiveness} onValueChange={(v) => u({ sales_aggressiveness: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="soft">soft</SelectItem>
                <SelectItem value="balanced">balanced</SelectItem>
                <SelectItem value="assertive">assertive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Max follow-ups per week</Label>
            <Input type="number" min={0} max={14} value={s.sales_max_followups_per_week}
              onChange={(e) => u({ sales_max_followups_per_week: Number(e.target.value) || 0 })} />
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <h2 className="font-semibold">Confidence thresholds</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Auto-apply min (≥)</Label>
            <Input type="number" min={0} max={100} value={s.confidence_auto_apply_min}
              onChange={(e) => u({ confidence_auto_apply_min: Number(e.target.value) || 0 })} />
          </div>
          <div>
            <Label>Pending review max (≤)</Label>
            <Input type="number" min={0} max={100} value={s.confidence_pending_max}
              onChange={(e) => u({ confidence_pending_max: Number(e.target.value) || 0 })} />
          </div>
          <div>
            <Label>Band — High min</Label>
            <Input type="number" min={0} max={100} value={s.confidence_high_min}
              onChange={(e) => u({ confidence_high_min: Number(e.target.value) || 0 })} />
          </div>
          <div>
            <Label>Band — Medium min</Label>
            <Input type="number" min={0} max={100} value={s.confidence_medium_min}
              onChange={(e) => u({ confidence_medium_min: Number(e.target.value) || 0 })} />
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <h2 className="font-semibold">Memory write policy</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Policy</Label>
            <Select value={s.memory_write_policy} onValueChange={(v) => u({ memory_write_policy: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="explicit_only">explicit_only — only user-stated facts</SelectItem>
                <SelectItem value="high_confidence_or_explicit">high_confidence_or_explicit (ברירת מחדל)</SelectItem>
                <SelectItem value="aggressive">aggressive — write any plausible signal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Enabled memory kinds</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {ALL_KINDS.map((k) => {
                const on = s.memory_kinds_enabled?.includes(k);
                return (
                  <Badge key={k} variant={on ? "default" : "outline"} className="cursor-pointer"
                    onClick={() => u({ memory_kinds_enabled: on ? s.memory_kinds_enabled.filter((x) => x !== k) : [...(s.memory_kinds_enabled ?? []), k] })}>
                    {k}
                  </Badge>
                );
              })}
            </div>
          </div>
        </div>
        <div className="border-t pt-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-muted-foreground">
            Backfill v2 — מילוי קטגוריות warning/observation/relationship_signal/offer_signal על אינטראקציות היסטוריות (heuristic, idempotent).
          </div>
          <Button variant="outline" disabled={running} onClick={runBackfill} className="gap-1.5">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            הרץ Backfill
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <h2 className="font-semibold">Handoff policy</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Handoff confidence threshold (below → handoff)</Label>
            <Input type="number" min={0} max={100} value={s.handoff_confidence_threshold}
              onChange={(e) => u({ handoff_confidence_threshold: Number(e.target.value) || 0 })} />
          </div>
          <div className="flex items-center justify-between border rounded-md px-3 py-2">
            <div>
              <div className="text-sm font-medium">Hand off on factual doubt</div>
              <div className="text-xs text-muted-foreground">If the model is uncertain about a fact, escalate.</div>
            </div>
            <Switch checked={s.handoff_on_factual_doubt} onCheckedChange={(v) => u({ handoff_on_factual_doubt: v })} />
          </div>
          <div className="md:col-span-2">
            <Label>Handoff keywords (one per line — Hebrew)</Label>
            <Textarea rows={4} value={(s.handoff_keywords ?? []).join("\n")}
              onChange={(e) => u({ handoff_keywords: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <h2 className="font-semibold">Routing behavior</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Routing mode</Label>
            <Select value={s.routing_mode} onValueChange={(v) => u({ routing_mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="proposal_first">proposal_first (ברירת מחדל)</SelectItem>
                <SelectItem value="assistive">assistive — Tamar acts only after explicit approval</SelectItem>
                <SelectItem value="autonomous">autonomous — Tamar may act without per-message approval</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between border rounded-md px-3 py-2">
            <div>
              <div className="text-sm font-medium">Allow autonomous offer dispatch</div>
              <div className="text-xs text-muted-foreground">Tamar may send offers without manager approval.</div>
            </div>
            <Switch checked={s.routing_allow_autonomous_offers} onCheckedChange={(v) => u({ routing_allow_autonomous_offers: v })} />
          </div>
          <div className="flex items-center justify-between border rounded-md px-3 py-2">
            <div>
              <div className="text-sm font-medium">Allow autonomous campaign launches</div>
              <div className="text-xs text-muted-foreground">Off until autonomous campaign agent ships.</div>
            </div>
            <Switch checked={s.routing_allow_autonomous_campaigns} onCheckedChange={(v) => u({ routing_allow_autonomous_campaigns: v })} />
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <h2 className="font-semibold">Structured behavior (Tamar runtime)</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Warmth level</Label>
            <Select value={s.warmth_level} onValueChange={(v) => u({ warmth_level: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="reserved">reserved</SelectItem>
                <SelectItem value="warm">warm</SelectItem>
                <SelectItem value="very_warm">very_warm</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Verbosity</Label>
            <Select value={s.verbosity_level} onValueChange={(v) => u({ verbosity_level: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="terse">terse</SelectItem>
                <SelectItem value="concise">concise</SelectItem>
                <SelectItem value="detailed">detailed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Emoji policy</Label>
            <Select value={s.emoji_policy} onValueChange={(v) => u({ emoji_policy: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">none</SelectItem>
                <SelectItem value="sparing">sparing</SelectItem>
                <SelectItem value="liberal">liberal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Naturalness / formality</Label>
            <Select value={s.naturalness_level} onValueChange={(v) => u({ naturalness_level: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="formal">formal</SelectItem>
                <SelectItem value="natural">natural</SelectItem>
                <SelectItem value="casual">casual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Consent timing rule</Label>
            <Select value={s.consent_timing_rule} onValueChange={(v) => u({ consent_timing_rule: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">immediate</SelectItem>
                <SelectItem value="after_first_meaningful_reply">after_first_meaningful_reply</SelectItem>
                <SelectItem value="before_offer">before_offer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Internal inference visibility</Label>
            <Select value={s.internal_inference_visibility} onValueChange={(v) => u({ internal_inference_visibility: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manager_only">manager_only</SelectItem>
                <SelectItem value="never">never</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between border rounded-md px-3 py-2">
            <div className="text-sm font-medium">Gender-language sensitivity (Hebrew)</div>
            <Switch checked={s.gender_language_sensitivity} onCheckedChange={(v) => u({ gender_language_sensitivity: v })} />
          </div>
          <div className="flex items-center justify-between border rounded-md px-3 py-2">
            <div className="text-sm font-medium">Therapist mode disabled</div>
            <Switch checked={s.therapist_mode_disabled} onCheckedChange={(v) => u({ therapist_mode_disabled: v })} />
          </div>
          <div className="flex items-center justify-between border rounded-md px-3 py-2">
            <div className="text-sm font-medium">Dating-counselor mode disabled</div>
            <Switch checked={s.dating_counselor_mode_disabled} onCheckedChange={(v) => u({ dating_counselor_mode_disabled: v })} />
          </div>
          <div className="flex items-center justify-between border rounded-md px-3 py-2">
            <div className="text-sm font-medium">Create contact on first unknown phone</div>
            <Switch checked={s.create_contact_on_first_unknown_phone} onCheckedChange={(v) => u({ create_contact_on_first_unknown_phone: v })} />
          </div>
          <div className="flex items-center justify-between border rounded-md px-3 py-2">
            <div className="text-sm font-medium">Service inquiry counts as lead</div>
            <Switch checked={s.service_inquiry_is_lead} onCheckedChange={(v) => u({ service_inquiry_is_lead: v })} />
          </div>
          <div className="flex items-center justify-between border rounded-md px-3 py-2">
            <div className="text-sm font-medium">No-invention rule (must not fabricate facts)</div>
            <Switch checked={s.no_invention_rule} onCheckedChange={(v) => u({ no_invention_rule: v })} />
          </div>
        </div>
      </Card>

      <div className="text-xs text-muted-foreground">
        עודכן לאחרונה: {s.updated_at ? new Date(s.updated_at).toLocaleString("he-IL") : "—"}
      </div>
    </div>
  );
}