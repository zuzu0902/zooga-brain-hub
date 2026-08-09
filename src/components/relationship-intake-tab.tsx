import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mic } from "lucide-react";
import {
  getRelationshipStudioConfig,
  saveRelationshipConfig,
  saveRelationshipQuestion,
} from "@/lib/relationship-intake.functions";

type Config = Awaited<ReturnType<typeof getRelationshipStudioConfig>>;

export function RelationshipIntakeTab() {
  const load = useServerFn(getRelationshipStudioConfig);
  const saveQ = useServerFn(saveRelationshipQuestion);
  const saveCfg = useServerFn(saveRelationshipConfig);
  const [data, setData] = useState<Config | null>(null);
  const [intro, setIntro] = useState("");
  const [completion, setCompletion] = useState("");
  const [rules, setRules] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const refresh = async () => {
    try {
      const d = await load({} as any);
      setData(d);
      setIntro(d.config.intro_text);
      setCompletion(d.config.completion_text);
      setRules(d.config.voice_rules ?? "");
      setVoiceEnabled(d.config.voice_enabled);
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    }
  };
  useEffect(() => { void refresh(); }, []);
  if (!data) return null;

  const voice = data.voice;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Mic className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">מוכנות תמלול הודעות קוליות</h3>
          <Badge variant={voice.configured ? "default" : "destructive"}>
            {voice.configured ? "מוגדר" : "לא מוגדר"}
          </Badge>
          <Badge variant="outline">ספק: {voice.provider ?? "—"}</Badge>
          <Badge variant="outline">מודל: {voice.model ?? "—"}</Badge>
        </div>
        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
          <div>הצלחה אחרונה: {voice.last_success_at ? new Date(voice.last_success_at).toLocaleString("he-IL") : "—"}</div>
          <div>כשל אחרון: {voice.last_error_at ? new Date(voice.last_error_at).toLocaleString("he-IL") : "—"}</div>
          <div>פירוט כשל: {voice.last_error ?? "—"}</div>
        </div>
        {voice.missing.length > 0 && (
          <p className="text-xs text-destructive">חסר להפעלה מלאה: {voice.missing.join(", ")}</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          קובץ האודיו אינו נשמר. נשמרים רק התמלול והמטא-דאטה. אין חשיפת מפתחות או קישורי מדיה זמניים.
        </p>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">נוסחי השאלון</h3>
        <div className="space-y-1">
          <Label>הודעת פתיחה</Label>
          <Textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} />
        </div>
        <div className="space-y-1">
          <Label>הודעת סיום</Label>
          <Textarea value={completion} onChange={(e) => setCompletion(e.target.value)} rows={3} />
        </div>
        <div className="space-y-1">
          <Label>כללי הודעות קוליות</Label>
          <Textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={2} />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={voiceEnabled} onCheckedChange={setVoiceEnabled} id="rel-voice" />
          <Label htmlFor="rel-voice">לאפשר מענה בהודעה קולית</Label>
        </div>
        <Button
          size="sm"
          onClick={async () => {
            try {
              await saveCfg({
                data: { intro_text: intro, completion_text: completion, voice_rules: rules, voice_enabled: voiceEnabled },
              });
              toast.success("נשמר");
              await refresh();
            } catch (e: any) {
              toast.error(String(e?.message ?? e));
            }
          }}
        >
          שמור נוסחים
        </Button>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">שאלות השאלון</h3>
          <Badge variant="outline">{data.questions.length}</Badge>
        </div>
        <div className="space-y-2">
          {data.questions.map((q) => (
            <QuestionRow
              key={q.question_key}
              q={q}
              onSave={async (patch) => {
                try {
                  await saveQ({ data: { question_key: q.question_key, ...patch } });
                  toast.success("נשמר");
                  await refresh();
                } catch (e: any) {
                  toast.error(String(e?.message ?? e));
                }
              }}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function QuestionRow({
  q,
  onSave,
}: {
  q: { question_key: string; label: string; question_text: string; order_index: number; active: boolean; skippable: boolean; is_final_question: boolean };
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [text, setText] = useState(q.question_text);
  const [order, setOrder] = useState(String(q.order_index));
  const [active, setActive] = useState(q.active);
  const [skippable, setSkippable] = useState(q.skippable);

  return (
    <div className="rounded-md border border-border/60 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{q.question_key}</Badge>
        <span className="text-muted-foreground">{q.label}</span>
        {q.is_final_question && <Badge variant="secondary">שאלת סיום</Badge>}
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1">
          <Label className="text-xs">סדר</Label>
          <Input className="h-8 w-20" value={order} onChange={(e) => setOrder(e.target.value)} />
        </div>
        <div className="flex items-center gap-1">
          <Switch checked={active} onCheckedChange={setActive} id={`a-${q.question_key}`} />
          <Label htmlFor={`a-${q.question_key}`} className="text-xs">פעילה</Label>
        </div>
        <div className="flex items-center gap-1">
          <Switch checked={skippable} onCheckedChange={setSkippable} id={`s-${q.question_key}`} />
          <Label htmlFor={`s-${q.question_key}`} className="text-xs">ניתן לדלג</Label>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onSave({ question_text: text, order_index: Number(order) || q.order_index, active, skippable })
          }
        >
          שמור
        </Button>
      </div>
    </div>
  );
}