/**
 * "מחיקת לקוח" — the single secure entry point for deleting a contact from
 * both the list and the profile screen. Shows a dry-run dependency preview,
 * requires a reason + typing the confirm word, and calls one transactional
 * server action. No direct client-side DELETE anywhere.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { deleteContactAdmin, previewContactDeletion } from "@/lib/contact-admin.functions";
import {
  DELETE_CONFIRM_WORD, DELETE_COUNT_LABELS, MIN_REASON_LENGTH, PRESERVED_KEYS, isDeleteConfirmed,
} from "@/lib/contact-admin/core";
import { useLanguage } from "@/lib/language-context";

export function ContactDeleteDialog({
  open, onOpenChange, contactId, contactName, onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string | null;
  contactName?: string | null;
  onDeleted?: (result: any) => void;
}) {
  const { dir } = useLanguage();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const previewFn = useServerFn(previewContactDeletion);
  const deleteFn = useServerFn(deleteContactAdmin);

  useEffect(() => {
    if (!open) {
      setReason("");
      setConfirmation("");
    }
  }, [open]);

  const preview = useQuery({
    queryKey: ["contact-delete-preview", contactId],
    enabled: open && !!contactId,
    staleTime: 0,
    queryFn: () => previewFn({ data: { contactId: contactId as string } }) as Promise<any>,
  });

  const del = useMutation({
    mutationFn: (vars: { contactId: string; reason: string; confirmation: string }) =>
      deleteFn({ data: vars }) as Promise<any>,
    onSuccess: (r) => {
      onDeleted?.(r);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error("המחיקה נכשלה: " + String(e?.message ?? e)),
  });

  const counts: Record<string, number> = preview.data?.counts ?? {};
  const deletedEntries = Object.entries(counts).filter(([k]) => !PRESERVED_KEYS.includes(k as any));
  const preservedEntries = Object.entries(counts).filter(([k]) => PRESERVED_KEYS.includes(k as any));
  const canDelete =
    !!contactId && reason.trim().length >= MIN_REASON_LENGTH && isDeleteConfirmed(confirmation) && !del.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !del.isPending && onOpenChange(v)}>
      <DialogContent dir={dir} className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-destructive">מחיקת לקוח לצמיתות</DialogTitle>
          <DialogDescription>
            {contactName || "ללא שם"} · {preview.data?.phone_masked ?? "טלפון לא ידוע"} — לא ניתן לבטל את הפעולה.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1">
            <div className="font-semibold">יימחק ({preview.isLoading ? "טוען..." : "תצוגה מקדימה"})</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground text-xs">
              {deletedEntries.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span>{DELETE_COUNT_LABELS[k] ?? k}</span>
                  <span className="tabular-nums font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-border p-3 space-y-1">
            <div className="font-semibold">יישמר (Zero-Loss)</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground text-xs">
              {preservedEntries.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span>{DELETE_COUNT_LABELS[k] ?? k}</span>
                  <span className="tabular-nums font-medium">{v}</span>
                </div>
              ))}
            </div>
            <div className="text-xs text-muted-foreground pt-1">
              המספר נשאר במרשם הזהויות ללא קישור ללקוח; הודעה עתידית תיצור לקוח חדש ונקי.
              {preview.data?.opted_out ? " הלקוח בסירוב — יישמר סימון חסימה שימנע פנייה חוזרת." : ""}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="delete-reason">סיבת המחיקה (חובה)</Label>
            <Textarea id="delete-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm">הקלד/י "{DELETE_CONFIRM_WORD}" כדי לאשר</Label>
            <Input id="delete-confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={del.isPending}>
            ביטול
          </Button>
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={!canDelete}
            onClick={() =>
              del.mutate({ contactId: contactId as string, reason: reason.trim(), confirmation: confirmation.trim() })
            }
          >
            {del.isPending ? "מוחק..." : "מחק לצמיתות"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}