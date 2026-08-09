import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getIntakeStudioConfig, saveIntakeFieldDefinition } from "@/lib/onboarding.functions";
import { CONSENT_QUESTION_BUTTONS, CONSENT_QUESTION_TEXT } from "@/lib/onboarding/types";

/** Baseline intake calibration — order, wording, required/optional, menu vs free text. */
export function IntakeConfigTab() {
  const qc = useQueryClient();
  const load = useServerFn(getIntakeStudioConfig);
  const save = useServerFn(saveIntakeFieldDefinition);
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({ queryKey: ["intake-studio-config"], queryFn: () => load() });

  async function patch(field_key: string, patchData: Record<string, unknown>) {
    setBusy(true);
    try {
      await save({ data: { field_key, ...patchData } as any });
      qc.invalidateQueries({ queryKey: ["intake-studio-config"] });
      toast.success("נשמר");
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  const tpl: any = (data as any).template;

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold">שלב 1 — תבנית פתיחה (זמינות בלבד)</h3>
          <Badge variant={tpl?.approved ? "default" : "secondary"}>
            {tpl?.approved ? "מאושרת ב-Meta" : `לא מאושרת${tpl?.meta_status ? ` (${tpl.meta_status})` : ""}`}
          </Badge>
          <Badge variant="outline">טיוטה: {tpl?.draft?.status ?? "—"}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          נשלחת מחוץ לחלון 24 השעות ושואלת רק אם נוח לדבר עכשיו. "לא עכשיו" = דחייה זמנית בלבד — לא סירוב ולא הסרה.
        </p>
        <p className="text-sm whitespace-pre-wrap">{tpl?.draft?.body_text}</p>
        <div className="flex gap-2">
          {(tpl?.draft?.buttons ?? []).map((b: any) => (
            <Badge key={b.id} variant="outline">{b.label} · {b.id}</Badge>
          ))}
        </div>
        {!tpl?.approved && (
          <p className="text-xs text-destructive">
            שליחה יזומה חסומה עד שהתבנית תאושר ב-Meta. {tpl?.reason ?? ""}
          </p>
        )}
      </Card>

      <Card className="p-5 space-y-2">
        <h3 className="font-semibold">שלב 2 — שאלת הסכמה אינטראקטיבית</h3>
        <p className="text-xs text-muted-foreground">
          נשלחת רק בתוך חלון השירות, אחרי "כן, אפשר" או אחרי הודעה יזומה של הלקוח. זהו המקום היחיד שבו נרשמת הסכמה.
        </p>
        <p className="text-sm whitespace-pre-wrap">{CONSENT_QUESTION_TEXT}</p>
        <div className="flex gap-2">
          {CONSENT_QUESTION_BUTTONS.map((b) => (
            <Badge key={b.id} variant="outline">{b.label} · {b.id}</Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">"לא, תודה" = סירוב מלא, הסרה וסגירה מנומסת.</p>
      </Card>

      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">שאלות baseline intake</h3>
        <p className="text-xs text-muted-foreground">
          baseline = שלוש שאלות בלבד (אזור, תחומי עניין, מטרה), שאלה אחת בכל תור. תאריך לידה הוא שאלה מתקדמת ואופציונלית אחרי מסירת ערך.
        </p>
        {((data as any).defs ?? []).map((d: any) => (
          <div key={d.field_key} className="rounded-md border border-border/60 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{d.field_key}</Badge>
              <Badge variant={d.stage === "progressive" ? "secondary" : "default"}>
                {d.stage === "progressive" ? "מתקדם / אופציונלי" : "baseline"}
              </Badge>
              <Input
                className="h-8 w-20"
                type="number"
                defaultValue={d.order_index}
                onBlur={(e) => patch(d.field_key, { order_index: Number(e.target.value) })}
              />
              <Select value={d.presentation} onValueChange={(v) => patch(d.field_key, { presentation: v })}>
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">טקסט חופשי</SelectItem>
                  <SelectItem value="menu">תפריט</SelectItem>
                  <SelectItem value="multi">בחירה מרובה</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-xs">
                חובה
                <Switch checked={d.required} onCheckedChange={(v) => patch(d.field_key, { required: v })} />
              </label>
              <label className="flex items-center gap-2 text-xs">
                ניתן לדילוג
                <Switch checked={d.skippable} onCheckedChange={(v) => patch(d.field_key, { skippable: v })} />
              </label>
              <label className="flex items-center gap-2 text-xs">
                פעיל
                <Switch checked={d.enabled} onCheckedChange={(v) => patch(d.field_key, { enabled: v })} />
              </label>
            </div>
            <Input
              defaultValue={d.question_text}
              disabled={busy}
              onBlur={(e) => e.target.value !== d.question_text && patch(d.field_key, { question_text: e.target.value })}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}