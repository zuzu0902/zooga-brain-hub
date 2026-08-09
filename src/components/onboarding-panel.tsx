import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { correctContactFact, getContactOnboarding } from "@/lib/onboarding.functions";
import { useT } from "@/lib/language-context";

const CONSENT_LABEL: Record<string, string> = {
  unknown: "לא ידוע",
  pending: "ממתין לתשובה",
  granted: "אושר",
  denied: "סירב / הוסר",
};
const INTAKE_LABEL: Record<string, string> = {
  not_started: "טרם התחיל",
  in_progress: "בתהליך",
  completed: "הושלם",
};
const OPENING_LABEL: Record<string, string> = {
  not_sent: "לא נשלחה פתיחה",
  asked: "נשאל אם נוח לדבר",
  available: "אישר/ה שנוח לדבר",
  deferred: "לא עכשיו (נדחה זמנית)",
};
const RELATIONSHIP_LABEL: Record<string, string> = {
  not_offered: "שאלון זוגיות: טרם הוצע",
  offered: "שאלון זוגיות: הוצע, ממתין לתשובה",
  ready_to_start: "שאלון זוגיות: מוכן להתחיל",
  deferred: "שאלון זוגיות: מאוחר יותר (לא סירוב)",
};

export function OnboardingPanel({ contactId }: { contactId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const load = useServerFn(getContactOnboarding);
  const save = useServerFn(correctContactFact);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const { data } = useQuery({
    queryKey: ["onboarding", contactId],
    queryFn: () => load({ data: { contactId } }),
  });

  if (!data) return null;
  const { routable, completeness, facts, next_step, next_progressive_step, events, relationship_intake } =
    data as any;
  const consent = routable.consent;
  const intake = routable.intake;
  const opening = routable.opening ?? { opening_status: "not_sent" };
  const rel = relationship_intake ?? { status: "not_offered" };

  async function commit(fieldKey: string) {
    try {
      await save({ data: { contactId, fieldKey, value: draft } });
      toast.success(t("עודכן"));
      setEditing(null);
      setDraft("");
      qc.invalidateQueries({ queryKey: ["onboarding", contactId] });
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    }
  }

  return (
    <Card className="p-6 space-y-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">{t("הסכמה ואינטייק")}</h3>
        <Badge variant={opening.opening_status === "available" ? "default" : opening.opening_status === "deferred" ? "outline" : "secondary"}>
          {t("פתיחה")}: {OPENING_LABEL[opening.opening_status] ?? opening.opening_status}
        </Badge>
        <Badge variant={consent.consent_status === "granted" ? "default" : consent.consent_status === "denied" ? "destructive" : "secondary"}>
          {t("הסכמה")}: {CONSENT_LABEL[consent.consent_status] ?? consent.consent_status}
        </Badge>
        <Badge variant="outline">
          {t("אינטייק")}: {INTAKE_LABEL[intake.baseline_intake_status] ?? intake.baseline_intake_status} · v{intake.intake_version}
        </Badge>
        {routable.conversation.has_prior_conversation && (
          <Badge variant="outline">{t("שיחה קודמת קיימת")}</Badge>
        )}
        <Badge variant={rel.status === "ready_to_start" ? "default" : "outline"}>
          {RELATIONSHIP_LABEL[rel.status] ?? rel.status}
        </Badge>
      </div>

      <div className="text-xs text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>{t("מקור הסכמה")}: {consent.consent_source ?? "—"}</div>
        <div>{t("זמן הסכמה")}: {consent.consent_at ? new Date(consent.consent_at).toLocaleString("he-IL") : "—"}</div>
        <div>{t("גרסת נוסח")}: {consent.consent_version ?? "—"}</div>
        <div>{t("סה״כ הודעות")}: {routable.conversation.total_messages}</div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span>{t("שלמות פרופיל")}</span>
          <span className="font-semibold">{completeness.percent}%</span>
        </div>
        <Progress value={completeness.percent} />
        {next_step && (
          <p className="text-xs text-muted-foreground">
            {t("השאלה הבאה")}: {next_step.question_text}
          </p>
        )}
        {!next_step && next_progressive_step && (
          <p className="text-xs text-muted-foreground">
            {t("שאלה מתקדמת אופציונלית")}: {next_progressive_step.question_text}
          </p>
        )}
      </div>

      <div className="space-y-2">
        {completeness.fields.map((f: any) => {
          const fact = facts.find((x: any) => x.field_key === f.field_key);
          return (
            <div key={f.field_key} className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 p-2 text-sm">
              <span className="w-32 shrink-0 text-muted-foreground">{f.label}</span>
              {editing === f.field_key ? (
                <>
                  <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 max-w-xs" />
                  <Button size="sm" onClick={() => commit(f.field_key)}>{t("שמור")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t("ביטול")}</Button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 truncate">{f.value ?? <span className="text-muted-foreground">{t("חסר")}</span>}</span>
                  {f.known && (
                    <Badge variant={f.kind === "explicit" ? "default" : "secondary"}>
                      {f.kind === "explicit" ? t("עובדה מפורשת") : t("תובנה משוערת")} · {f.confidence}%
                    </Badge>
                  )}
                  {fact?.source && <span className="text-xs text-muted-foreground">{fact.source}</span>}
                  <Button size="sm" variant="outline" onClick={() => { setEditing(f.field_key); setDraft(f.value ?? ""); }}>
                    {t("תיקון")}
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {completeness.missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("שדות חסרים")}: {completeness.missing.join(", ")}
        </p>
      )}

      {Array.isArray(events) && events.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">{t("יומן פתיחה והסכמה")}</p>
          {events.slice(0, 6).map((e: any, i: number) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{e.event_type}</Badge>
              {e.button_title && <span>{e.button_title}</span>}
              <span>{e.created_at ? new Date(e.created_at).toLocaleString("he-IL") : ""}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}