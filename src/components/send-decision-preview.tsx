import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { previewCampaignRouting } from "@/lib/onboarding.functions";
import { useT } from "@/lib/language-context";

const DECISION_LABEL: Record<string, string> = {
  new_intake: "אינטייק חדש",
  resume_intake: "המשך אינטייק",
  known_contact: "לקוח מוכר",
  suppressed: "חסום — הוסר/סירב",
  blocked_missing_optin: "חסום — אין opt-in מתועד",
  blocked_missing_template: "חסום — אין תבנית מאושרת",
  blocked_invalid_phone: "חסום — מספר לא תקין",
};

function tone(d: string) {
  if (d === "new_intake" || d === "resume_intake" || d === "known_contact") return "default";
  if (d === "suppressed") return "destructive";
  return "secondary";
}

/**
 * Pre-send classification. The actual send consumes exactly this decision —
 * a row with may_send=false can never be dispatched from the UI.
 */
export function SendDecisionPreview({ initialPhones = "" }: { initialPhones?: string }) {
  const t = useT();
  const preview = useServerFn(previewCampaignRouting);
  const [raw, setRaw] = useState(initialPhones);
  const [optIn, setOptIn] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    const phones = raw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!phones.length) return;
    setLoading(true);
    try {
      setResult(await preview({ data: { phones, optInEvidence: optIn } }));
    } finally {
      setLoading(false);
    }
  }

  const sendable = (result?.rows ?? []).filter((r: any) => r.may_send);

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold">{t("בדיקת שליחה לפני קמפיין")}</h3>
        {result && (
          <Badge variant={result.template_approved ? "default" : "destructive"}>
            {result.template_approved ? t("תבנית פתיחה מאושרת") : t("תבנית פתיחה לא מאושרת")}
          </Badge>
        )}
      </div>
      <Textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={4}
        dir="ltr"
        placeholder="050-1234567, +972501234567"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
        {t("קיימת הסכמת opt-in מתועדת למקור הרשימה הזו")}
      </label>
      <Button onClick={run} disabled={loading}>{loading ? t("בודק...") : t("הצג סיווג")}</Button>

      {result && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t("ניתן לשלוח")}: {sendable.length} / {result.rows.length}
            {result.template_reason ? ` · ${result.template_reason}` : ""}
          </p>
          <div className="space-y-1">
            {result.rows.map((r: any, i: number) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 p-2 text-sm">
                <span dir="ltr" className="w-40 shrink-0">{r.phone ?? r.input}</span>
                <Badge variant={tone(r.decision) as any}>{DECISION_LABEL[r.decision] ?? r.decision}</Badge>
                <span className="text-xs text-muted-foreground">{r.reason}</span>
                {r.name && <span className="text-xs">{r.name}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}