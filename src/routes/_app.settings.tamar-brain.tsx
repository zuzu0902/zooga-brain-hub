import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Brain, Loader2, Play, Save, ShieldCheck } from "lucide-react";
import { useT, useLanguage } from "@/lib/language-context";
import {
  addKnowledgeSource,
  getBrainOverview,
  saveCopyVersion,
  setKnowledgeSourceStatus,
  simulateBrain,
  updateBrainPolicy,
} from "@/lib/tamar-brain.functions";

export const Route = createFileRoute("/_app/settings/tamar-brain")({
  head: () => ({
    meta: [
      { title: "Tamar Brain — Zooga CRM" },
      { name: "description", content: "Policy, copy versions, community knowledge and decision traces for the Tamar agent." },
      { property: "og:title", content: "Tamar Brain — Zooga CRM" },
      { property: "og:description", content: "Govern Tamar's consent gate, handoff policy, knowledge grounding and decision traces." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TamarBrainPage,
});

function TamarBrainPage() {
  const t = useT();
  const { dir } = useLanguage();
  const load = useServerFn(getBrainOverview);
  const savePolicy = useServerFn(updateBrainPolicy);
  const saveCopy = useServerFn(saveCopyVersion);
  const addSource = useServerFn(addKnowledgeSource);
  const setSourceStatus = useServerFn(setKnowledgeSourceStatus);
  const runSim = useServerFn(simulateBrain);

  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<any>({});
  const [copyDraft, setCopyDraft] = useState({ copy_key: "consent_opener", variant: "A", body: "", template_name: "", is_active: true });
  const [sourceDraft, setSourceDraft] = useState({ title: "", source_url: "", content: "" });
  const [sim, setSim] = useState<{ message: string; state: string; result: any }>({
    message: "אני רוצה לדבר עם בן אדם",
    state: "consented",
    result: null,
  });

  async function refresh() {
    try {
      const d: any = await load({});
      setData(d);
      setPolicy(d.policy ?? {});
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    }
  }
  useEffect(() => { refresh(); }, []);

  async function onSavePolicy() {
    setBusy(true);
    try {
      await savePolicy({
        data: {
          consent_gate_enabled: !!policy.consent_gate_enabled,
          manager_alert_enabled: !!policy.manager_alert_enabled,
          attach_transcript_to_alert: !!policy.attach_transcript_to_alert,
          knowledge_grounding_required: !!policy.knowledge_grounding_required,
          ab_testing_enabled: !!policy.ab_testing_enabled,
          kill_switch_ab: !!policy.kill_switch_ab,
          max_questions_per_message: Number(policy.max_questions_per_message ?? 1),
          value_before_question_after_answers: Number(policy.value_before_question_after_answers ?? 2),
          handoff_confidence_threshold: Number(policy.handoff_confidence_threshold ?? 55),
          recommendation_max_offers: Number(policy.recommendation_max_offers ?? 3),
        },
      });
      toast.success(t("המדיניות נשמרה"));
      refresh();
    } catch (e: any) { toast.error(String(e?.message ?? e)); }
    setBusy(false);
  }

  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground" dir={dir}>{t("טוען…")}</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto" dir={dir}>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" /> Tamar Brain
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("מדיניות קבועה, נוסחים גרסאיים, ידע קהילתי מאושר ועקבות החלטה. ה-AI לא משנה כאן שום דבר בעצמו.")}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {Object.entries(data.state_counts ?? {}).map(([state, count]) => (
          <Card key={state} className="p-3">
            <div className="text-xs text-muted-foreground">{state}</div>
            <div className="text-xl font-bold">{String(count)}</div>
          </Card>
        ))}
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">{t("התראת מנהל")}</div>
          <div className="text-sm font-semibold flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            {data.manager?.configured ? `${t("מוגדר")} (${data.manager.source})` : t("לא מוגדר")}
          </div>
        </Card>
      </div>

      <Tabs defaultValue="policy">
        <TabsList>
          <TabsTrigger value="policy">{t("מדיניות")}</TabsTrigger>
          <TabsTrigger value="copy">{t("נוסחים")}</TabsTrigger>
          <TabsTrigger value="knowledge">{t("ידע קהילתי")}</TabsTrigger>
          <TabsTrigger value="traces">{t("עקבות החלטה")}</TabsTrigger>
          <TabsTrigger value="sim">{t("סימולציה")}</TabsTrigger>
        </TabsList>

        <TabsContent value="policy" className="space-y-3 pt-4">
          <Card className="p-4 space-y-4">
            {[
              ["consent_gate_enabled", t("שער consent מחייב לפני כל intake/שיווק")],
              ["manager_alert_enabled", t("שליחת התראת WhatsApp למנהל ב-handoff")],
              ["attach_transcript_to_alert", t("צירוף תמצית שיחה להתראה")],
              ["knowledge_grounding_required", t("חובה לבסס עובדות קהילתיות על ידע מאושר")],
              ["ab_testing_enabled", t("A/B על נוסחים")],
              ["kill_switch_ab", t("Kill switch ל-A/B (חזרה לווריאנט A)")],
            ].map(([key, label]) => (
              <div key={key as string} className="flex items-center justify-between gap-4">
                <Label className="text-sm">{label}</Label>
                <Switch
                  checked={!!policy[key as string]}
                  onCheckedChange={(v) => setPolicy((p: any) => ({ ...p, [key as string]: v }))}
                />
              </div>
            ))}
            <div className="grid gap-3 md:grid-cols-4">
              {[
                ["max_questions_per_message", t("שאלות מקס' בהודעה")],
                ["value_before_question_after_answers", t("ערך לפני שאלה — אחרי X תשובות")],
                ["handoff_confidence_threshold", t("סף confidence ל-handoff")],
                ["recommendation_max_offers", t("מקס' הצעות בהמלצה")],
              ].map(([key, label]) => (
                <div key={key as string} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <Input
                    type="number"
                    value={policy[key as string] ?? ""}
                    onChange={(e) => setPolicy((p: any) => ({ ...p, [key as string]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={onSavePolicy} disabled={busy} className="gap-1.5">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("שמור")}
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="copy" className="space-y-3 pt-4">
          <Card className="p-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Input placeholder="copy_key" value={copyDraft.copy_key} onChange={(e) => setCopyDraft({ ...copyDraft, copy_key: e.target.value })} />
              <Input placeholder="variant (A/B)" value={copyDraft.variant} onChange={(e) => setCopyDraft({ ...copyDraft, variant: e.target.value })} />
              <Input placeholder="template_name (optional)" value={copyDraft.template_name} onChange={(e) => setCopyDraft({ ...copyDraft, template_name: e.target.value })} />
            </div>
            <Textarea rows={4} placeholder={t("נוסח ההודעה")} value={copyDraft.body} onChange={(e) => setCopyDraft({ ...copyDraft, body: e.target.value })} />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={copyDraft.is_active} onCheckedChange={(v) => setCopyDraft({ ...copyDraft, is_active: v })} />
                <Label className="text-sm">{t("הפעל גרסה זו")}</Label>
              </div>
              <Button
                className="gap-1.5"
                onClick={async () => {
                  try {
                    const r: any = await saveCopy({ data: { ...copyDraft, template_name: copyDraft.template_name || null, kill_switch: false } });
                    toast.success(`${t("נשמרה גרסה")} v${r.version}`);
                    setCopyDraft({ ...copyDraft, body: "" });
                    refresh();
                  } catch (e: any) { toast.error(String(e?.message ?? e)); }
                }}
              >
                <Save className="h-4 w-4" /> {t("שמור גרסה חדשה")}
              </Button>
            </div>
          </Card>
          <div className="space-y-2">
            {(data.copy ?? []).map((c: any) => (
              <Card key={c.id} className="p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-[10px]">{c.copy_key}</Badge>
                  <Badge variant="outline" className="text-[10px]">variant {c.variant} · v{c.version}</Badge>
                  {c.is_active && <Badge className="text-[10px]">{t("פעיל")}</Badge>}
                  {c.template_name && <span className="text-xs text-muted-foreground">{c.template_name}</span>}
                </div>
                <div className="mt-2 whitespace-pre-wrap text-muted-foreground">{c.body}</div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="knowledge" className="space-y-3 pt-4">
          <Card className="p-4 space-y-3">
            <Input placeholder={t("כותרת מקור")} value={sourceDraft.title} onChange={(e) => setSourceDraft({ ...sourceDraft, title: e.target.value })} />
            <Input placeholder="https://www.zooga.co.il/..." value={sourceDraft.source_url} onChange={(e) => setSourceDraft({ ...sourceDraft, source_url: e.target.value })} />
            <Textarea rows={6} placeholder={t("תוכן מאושר. פסקה = chunk.")} value={sourceDraft.content} onChange={(e) => setSourceDraft({ ...sourceDraft, content: e.target.value })} />
            <div className="flex justify-end">
              <Button
                className="gap-1.5"
                onClick={async () => {
                  try {
                    const r: any = await addSource({ data: { ...sourceDraft, source_url: sourceDraft.source_url || null, source_type: "manual", public_or_authorized: "public" } });
                    toast.success(`${t("נוספו")} ${r.chunks} chunks`);
                    setSourceDraft({ title: "", source_url: "", content: "" });
                    refresh();
                  } catch (e: any) { toast.error(String(e?.message ?? e)); }
                }}
              >
                <Save className="h-4 w-4" /> {t("הוסף מקור")}
              </Button>
            </div>
          </Card>
          {(data.sources ?? []).map((s: any) => (
            <Card key={s.id} className="p-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{s.title}</div>
                <div className="text-xs text-muted-foreground">{s.source_url ?? "—"} · {s.status}</div>
              </div>
              <div className="flex gap-2">
                {["approved", "pending", "archived"].map((st) => (
                  <Button
                    key={st}
                    size="sm"
                    variant={s.status === st ? "default" : "outline"}
                    onClick={async () => {
                      try { await setSourceStatus({ data: { id: s.id, status: st as any } }); refresh(); }
                      catch (e: any) { toast.error(String(e?.message ?? e)); }
                    }}
                  >
                    {st}
                  </Button>
                ))}
              </div>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="traces" className="space-y-2 pt-4">
          {(data.traces ?? []).map((tr: any) => (
            <Card key={tr.id} className="p-3 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px]">{tr.state}</Badge>
                <Badge variant="secondary" className="text-[10px]">{tr.selected_action}</Badge>
                <span className="text-muted-foreground">conf {tr.confidence ?? "—"} · {tr.latency_ms ?? "—"}ms</span>
                <span className="text-muted-foreground">{new Date(tr.created_at).toLocaleString("he-IL")}</span>
              </div>
              <div className="mt-1 text-muted-foreground" dir="ltr">{(tr.reason_codes ?? []).join(", ")}</div>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="sim" className="space-y-3 pt-4">
          <Card className="p-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Input value={sim.message} onChange={(e) => setSim({ ...sim, message: e.target.value })} placeholder={t("הודעה נכנסת (סינתטית)")} />
              <Input value={sim.state} onChange={(e) => setSim({ ...sim, state: e.target.value })} placeholder="state" />
            </div>
            <p className="text-xs text-muted-foreground">{t("סימולציה יבשה בלבד: אין שליחת WhatsApp, אין שמירה על איש קשר.")}</p>
            <div className="flex justify-end">
              <Button
                className="gap-1.5"
                onClick={async () => {
                  try {
                    const r: any = await runSim({ data: { message: sim.message, state: sim.state } });
                    setSim({ ...sim, result: r });
                  } catch (e: any) { toast.error(String(e?.message ?? e)); }
                }}
              >
                <Play className="h-4 w-4" /> {t("הרץ סימולציה")}
              </Button>
            </div>
            {sim.result && (
              <pre className="p-3 bg-muted/50 rounded text-xs overflow-x-auto" dir="ltr">{JSON.stringify(sim.result, null, 2)}</pre>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}