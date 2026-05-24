import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Sparkles, Send, CheckSquare, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/ai-assistant")({
  head: () => ({ meta: [{ title: "AI Assistant — Zooga CRM" }] }),
  component: AIAssistantPage,
});

const KIND_OPTIONS = [
  { value: "summary", label: "סיכום נתונים" },
  { value: "segmentation", label: "הצעת סגמנטציה" },
  { value: "campaign_draft", label: "טיוטת קמפיין" },
  { value: "triage", label: "סיוע ב-Triage" },
  { value: "free_form", label: "חופשי" },
];

type Turn = { kind: string; prompt: string; response: string; ts: string };

function AIAssistantPage() {
  const [kind, setKind] = useState("summary");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Turn[]>([]);

  async function run() {
    if (!prompt.trim()) return toast.error("נדרשת בקשה");
    setBusy(true);
    try {
      const resp = await fetch("/api/public/ai-assistant/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, prompt }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error || `HTTP ${resp.status}`);
      setHistory((h) => [{ kind, prompt, response: j.response || "", ts: new Date().toISOString() }, ...h]);
      setPrompt("");
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
    setBusy(false);
  }

  async function saveAsTask(turn: Turn) {
    const { error } = await supabase.from("tasks").insert({
      title: `AI proposal: ${KIND_OPTIONS.find((o) => o.value === turn.kind)?.label ?? turn.kind}`,
      description: `BAKASHA:\n${turn.prompt}\n\nHATSAA:\n${turn.response}`,
      priority: "normal",
      status: "open",
    });
    if (error) return toast.error(error.message);
    toast.success("נשמר כמשימה");
  }

  return (
    <div className="p-6 space-y-6 max-w-[1100px] mx-auto" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" /> AI Assistant
        </h1>
        <p className="text-sm text-muted-foreground">
          עוזר פנימי בגישת proposal-first. אינו מבצע פעולות אוטומטיות; כל פלט הוא הצעה לאישור מנהל.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="text-[10px]">proposal-first · no auto-writes</Badge>
        </div>
        <Textarea
          rows={5}
          placeholder="תאר את הבקשה (לדוגמה: סכם את כל הלידים החמים מהשבוע, או הצע סגמנטים לטיול בוגרי 60+)"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex justify-end">
          <Button onClick={run} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            הרץ
          </Button>
        </div>
      </Card>

      <div className="space-y-4">
        {history.map((t, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  {KIND_OPTIONS.find((o) => o.value === t.kind)?.label ?? t.kind}
                </Badge>
                <span className="text-xs text-muted-foreground">{new Date(t.ts).toLocaleString("he-IL")}</span>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => saveAsTask(t)}>
                <CheckSquare className="h-3.5 w-3.5" /> שמור כמשימה
              </Button>
            </div>
            <div className="text-xs text-muted-foreground mb-2 whitespace-pre-wrap border-r-2 border-primary/40 pr-3">{t.prompt}</div>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{t.response}</ReactMarkdown>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}