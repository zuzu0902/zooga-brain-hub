import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Brain, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getRelationshipInsights,
  refreshRelationshipInsights,
} from "@/lib/relationship-insights.functions";

const STATUS_LABEL: Record<string, string> = {
  ok: "מוכן",
  degraded: "חלקי",
  fallback: "גיבוי דטרמיניסטי",
  error: "שגיאה",
  pending: "בהמתנה",
};

const CERTAINTY_LABEL: Record<string, string> = {
  explicit_fact: "עובדה מפורשת",
  supported_hypothesis: "השערה נתמכת",
  unknown: "לא ידוע",
};

export function RelationshipAiInsightsCard({ contactId }: { contactId: string }) {
  const load = useServerFn(getRelationshipInsights);
  const refresh = useServerFn(refreshRelationshipInsights);
  const qc = useQueryClient();
  const [denied, setDenied] = useState(false);

  const { data } = useQuery({
    queryKey: ["relationship-ai-insights", contactId],
    queryFn: async () => {
      try {
        return await load({ data: { contactId } });
      } catch (e: any) {
        if (String(e?.message ?? e).includes("forbidden")) {
          setDenied(true);
          return null;
        }
        throw e;
      }
    },
    retry: false,
  });

  const mut = useMutation({
    mutationFn: () => refresh({ data: { contactId } }),
    onSuccess: () => {
      toast.success("התובנות עודכנו");
      void qc.invalidateQueries({ queryKey: ["relationship-ai-insights", contactId] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  if (denied || !data) return null;
  const current = (data as any).current;

  return (
    <Card dir="rtl" className="p-6 space-y-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">תובנות AI לזוגיות</h3>
        <Badge variant="outline">פנימי — לצוות בלבד</Badge>
        {current && (
          <>
            <Badge variant={current.status === "ok" ? "default" : "secondary"}>
              {STATUS_LABEL[current.status] ?? current.status}
            </Badge>
            {current.confidence != null && <Badge variant="outline">ביטחון כללי: {current.confidence}%</Badge>}
            <Badge variant="outline">גרסה {current.version}</Badge>
            <Badge variant="outline">
              עודכן: {current.generated_at ? new Date(current.generated_at).toLocaleString("he-IL") : "—"}
            </Badge>
            {(data as any).stale && <Badge variant="secondary">התשובות השתנו מאז</Badge>}
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ms-auto gap-1"
          disabled={mut.isPending || !(data as any).has_answers}
          onClick={() => mut.mutate()}
        >
          <RefreshCw className={`h-3 w-3 ${mut.isPending ? "animate-spin" : ""}`} />
          רענן תובנות AI
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        פרופיל התנהגותי/זוגי לא־קליני, מבוסס שאלון בלבד. אינו אבחון ואינו מוצג ללקוח. תגיות התאמה הן עזר בלבד.
      </p>

      {!current && (
        <p className="text-sm text-muted-foreground">
          {(data as any).has_answers ? "טרם הופקו תובנות. אפשר לרענן ידנית." : "אין עדיין תשובות בשאלון הזוגיות."}
        </p>
      )}

      {current && (
        <>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{current.summary_he}</p>
          {current.error && <p className="text-xs text-destructive">סיבת מצב חלקי: {current.error}</p>}

          <Accordion type="multiple" className="w-full">
            {(current.sections ?? []).map((s: any) => (
              <AccordionItem key={s.key} value={s.key}>
                <AccordionTrigger className="text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    {s.label}
                    <Badge variant="outline">{(s.items ?? []).length}</Badge>
                    {current.section_confidence?.[s.key] != null && (
                      <Badge variant="outline">{current.section_confidence[s.key]}%</Badge>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-2">
                  {(s.items ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground">לא ידוע — אין מספיק מידע בשאלון.</p>
                  )}
                  {(s.items ?? []).map((i: any, idx: number) => (
                    <div key={idx} className="rounded-md border border-border/60 p-2 text-sm space-y-1">
                      <div className="break-words">{i.text}</div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant={i.certainty === "explicit_fact" ? "default" : "outline"}>
                          {CERTAINTY_LABEL[i.certainty] ?? i.certainty}
                        </Badge>
                        {(i.evidence_keys ?? []).map((k: string) => (
                          <Badge key={k} variant="secondary" className="text-[10px]">
                            {k}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {(current.contradictions ?? []).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">סתירות ומתחים</p>
              {current.contradictions.map((c: any, i: number) => (
                <div key={i} className="rounded-md border border-border/60 p-2 text-xs">
                  {c.text}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(c.evidence_keys ?? []).map((k: string) => (
                      <Badge key={k} variant="secondary" className="text-[10px]">{k}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(current.missing_info ?? []).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">מידע חסר / שאלות להשלמה</p>
              <div className="flex flex-wrap gap-1">
                {current.missing_info.map((m: any) => (
                  <Badge key={m.question_key} variant="outline" className="text-[10px]">{m.question_key}</Badge>
                ))}
              </div>
            </div>
          )}

          {(current.matching_tags ?? []).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">סיגנלים להתאמה עתידית (עזר בלבד)</p>
              <div className="flex flex-wrap gap-1">
                {current.matching_tags.map((t: any, i: number) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">{t.tag}</Badge>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}