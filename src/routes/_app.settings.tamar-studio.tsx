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
import { Activity, FlaskConical, GitBranch, Loader2, Play, Save, Sliders, Sparkles, Workflow } from "lucide-react";
import {
  activateVersion, createDraftVersion, deleteFlowStep, getStudioOverview, runEvalSuite,
  saveDraftIdentity, saveFlowStep, saveModelStage, seedEvalSuite, setFeatureFlag,
  simulateV2Turn, testModelStage,
} from "@/lib/tamar-studio.functions";

export const Route = createFileRoute("/_app/settings/tamar-studio")({
  head: () => ({
    meta: [
      { title: "Tamar Studio — כיול תמר" },
      { name: "description", content: "מרכז הכיול של תמר: אישיות, זרימת שאלות, מודלים, בטיחות, ידע, סימולטור, הערכות וגרסאות." },
      { property: "og:title", content: "Tamar Studio — כיול תמר" },
      { property: "og:description", content: "כיול מלא של סוכן תמר: טיוטות, גרסאות, מודלים והרצת תרחישי קבלה." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TamarStudioPage,
});

type Overview = Awaited<ReturnType<typeof getStudioOverview>>;

function TamarStudioPage() {
  const load = useServerFn(getStudioOverview);
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try { setData(await load({} as any)); } catch (e: any) { toast.error(String(e?.message ?? e)); }
  };
  useEffect(() => { void refresh(); }, []);

  if (!data) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div dir="rtl" className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Sparkles className="h-6 w-6 text-primary" /> Tamar Studio</h1>
          <p className="text-sm text-muted-foreground">מרכז הכיול של תמר. כל שינוי נשמר כטיוטה, ורק הפעלת גרסה משפיעה על הייצור.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">גרסה פעילה: {data.active.version}</Badge>
          {data.draft ? <Badge>טיוטה: {data.draft.version}</Badge> : null}
          <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await createDraftVersion({} as any); toast.success("טיוטה מוכנה"); await refresh(); }
            catch (e: any) { toast.error(String(e?.message ?? e)); } finally { setBusy(false); }
          }}>צור/פתח טיוטה</Button>
        </div>
      </header>

      <Tabs defaultValue="identity" dir="rtl">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="identity">אישיות וטון</TabsTrigger>
          <TabsTrigger value="flow">זרימה ושאלות</TabsTrigger>
          <TabsTrigger value="models">מודלים</TabsTrigger>
          <TabsTrigger value="safety">בטיחות והעברה לאדם</TabsTrigger>
          <TabsTrigger value="knowledge">ידע</TabsTrigger>
          <TabsTrigger value="simulator">סימולטור</TabsTrigger>
          <TabsTrigger value="evals">הערכות</TabsTrigger>
          <TabsTrigger value="versions">גרסאות</TabsTrigger>
          <TabsTrigger value="health">בריאות</TabsTrigger>
        </TabsList>

        <TabsContent value="identity"><IdentityTab data={data} onSaved={refresh} /></TabsContent>
        <TabsContent value="flow"><FlowTab data={data} onSaved={refresh} /></TabsContent>
        <TabsContent value="models"><ModelsTab data={data} onSaved={refresh} /></TabsContent>
        <TabsContent value="safety"><SafetyTab data={data} onSaved={refresh} /></TabsContent>
        <TabsContent value="knowledge"><KnowledgeTab data={data} /></TabsContent>
        <TabsContent value="simulator"><SimulatorTab data={data} /></TabsContent>
        <TabsContent value="evals"><EvalsTab data={data} onSaved={refresh} /></TabsContent>
        <TabsContent value="versions"><VersionsTab data={data} onSaved={refresh} /></TabsContent>
        <TabsContent value="health"><HealthTab data={data} /></TabsContent>
      </Tabs>
    </div>
  );
}

function DraftGate({ data, children }: { data: Overview; children: React.ReactNode }) {
  if (!data.draft) {
    return <Card className="p-6 text-sm text-muted-foreground">אין טיוטה פתוחה. לחצי על "צור/פתח טיוטה" למעלה כדי לערוך.</Card>;
  }
  return <>{children}</>;
}

/* ------------------------------- identity ------------------------------- */
function IdentityTab({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const draft = data.draft;
  const id = (draft?.identity ?? {}) as any;
  const [form, setForm] = useState({
    agent_name: id.agent_name ?? "תמר",
    brand: id.brand ?? "זוגה",
    tone: id.tone ?? "חמה, קצרה, מכבדת",
    max_sentences: Number(id.max_sentences ?? 3),
    signature_opening: id.signature_opening ?? "",
    forbidden_phrases: (id.forbidden_phrases ?? []).join("\n"),
    change_summary: (draft as any)?.change_summary ?? "",
  });
  useEffect(() => {
    const i = (data.draft?.identity ?? {}) as any;
    setForm((f) => ({ ...f, agent_name: i.agent_name ?? f.agent_name, brand: i.brand ?? f.brand, tone: i.tone ?? f.tone }));
  }, [data.draft?.id]);

  return (
    <DraftGate data={data}>
      <Card className="space-y-4 p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div><Label>שם הסוכנת</Label><Input value={form.agent_name} onChange={(e) => setForm({ ...form, agent_name: e.target.value })} /></div>
          <div><Label>מותג</Label><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>טון דיבור</Label><Input value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} /></div>
          <div><Label>מקסימום משפטים בתשובה</Label><Input type="number" min={1} max={6} value={form.max_sentences} onChange={(e) => setForm({ ...form, max_sentences: Number(e.target.value) })} /></div>
          <div className="md:col-span-2"><Label>משפט פתיחה (אופציונלי)</Label><Textarea rows={2} value={form.signature_opening} onChange={(e) => setForm({ ...form, signature_opening: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>ביטויים אסורים (שורה לכל ביטוי)</Label><Textarea rows={4} value={form.forbidden_phrases} onChange={(e) => setForm({ ...form, forbidden_phrases: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>תיאור השינוי</Label><Input value={form.change_summary} onChange={(e) => setForm({ ...form, change_summary: e.target.value })} /></div>
        </div>
        <Button onClick={async () => {
          try {
            await saveDraftIdentity({ data: {
              id: String(draft!.id),
              identity: {
                ...(draft!.identity as any),
                agent_name: form.agent_name, brand: form.brand, tone: form.tone,
                max_sentences: form.max_sentences, signature_opening: form.signature_opening,
                forbidden_phrases: form.forbidden_phrases.split("\n").map((s: string) => s.trim()).filter(Boolean),
              },
              change_summary: form.change_summary,
            } } as any);
            toast.success("נשמר בטיוטה"); onSaved();
          } catch (e: any) { toast.error(String(e?.message ?? e)); }
        }}><Save className="ms-2 h-4 w-4" /> שמירה בטיוטה</Button>
      </Card>
    </DraftGate>
  );
}

/* --------------------------------- flow --------------------------------- */
function FlowTab({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const draft = data.draft;
  return (
    <DraftGate data={data}>
      <div className="space-y-3">
        {((draft?.steps ?? []) as any[]).map((s: any) => <StepEditor key={s.id} step={s} versionId={String(draft!.id)} onSaved={onSaved} />)}
        <Button variant="secondary" onClick={async () => {
          try {
            await saveFlowStep({ data: {
              id: null, agent_version_id: String(draft!.id), step_key: `step_${Date.now()}`, field_key: null,
              stage: "intake_active", question_text: "שאלה חדשה", presentation: "text",
              required: false, skippable: true, order_index: (draft?.steps.length ?? 0) + 1, enabled: false, options: [],
            } } as any);
            toast.success("נוסף שלב"); onSaved();
          } catch (e: any) { toast.error(String(e?.message ?? e)); }
        }}>הוספת שלב</Button>
      </div>
    </DraftGate>
  );
}

function StepEditor({ step, versionId, onSaved }: { step: any; versionId: string; onSaved: () => void }) {
  const [s, setS] = useState({ ...step, options: step.options ?? [] });
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{s.step_key}</span>
          <Badge variant="outline">{s.stage}</Badge>
          {s.field_key ? <Badge variant="secondary">{s.field_key}</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">פעיל</Label>
          <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} />
        </div>
      </div>
      <Textarea rows={2} value={s.question_text} onChange={(e) => setS({ ...s, question_text: e.target.value })} />
      <div className="grid gap-3 md:grid-cols-4">
        <div><Label className="text-xs">תצוגה</Label>
          <select className="w-full rounded-md border bg-background p-2 text-sm" value={s.presentation} onChange={(e) => setS({ ...s, presentation: e.target.value })}>
            <option value="text">טקסט חופשי</option><option value="buttons">כפתורים</option><option value="list">רשימה</option>
          </select>
        </div>
        <div><Label className="text-xs">סדר</Label><Input type="number" value={s.order_index} onChange={(e) => setS({ ...s, order_index: Number(e.target.value) })} /></div>
        <div className="flex items-center gap-2 pt-6"><Switch checked={s.required} onCheckedChange={(v) => setS({ ...s, required: v })} /><Label className="text-xs">חובה</Label></div>
        <div className="flex items-center gap-2 pt-6"><Switch checked={s.skippable} onCheckedChange={(v) => setS({ ...s, skippable: v })} /><Label className="text-xs">ניתן לדילוג</Label></div>
      </div>
      {s.presentation !== "text" ? (
        <div className="space-y-2">
          <Label className="text-xs">אפשרויות</Label>
          {s.options.map((o: any, i: number) => (
            <div key={i} className="flex gap-2">
              <Input className="w-32" value={o.option_id} onChange={(e) => { const n = [...s.options]; n[i] = { ...o, option_id: e.target.value }; setS({ ...s, options: n }); }} />
              <Input value={o.label} onChange={(e) => { const n = [...s.options]; n[i] = { ...o, label: e.target.value }; setS({ ...s, options: n }); }} />
              <Input className="w-40" value={o.value} onChange={(e) => { const n = [...s.options]; n[i] = { ...o, value: e.target.value }; setS({ ...s, options: n }); }} />
              <Button variant="ghost" size="sm" onClick={() => setS({ ...s, options: s.options.filter((_: any, j: number) => j !== i) })}>מחק</Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setS({ ...s, options: [...s.options, { option_id: `${s.step_key}_${s.options.length + 1}`, label: "", value: "", order_index: s.options.length + 1, enabled: true }] })}>הוסף אפשרות</Button>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={async () => {
          try {
            await saveFlowStep({ data: {
              id: s.id, agent_version_id: versionId, step_key: s.step_key, field_key: s.field_key ?? null,
              stage: s.stage, question_text: s.question_text, help_text: s.help_text ?? null,
              presentation: s.presentation, required: !!s.required, skippable: !!s.skippable,
              order_index: Number(s.order_index), enabled: !!s.enabled,
              options: (s.options ?? []).map((o: any, i: number) => ({ option_id: o.option_id, label: o.label, value: o.value, order_index: i + 1, enabled: o.enabled !== false })),
            } } as any);
            toast.success("השלב נשמר"); onSaved();
          } catch (e: any) { toast.error(String(e?.message ?? e)); }
        }}>שמירה</Button>
        <Button size="sm" variant="ghost" onClick={async () => {
          try { await deleteFlowStep({ data: { id: s.id } } as any); toast.success("נמחק"); onSaved(); }
          catch (e: any) { toast.error(String(e?.message ?? e)); }
        }}>מחיקה</Button>
      </div>
    </Card>
  );
}

/* -------------------------------- models -------------------------------- */
function ModelsTab({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const labels: Record<string, string> = {
    intent_interpreter: "פרשנות כוונה", response_writer: "ניסוח תשובה", extractor: "חילוץ נתונים", fallback: "גיבוי",
  };
  return (
    <div className="space-y-3">
      {data.models.map((m: any) => <ModelRow key={m.stage} m={m} label={labels[m.stage] ?? m.stage} allowlist={data.allowlist} onSaved={onSaved} />)}
    </div>
  );
}

function ModelRow({ m, label, allowlist, onSaved }: { m: any; label: string; allowlist: any[]; onSaved: () => void }) {
  const [f, setF] = useState({ ...m });
  const [test, setTest] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Sliders className="h-4 w-4 text-muted-foreground" /><span className="font-medium">{label}</span><Badge variant="outline">{m.stage}</Badge></div>
        {test ? <Badge variant={test.ok ? "default" : "destructive"}>{test.ok ? `תקין · ${test.latency_ms}ms` : `כשל: ${test.error}`}</Badge> : null}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div><Label className="text-xs">מודל</Label>
          <select className="w-full rounded-md border bg-background p-2 text-sm" value={f.model_id} onChange={(e) => setF({ ...f, model_id: e.target.value })}>
            {allowlist.map((a: any) => <option key={a.model_id} value={a.model_id}>{a.label ?? a.model_id}</option>)}
          </select>
        </div>
        <div><Label className="text-xs">מודל גיבוי</Label>
          <select className="w-full rounded-md border bg-background p-2 text-sm" value={f.fallback_model ?? ""} onChange={(e) => setF({ ...f, fallback_model: e.target.value || null })}>
            <option value="">ללא</option>
            {allowlist.map((a: any) => <option key={a.model_id} value={a.model_id}>{a.label ?? a.model_id}</option>)}
          </select>
        </div>
        <div><Label className="text-xs">Temperature</Label><Input type="number" step="0.1" value={f.temperature} onChange={(e) => setF({ ...f, temperature: Number(e.target.value) })} /></div>
        <div><Label className="text-xs">Max tokens</Label><Input type="number" value={f.max_tokens} onChange={(e) => setF({ ...f, max_tokens: Number(e.target.value) })} /></div>
        <div><Label className="text-xs">Timeout (ms)</Label><Input type="number" value={f.timeout_ms} onChange={(e) => setF({ ...f, timeout_ms: Number(e.target.value) })} /></div>
        <div><Label className="text-xs">ניסיונות חוזרים</Label><Input type="number" value={f.retries} onChange={(e) => setF({ ...f, retries: Number(e.target.value) })} /></div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={async () => {
          try {
            await saveModelStage({ data: {
              stage: f.stage, model_id: f.model_id, temperature: Number(f.temperature), max_tokens: Number(f.max_tokens),
              timeout_ms: Number(f.timeout_ms), retries: Number(f.retries), fallback_model: f.fallback_model ?? null,
              structured_output: !!f.structured_output, reasoning_effort: f.reasoning_effort ?? null,
            } } as any);
            toast.success("נשמר"); onSaved();
          } catch (e: any) { toast.error(String(e?.message ?? e)); }
        }}>שמירה</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
          setBusy(true);
          try { setTest(await testModelStage({ data: { stage: f.stage } } as any)); }
          catch (e: any) { toast.error(String(e?.message ?? e)); } finally { setBusy(false); }
        }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "בדיקת מודל"}</Button>
      </div>
    </Card>
  );
}

/* -------------------------------- safety -------------------------------- */
function SafetyTab({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const draft = data.draft;
  const s = (draft?.safety ?? {}) as any;
  const [f, setF] = useState({
    handoff_confidence_threshold: Number(s.handoff_confidence_threshold ?? 60),
    max_ambiguity_turns: Number(s.max_ambiguity_turns ?? 2),
    escalate_on_distress: s.escalate_on_distress !== false,
    escalate_on_complaint: s.escalate_on_complaint !== false,
    require_consent: s.require_consent !== false,
  });
  const flag = data.flags.find((x: any) => x.key === "tamar_v2_enabled");
  const [flagState, setFlagState] = useState({ enabled: !!flag?.enabled, allowlist: (flag?.allowlist ?? []).join("\n") });

  return (
    <div className="space-y-4">
      <DraftGate data={data}>
        <Card className="space-y-4 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div><Label>סף ביטחון להעברה לאדם</Label><Input type="number" value={f.handoff_confidence_threshold} onChange={(e) => setF({ ...f, handoff_confidence_threshold: Number(e.target.value) })} /></div>
            <div><Label>מקסימום תורות לא ברורים</Label><Input type="number" value={f.max_ambiguity_turns} onChange={(e) => setF({ ...f, max_ambiguity_turns: Number(e.target.value) })} /></div>
            <div className="flex items-center gap-2"><Switch checked={f.escalate_on_distress} onCheckedChange={(v) => setF({ ...f, escalate_on_distress: v })} /><Label>העברה מיידית במצוקה</Label></div>
            <div className="flex items-center gap-2"><Switch checked={f.escalate_on_complaint} onCheckedChange={(v) => setF({ ...f, escalate_on_complaint: v })} /><Label>העברה בתלונה או בעיית תשלום</Label></div>
            <div className="flex items-center gap-2"><Switch checked={f.require_consent} onCheckedChange={(v) => setF({ ...f, require_consent: v })} /><Label>חובת אישור לפני שיווק</Label></div>
          </div>
          <Button onClick={async () => {
            try { await saveDraftIdentity({ data: { id: String(draft!.id), safety: f } } as any); toast.success("נשמר בטיוטה"); onSaved(); }
            catch (e: any) { toast.error(String(e?.message ?? e)); }
          }}><Save className="ms-2 h-4 w-4" /> שמירה בטיוטה</Button>
        </Card>
      </DraftGate>

      <Card className="space-y-3 p-6">
        <h3 className="font-medium">הפעלה הדרגתית (tamar_v2_enabled)</h3>
        <div className="flex items-center gap-2"><Switch checked={flagState.enabled} onCheckedChange={(v) => setFlagState({ ...flagState, enabled: v })} /><Label>מנוע V2 פעיל</Label></div>
        <div><Label className="text-xs">רשימת מספרים מורשים (שורה לכל מספר; ריק = כולם)</Label>
          <Textarea rows={4} value={flagState.allowlist} onChange={(e) => setFlagState({ ...flagState, allowlist: e.target.value })} /></div>
        <Button variant="secondary" onClick={async () => {
          try {
            await setFeatureFlag({ data: { key: "tamar_v2_enabled", enabled: flagState.enabled, allowlist: flagState.allowlist.split("\n").map((x: string) => x.trim()).filter(Boolean) } } as any);
            toast.success("עודכן"); onSaved();
          } catch (e: any) { toast.error(String(e?.message ?? e)); }
        }}>עדכון הפעלה</Button>
      </Card>
    </div>
  );
}

/* ------------------------------- knowledge ------------------------------ */
function KnowledgeTab({ data }: { data: Overview }) {
  return (
    <Card className="p-6">
      <p className="mb-3 text-sm text-muted-foreground">מקורות הידע שמזינים תשובות מבוססות עובדות. הוספה ועריכה נעשות במסך Tamar Brain.</p>
      <div className="space-y-2">
        {data.sources.map((s: any) => (
          <div key={s.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
            <span>{s.title}</span><Badge variant={s.status === "active" ? "default" : "outline"}>{s.status}</Badge>
          </div>
        ))}
        {!data.sources.length ? <p className="text-sm text-muted-foreground">אין מקורות ידע.</p> : null}
      </div>
    </Card>
  );
}

/* ------------------------------- simulator ------------------------------ */
function SimulatorTab({ data }: { data: Overview }) {
  const [msg, setMsg] = useState("היי");
  const [state, setState] = useState("new_inbound");
  const [offline, setOffline] = useState(true);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const states = ["new_inbound", "consent_asked", "consented", "intake_active", "recommendation_ready", "value_delivered", "human_handoff_queued", "human_owned", "opted_out", "paused"];
  return (
    <Card className="space-y-4 p-6">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2"><Label>הודעה נכנסת</Label><Input value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
        <div><Label>מצב שיחה</Label>
          <select className="w-full rounded-md border bg-background p-2 text-sm" value={state} onChange={(e) => setState(e.target.value)}>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2"><Switch checked={offline} onCheckedChange={setOffline} /><Label>מצב אופליין (ללא קריאת מודל)</Label></div>
      <Button disabled={busy} onClick={async () => {
        setBusy(true);
        try { setRes(await simulateV2Turn({ data: { message: msg, state, known: {}, pending_step: null, offline, version_id: null } } as any)); }
        catch (e: any) { toast.error(String(e?.message ?? e)); } finally { setBusy(false); }
      }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Play className="ms-2 h-4 w-4" /> הרצה יבשה</>}</Button>
      {res ? (
        <div className="space-y-2 rounded-md border p-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge>{res.decision.next_state}</Badge>
            {res.decision.actions.map((a: string) => <Badge key={a} variant="secondary">{a}</Badge>)}
            {res.decision.reason_codes.map((r: string) => <Badge key={r} variant="outline">{r}</Badge>)}
          </div>
          {res.decision.messages.map((m: any, i: number) => <p key={i} className="whitespace-pre-wrap rounded bg-muted p-2">{m.body}</p>)}
          {!res.decision.messages.length ? <p className="text-muted-foreground">שתיקה מכוונת — אין הודעה יוצאת.</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

/* --------------------------------- evals -------------------------------- */
function EvalsTab({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);
  return (
    <Card className="space-y-4 p-6">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={async () => {
          setBusy(true);
          try { const r = await seedEvalSuite({} as any); toast.success(`נטענו ${r.cases} תרחישים`); onSaved(); }
          catch (e: any) { toast.error(String(e?.message ?? e)); } finally { setBusy(false); }
        }}><FlaskConical className="ms-2 h-4 w-4" /> טעינת תרחישים</Button>
        <Button variant="secondary" disabled={busy} onClick={async () => {
          setBusy(true);
          try { const r = await runEvalSuite({ data: { version_id: null } } as any); setLast(r); toast.success(`${r.passed}/${r.total} עברו`); onSaved(); }
          catch (e: any) { toast.error(String(e?.message ?? e)); } finally { setBusy(false); }
        }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "הרצת כל התרחישים"}</Button>
      </div>
      {last ? (
        <div className="space-y-2 text-sm">
          <p className="font-medium">{last.passed}/{last.total} עברו</p>
          {last.failures.map((f: any) => <div key={f.name} className="rounded border border-destructive/40 p-2">{f.name}: {f.failures.join(", ")}</div>)}
        </div>
      ) : null}
      <div className="space-y-2">
        <h3 className="font-medium">היסטוריית הרצות</h3>
        {data.eval_runs.map((r: any) => (
          <div key={r.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span>{new Date(r.created_at).toLocaleString("he-IL")}</span>
            <Badge variant={r.failed ? "destructive" : "default"}>{r.passed}/{r.total} · {r.pass_rate}%</Badge>
          </div>
        ))}
        {!data.eval_runs.length ? <p className="text-sm text-muted-foreground">אין הרצות עדיין.</p> : null}
      </div>
    </Card>
  );
}

/* -------------------------------- versions ------------------------------ */
function VersionsTab({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  return (
    <div className="space-y-3">
      {data.versions.map((v: any) => (
        <Card key={v.id} className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">גרסה {v.version}</span>
            <Badge variant={v.status === "active" ? "default" : v.status === "draft" ? "secondary" : "outline"}>{v.status}</Badge>
            <span className="text-sm text-muted-foreground">{v.change_summary}</span>
          </div>
          {v.status !== "active" ? (
            <Button size="sm" variant="secondary" onClick={async () => {
              try { await activateVersion({ data: { id: v.id } } as any); toast.success(`גרסה ${v.version} פעילה`); onSaved(); }
              catch (e: any) { toast.error(String(e?.message ?? e)); }
            }}>{v.status === "draft" ? "הפעלה" : "חזרה לגרסה זו"}</Button>
          ) : null}
        </Card>
      ))}
      <Card className="p-4">
        <h3 className="mb-2 font-medium">יומן שינויים</h3>
        <div className="space-y-1 text-xs">
          {data.audits.map((a: any) => (
            <div key={a.id} className="flex justify-between border-b py-1">
              <span>{a.area} · {a.action}</span>
              <span className="text-muted-foreground">{a.actor} · {new Date(a.created_at).toLocaleString("he-IL")}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* --------------------------------- health ------------------------------- */
function HealthTab({ data }: { data: Overview }) {
  const h = data.health as any;
  const item = (label: string, ok: boolean, extra?: string) => (
    <div className="flex items-center justify-between rounded border p-3 text-sm">
      <span>{label}</span><Badge variant={ok ? "default" : "destructive"}>{ok ? `תקין${extra ? ` · ${extra}` : ""}` : "חסר"}</Badge>
    </div>
  );
  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-6">
        <h3 className="flex items-center gap-2 font-medium"><Activity className="h-4 w-4" /> בריאות מערכת</h3>
        {item("מפתח Lovable AI", !!h.lovable_api_key)}
        {item("מספר מנהל מקושר", !!h.manager?.configured, h.manager?.source ?? undefined)}
        {item("חיבור WhatsApp", !!h.meta?.whatsapp_access_token && !!h.meta?.whatsapp_phone_number_id)}
        {item("אימות חתימת Meta", !!h.meta?.meta_app_secret && !!h.meta?.meta_verify_token)}
        <div className="flex items-center justify-between rounded border p-3 text-sm"><span>הצלחת קריאות מודל</span><Badge variant="outline">{h.model_success_rate ?? "—"}%</Badge></div>
        <div className="flex items-center justify-between rounded border p-3 text-sm"><span>זמן תגובה ממוצע</span><Badge variant="outline">{h.avg_latency_ms ?? "—"} ms</Badge></div>
        <div className="flex items-center justify-between rounded border p-3 text-sm"><span>העברות פתוחות</span><Badge variant="outline">{h.open_handoffs}</Badge></div>
      </Card>
      <Card className="p-6">
        <h3 className="mb-2 font-medium">מצבי שיחה</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.state_counts).map(([k, v]) => <Badge key={k} variant="outline">{k}: {String(v)}</Badge>)}
        </div>
      </Card>
      <Card className="p-6">
        <h3 className="mb-2 font-medium">קריאות מודל אחרונות</h3>
        <div className="space-y-1 text-xs">
          {data.calls.slice(0, 15).map((c: any) => (
            <div key={c.id} className="flex justify-between border-b py-1">
              <span>{c.stage} · {c.model_id}</span>
              <span className={c.ok ? "text-muted-foreground" : "text-destructive"}>{c.ok ? `${c.latency_ms}ms` : c.error?.slice(0, 60)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
