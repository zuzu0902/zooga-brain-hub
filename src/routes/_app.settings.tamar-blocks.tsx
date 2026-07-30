import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Save, Plus, Trash2, FileText } from "lucide-react";
import { useT, useLanguage } from "@/lib/language-context";

export const Route = createFileRoute("/_app/settings/tamar-blocks")({
  head: () => ({ meta: [{ title: "Tamar Prompt Blocks — Zooga CRM" }] }),
  component: TamarBlocksPage,
});

type Block = {
  id: string;
  block_key: string;
  title: string | null;
  body: string;
  version: number;
  is_active: boolean;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
};

function TamarBlocksPage() {
  const t = useT();
  const { dir } = useLanguage();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("tamar_prompt_blocks" as any)
      .select("*")
      .order("block_key", { ascending: true });
    if (error) toast.error(error.message);
    setBlocks((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function patch(id: string, p: Partial<Block>) {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...p } : b)));
  }

  async function save(b: Block) {
    setSavingId(b.id);
    const { error } = await supabase
      .from("tamar_prompt_blocks" as any)
      .update({
        title: b.title,
        body: b.body,
        notes: b.notes,
        is_active: b.is_active,
        version: (b.version ?? 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", b.id);
    setSavingId(null);
    if (error) return toast.error(error.message);
    toast.success(`${t("נשמר — גרסה")} ${(b.version ?? 1) + 1}`);
    await load();
  }

  async function toggleActive(b: Block, v: boolean) {
    const { error } = await supabase
      .from("tamar_prompt_blocks" as any)
      .update({ is_active: v, updated_at: new Date().toISOString() })
      .eq("id", b.id);
    if (error) return toast.error(error.message);
    patch(b.id, { is_active: v });
    toast.success(v ? t("הופעל") : t("הושבת"));
  }

  async function createBlock() {
    const key = newKey.trim();
    if (!key) return toast.error(t("צריך block_key"));
    const { error } = await supabase.from("tamar_prompt_blocks" as any).insert({
      block_key: key, title: key, body: "", version: 1, is_active: true,
    });
    if (error) return toast.error(error.message);
    setNewKey("");
    await load();
    toast.success(t("נוצר block חדש"));
  }

  async function remove(b: Block) {
    if (!confirm(`${t("למחוק את")} ${b.block_key}?`)) return;
    const { error } = await supabase.from("tamar_prompt_blocks" as any).delete().eq("id", b.id);
    if (error) return toast.error(error.message);
    await load();
  }

  if (loading) return <div className="p-6" dir={dir}>{t("טוען…")}</div>;

  return (
    <div className="p-6 space-y-6 max-w-[1100px] mx-auto" dir={dir}>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" /> Tamar Prompt Blocks
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("בלוקי פרומפט מודולריים שמוזרקים ל-runtime של Tamar. שמירה מקדמת אוטומטית את הגרסה.")}
        </p>
      </div>

      <Card className="p-4 flex items-end gap-2">
        <div className="flex-1">
          <Label>{t("block_key חדש")}</Label>
          <Input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="לדוגמה: first_response, handoff_language, sales_behavior"
          />
        </div>
        <Button onClick={createBlock} className="gap-1.5">
          <Plus className="h-4 w-4" /> {t("צור block")}
        </Button>
      </Card>

      {blocks.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">{t("אין עדיין blocks. צרי אחד למעלה.")}</Card>
      ) : (
        blocks.map((b) => (
          <Card key={b.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <code className="text-sm bg-muted px-2 py-0.5 rounded">{b.block_key}</code>
                  <Badge variant={b.is_active ? "default" : "outline"}>v{b.version}</Badge>
                  {!b.is_active && <Badge variant="outline">disabled</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("עודכן:")} {b.updated_at ? new Date(b.updated_at).toLocaleString(dir === "rtl" ? "he-IL" : "en-US") : "—"}
                  {b.updated_by ? ` · ${b.updated_by}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs">{t("פעיל")}</span>
                  <Switch checked={b.is_active} onCheckedChange={(v) => toggleActive(b, v)} />
                </div>
                <Button size="sm" variant="ghost" onClick={() => remove(b)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button size="sm" onClick={() => save(b)} disabled={savingId === b.id} className="gap-1.5">
                  {savingId === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t("שמור (גרסה")} {b.version + 1})
                </Button>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>{t("כותרת")}</Label>
                <Input value={b.title ?? ""} onChange={(e) => patch(b.id, { title: e.target.value })} />
              </div>
              <div>
                <Label>{t("הערות (פנימי)")}</Label>
                <Input value={b.notes ?? ""} onChange={(e) => patch(b.id, { notes: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>{t("גוף הבלוק (מוזרק ישירות ל-runtime)")}</Label>
              <Textarea
                rows={8}
                value={b.body ?? ""}
                onChange={(e) => patch(b.id, { body: e.target.value })}
                className="font-mono text-sm"
              />
            </div>
          </Card>
        ))
      )}
    </div>
  );
}