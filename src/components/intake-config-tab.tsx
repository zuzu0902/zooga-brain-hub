/** Intake questions — read and edited in Hostinger Core only (canonical). Options are read-only for now. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { coreApi, CoreApiError } from "@/lib/hostinger-core/client";
import { INTAKE_ERROR_TEXT, type IntakeDefinition } from "@/lib/hostinger-core/intake-definitions";
import { CoreReadState } from "./operator-data";

const PRESENTATION: Record<string, string> = { text: "טקסט חופשי", menu: "תפריט", multi: "בחירה מרובה" };

export function intakeErrorText(e: unknown): string {
  if (e instanceof CoreApiError) {
    if (INTAKE_ERROR_TEXT[e.code]) return INTAKE_ERROR_TEXT[e.code];
    if (e.status === 401 || e.status === 403) return "אין הרשאה לערוך הגדרות אינטייק";
    if (e.status === 404) return "השדה לא נמצא ב-Core";
  }
  if (e instanceof Error && e.message.startsWith("core_shape_malformed")) return "ערך לא תקין — בדקו את השדה";
  return "השמירה ב-Core נכשלה. נסו שוב.";
}

export function IntakeConfigTab() {
  const qc = useQueryClient();
  const { session, loading } = useAuth();
  const key = ["core-intake-definitions", session?.user.id];
  const q = useQuery({ queryKey: key, queryFn: () => coreApi.listIntakeDefinitions(), enabled: !loading && !!session, retry: (n, e: any) => ![401, 403, 404, 422].includes(e?.status) && n < 1 });
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(d: IntakeDefinition, p: Record<string, unknown>) {
    setBusy(d.field_key);
    try {
      await coreApi.patchIntakeDefinition(d.field_key, p);
      await qc.invalidateQueries({ queryKey: ["core-intake-definitions"] });
      toast.success("נשמר ב-Core");
    } catch (e) { toast.error(intakeErrorText(e)); await qc.invalidateQueries({ queryKey: ["core-intake-definitions"] }); }
    finally { setBusy(null); }
  }

  return <div className="space-y-4" dir="rtl">
    <Card className="p-5 space-y-2">
      <h3 className="font-semibold">הסכמה לפני אינטייק</h3>
      <p className="text-sm text-muted-foreground">תמר שואלת שאלות רק אחרי הסכמה מפורשת של הלקוח לשיחה ב-WhatsApp. אין להבטיח מתנה, הטבה או פרס שאינם מוגדרים כהצעה אמיתית. תמר בוחרת מתי לשאול שאלה אופציונלית אחת לכל היותר, ותמיד עונה קודם לשאלת הלקוח.</p>
    </Card>
    <CoreReadState loading={loading || !session || q.isPending} error={q.error} retry={() => q.refetch()} />
    {q.data && !q.error && <Card className="p-5 space-y-3">
      <h3 className="font-semibold">שאלות האינטייק (Core)</h3>
      {!q.data.length && <p className="text-sm text-muted-foreground">לא הוגדרו שאלות ב-Core</p>}
      {q.data.map(d => <div key={d.field_key} className="rounded-md border border-border/60 p-3 space-y-2" data-field={d.field_key}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{d.label || d.field_key}</span>
          <Badge variant={d.stage === "progressive" ? "secondary" : "default"}>{d.stage === "progressive" ? "מתקדם · אחרי מסירת ערך" : "בסיס"}</Badge>
          <Badge variant="outline">{PRESENTATION[d.presentation]}</Badge>
          <label className="flex items-center gap-1 text-xs">סדר<Input key={`${d.field_key}-${d.order_index}`} className="h-8 w-20" type="number" defaultValue={d.order_index} disabled={busy === d.field_key} onBlur={e => { const n = Number(e.target.value); if (n !== d.order_index) patch(d, { order_index: n }); }} /></label>
          <label className="flex items-center gap-2 text-xs">חובה<Switch checked={d.required} disabled={busy === d.field_key} onCheckedChange={v => patch(d, { required: v })} /></label>
          <label className="flex items-center gap-2 text-xs">ניתן לדילוג<Switch checked={d.skippable} disabled={busy === d.field_key} onCheckedChange={v => patch(d, { skippable: v })} /></label>
          <label className="flex items-center gap-2 text-xs">פעיל<Switch checked={d.enabled} disabled={busy === d.field_key} onCheckedChange={v => patch(d, { enabled: v })} /></label>
        </div>
        <label className="block text-xs text-muted-foreground space-y-1">נוסח השאלה
          <Input key={`${d.field_key}-q-${d.question_text}`} defaultValue={d.question_text} disabled={busy === d.field_key} onBlur={e => e.target.value !== d.question_text && patch(d, { question_text: e.target.value })} />
        </label>
        <label className="block text-xs text-muted-foreground space-y-1">למה שואלים
          <Input key={`${d.field_key}-p-${d.purpose_text}`} defaultValue={d.purpose_text ?? ""} disabled={busy === d.field_key} onBlur={e => e.target.value !== (d.purpose_text ?? "") && patch(d, { purpose_text: e.target.value || null })} />
        </label>
        {d.options.length > 0 && <div className="flex gap-1 flex-wrap text-xs"><span className="text-muted-foreground">אפשרויות (לקריאה בלבד):</span>{d.options.map(o => <Badge key={o.id} variant="outline">{o.label}</Badge>)}</div>}
      </div>)}
    </Card>}
  </div>;
}
