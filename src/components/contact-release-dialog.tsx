/**
 * "החזר לתמר" — explicit, confirmed admin action. Closes every still-open
 * handoff, forces ownership back to automation and optionally resets the
 * intake. Never deletes transcript, profile facts or consent.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { releaseContactToTamar } from "@/lib/handoff.functions";
import {
  HANDOFF_OUTCOMES,
  HANDOFF_OUTCOME_LABELS_HE,
  managerOutcomeBlockers,
} from "@/lib/tamar-pilot/manager-outcome";
import { useLanguage } from "@/lib/language-context";

export function ContactReleaseDialog({
  open, onOpenChange, contactId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  onDone?: () => void;
}) {
  const { dir, t } = useLanguage();
  const [resetIntake, setResetIntake] = useState(false);
  // An accountable release: the reason is stored in the immutable audit log.
  const [reason, setReason] = useState("");
  // Manager accountability: contact, outcome and summary are recorded in CRM
  // before the conversation goes back to Tamar. There is no automatic release.
  const [contacted, setContacted] = useState(false);
  const [outcome, setOutcome] = useState<string>("");
  const [summary, setSummary] = useState("");
  const releaseFn = useServerFn(releaseContactToTamar);

  const outcomeBlockers = managerOutcomeBlockers({ contacted, outcome, summary });

  const release = useMutation({
    mutationFn: () =>
      releaseFn({
        data: {
          contactId,
          resetIntake,
          reason: reason.trim(),
          managerOutcome: { contacted, outcome, summary: summary.trim() },
        },
      }) as Promise<any>,
    onSuccess: (r) => {
      toast.success(
        r?.already_released
          ? t("השיחה כבר משוחררת — לא בוצע שינוי")
          : r?.released
          ? `${t("השיחה הוחזרה לתמר")} · ${r.resolved_handoffs ?? 0} ${t("פניות נסגרו")}`
          : t("לא בוצע שחרור"),
      );
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: any) =>
      toast.error(
        String(e?.message ?? e).includes("manager_outcome_required")
          ? t("חובה לתעד יצירת קשר, תוצאה וסיכום לפני החזרה לתמר")
          : t("שגיאה: ") + String(e?.message ?? e),
      ),
  });


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir}>
        <DialogHeader>
          <DialogTitle>{t("החזר לתמר")}</DialogTitle>
          <DialogDescription>
            {t("פעולה זו סוגרת את כל הפניות הפתוחות לנציג, משחררת את הנעילה האנושית ומחזירה את השיחה לאוטומציה. ההיסטוריה, פרופיל הלקוח וההסכמה נשמרים.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="release-reason">{t("סיבת השחרור (חובה, נשמרת בלוג ביקורת)")}</Label>
          <Textarea
            id="release-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("לדוגמה: הנציג סיים לטפל, ניתן להחזיר את השיחה לתמר")}
            rows={2}
          />
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Checkbox id="manager-contacted" checked={contacted} onCheckedChange={(v) => setContacted(v === true)} />
            <Label htmlFor="manager-contacted">{t("אני מאשר/ת שיצרתי קשר עם הלקוח")}</Label>
          </div>
          <div className="space-y-1">
            <Label>{t("תוצאת הטיפול (חובה)")}</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue placeholder={t("בחר/י תוצאה")} /></SelectTrigger>
              <SelectContent>
                {HANDOFF_OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>{t(HANDOFF_OUTCOME_LABELS_HE[o])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="manager-summary">{t("סיכום לנציג (חובה — תמר ממשיכה ממנו)")}</Label>
            <Textarea
              id="manager-summary"
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t("מה סוכם עם הלקוח, מה נותר פתוח, ומה תמר צריכה לדעת")}
            />
          </div>
          {outcomeBlockers.length > 0 && (
            <ul className="text-xs text-destructive space-y-0.5">
              {outcomeBlockers.map((b) => <li key={b}>{t(b)}</li>)}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox id="reset-intake" checked={resetIntake} onCheckedChange={(v) => setResetIntake(v === true)} />
          <Label htmlFor="reset-intake">{t("אפס גם את האינטייק (השיחה תתחיל מחדש)")}</Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("ביטול")}</Button>
          <Button onClick={() => release.mutate()} disabled={release.isPending || reason.trim().length < 3 || outcomeBlockers.length > 0}>
            {release.isPending ? t("משחרר...") : t("אשר והחזר לתמר")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
