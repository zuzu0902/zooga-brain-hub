/**
 * "איפוס תמר" — safe, server-side reset of the operational state of one
 * contact. Never touches consent/opt-out, never deletes message history and
 * never sends WhatsApp.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { resetTamarForContact } from "@/lib/contact-admin.functions";
import { summarizeReset, MIN_REASON_LENGTH, type ResetResult } from "@/lib/contact-admin/core";
import { useLanguage } from "@/lib/language-context";

export function ContactResetDialog({
  open, onOpenChange, contactId, contactName, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  contactName?: string | null;
  onDone?: () => void;
}) {
  const { dir } = useLanguage();
  const [reason, setReason] = useState("");
  const [resetIntake, setResetIntake] = useState(false);
  const [result, setResult] = useState<ResetResult | null>(null);
  const resetFn = useServerFn(resetTamarForContact);

  const reset = useMutation({
    mutationFn: (vars: { contactId: string; reason: string; resetIntake: boolean }) =>
      resetFn({ data: vars }) as Promise<ResetResult>,
    onSuccess: (r) => {
      setResult(r);
      toast.success("האיפוס בוצע");
      onDone?.();
    },
    onError: (e: any) => toast.error("האיפוס נכשל: " + String(e?.message ?? e)),
  });

  function close(v: boolean) {
    if (reset.isPending) return;
    if (!v) {
      setReason("");
      setResetIntake(false);
      setResult(null);
    }
    onOpenChange(v);
  }

  const reasonValid = reason.trim().length >= MIN_REASON_LENGTH;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent dir={dir} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>איפוס תמר {contactName ? `· ${contactName}` : ""}</DialogTitle>
          <DialogDescription>
            פעולה בטוחה שמחזירה את השיחה לתמר. ההודעות, ההיסטוריה, מרשם הזהויות והפרופיל העסקי נשמרים.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2 text-sm">
            <div className="font-semibold">סיכום האיפוס</div>
            <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
              {summarizeReset(result).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="rounded-md border border-border p-3 space-y-1">
              <div className="font-semibold">מה יאופס</div>
              <ul className="list-disc pr-5 text-muted-foreground space-y-0.5">
                <li>סגירת כל הפניות הפתוחות לנציג</li>
                <li>שחרור בעלות אנושית / הקפאת אוטומציה / נעילות</li>
                <li>ביטול עבודות רקע ושליחות ממתינות (idempotent)</li>
                <li>ניקוי מצב runtime/החלטה זמני</li>
              </ul>
              <div className="font-semibold pt-2">מה יישמר תמיד</div>
              <ul className="list-disc pr-5 text-muted-foreground space-y-0.5">
                <li>הסכמה/סירוב (opt-out לא הופך ל-opt-in)</li>
                <li>כל ההודעות, ה-vault הגולמי, מרשם הזהויות והביקורת</li>
                <li>הפרופיל העסקי</li>
              </ul>
            </div>

            <label className="flex items-start gap-2 rounded-md border border-border p-3 cursor-pointer">
              <Checkbox
                checked={resetIntake}
                onCheckedChange={(v) => setResetIntake(v === true)}
                aria-label="אפס גם את תהליך האינטייק"
              />
              <span>
                <span className="font-medium">אפס גם את תהליך האינטייק</span>
                <span className="block text-muted-foreground text-xs">
                  אינטייק, שאלון זוגיות, התקדמות קמפיין ושדות שנגזרו מהאינטייק בלבד. ההודעות לא נמחקות.
                </span>
              </span>
            </label>

            <div className="space-y-1.5">
              <Label htmlFor="reset-reason">סיבת האיפוס (חובה)</Label>
              <Textarea
                id="reset-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="לדוגמה: השיחה נתקעה אחרי העברה לנציג"
                rows={3}
              />
            </div>
            <div className="text-xs text-muted-foreground">לא תישלח הודעת WhatsApp כתוצאה מהפעולה.</div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => close(false)}>סגור</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => close(false)} disabled={reset.isPending}>
                ביטול
              </Button>
              <Button
                disabled={!reasonValid || reset.isPending}
                onClick={() => reset.mutate({ contactId, reason: reason.trim(), resetIntake })}
              >
                {reset.isPending ? "מאפס..." : "אשר איפוס"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}