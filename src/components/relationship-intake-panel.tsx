import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Mic } from "lucide-react";
import { getRelationshipIntake } from "@/lib/relationship-intake.functions";
import { useT } from "@/lib/language-context";
import { RelationshipAiInsightsCard } from "@/components/relationship-ai-insights-card";

const STATUS_LABEL: Record<string, string> = {
  not_started: "טרם התחיל",
  in_progress: "בתהליך",
  completed: "הושלם",
  deferred: "נדחה",
};

export function RelationshipIntakePanel({ contactId }: { contactId: string }) {
  const t = useT();
  const load = useServerFn(getRelationshipIntake);
  const { data } = useQuery({
    queryKey: ["relationship-intake", contactId],
    queryFn: () => load({ data: { contactId } }),
  });
  if (!data) return null;
  const { state, questions, answers, progress, audit, voice } = data as any;

  return (
    <div className="space-y-4">
    <Card className="p-6 space-y-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">{t("שאלון זוגיות")}</h3>
        <Badge variant={state.status === "completed" ? "default" : "secondary"}>
          {STATUS_LABEL[state.status] ?? state.status}
        </Badge>
        {state.current_question_key && (
          <Badge variant="outline">{t("שאלה נוכחית")}: {state.current_question_key}</Badge>
        )}
        {state.pending_confirmation && <Badge variant="outline">{t("ממתין לאימות תמלול")}</Badge>}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span>
            {t("נענו")} {progress.answered.length} · {t("דולגו")} {progress.skipped.length} · {t("חסרות")}{" "}
            {progress.missing.length}
          </span>
          <span className="font-semibold">{progress.percent}%</span>
        </div>
        <Progress value={progress.percent} />
      </div>

      <div className="space-y-2">
        {questions.map((q: any) => {
          const a = answers[q.question_key];
          return (
            <div key={q.question_key} className="rounded-md border border-border/60 p-2 text-sm space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">{q.label}</span>
                {a?.skipped_by_user && <Badge variant="outline">{t("דולג")}</Badge>}
                {a && !a.skipped_by_user && a.source === "voice" && (
                  <Badge variant="secondary" className="gap-1">
                    <Mic className="h-3 w-3" /> {t("הודעה קולית")}
                  </Badge>
                )}
                {a?.confidence != null && <Badge variant="outline">{a.confidence}%</Badge>}
              </div>
              <div className="break-words">
                {a && !a.skipped_by_user ? a.raw_text : <span className="text-muted-foreground">{t("חסר")}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {Array.isArray(voice) && voice.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">{t("תמלולי הודעות קוליות")}</p>
          {voice.slice(0, 6).map((v: any) => (
            <div key={v.wa_message_id} className="rounded-md border border-border/60 p-2 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <Badge variant="outline">{v.status}</Badge>
                <span>{v.mime_type ?? "—"}</span>
                {v.duration_seconds ? <span>{v.duration_seconds}s</span> : null}
                <span>{v.provider ?? "—"}{v.model ? ` · ${v.model}` : ""}</span>
                <span>{v.created_at ? new Date(v.created_at).toLocaleString("he-IL") : ""}</span>
              </div>
              <div className="break-words">{v.transcript ?? "—"}</div>
            </div>
          ))}
        </div>
      )}

      {Array.isArray(audit) && audit.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">{t("יומן שינויים")}</p>
          {audit.slice(0, 10).map((a: any, i: number) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{a.question_key}</Badge>
              {a.is_correction && <Badge variant="secondary">{t("תיקון")}</Badge>}
              {!a.is_current && <Badge variant="outline">{t("היסטוריה")}</Badge>}
              <span>{a.source === "voice" ? t("הודעה קולית") : t("טקסט")}</span>
              <span>{a.answered_at ? new Date(a.answered_at).toLocaleString("he-IL") : ""}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
    <RelationshipAiInsightsCard contactId={contactId} />
    </div>
  );
}