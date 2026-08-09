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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { releaseContactToTamar } from "@/lib/handoff.functions";
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
  const releaseFn = useServerFn(releaseContactToTamar);

  const release = useMutation({
    mutationFn: () => releaseFn({ data: { contactId, resetIntake } }) as Promise<any>,
    onSuccess: (r) => {
      toast.success(
        r?.released
          ? `${t("השיחה הוחזרה לתמר")} · ${r.resolved_handoffs ?? 0} ${t("פניות נסגרו")}`
          : t("לא בוצע שחרור"),
      );
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: any) => toast.error(t("שגיאה: ") + String(e?.message ?? e)),
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
        <div className="flex items-center gap-2">
          <Checkbox id="reset-intake" checked={resetIntake} onCheckedChange={(v) => setResetIntake(v === true)} />
          <Label htmlFor="reset-intake">{t("אפס גם את האינטייק (השיחה תתחיל מחדש)")}</Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("ביטול")}</Button>
          <Button onClick={() => release.mutate()} disabled={release.isPending}>
            {release.isPending ? t("משחרר...") : t("אשר והחזר לתמר")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
