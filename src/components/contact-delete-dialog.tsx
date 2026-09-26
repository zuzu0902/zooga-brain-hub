/**
 * "מחיקת לקוח" — soft delete through Hostinger Core only
 * (DELETE /v1/admin/contacts/:id). Reversible via Core restore.
 * No database writes from the browser.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { coreApi } from "@/lib/hostinger-core/client";
import { DELETE_CONFIRM_WORD, MIN_REASON_LENGTH, isDeleteConfirmed } from "@/lib/contact-admin/core";
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
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    if (!open) { setReason(""); setConfirmation(""); }
  }, [open]);

  const del = useMutation({
    mutationFn: (vars: { id: string; reason: string }) => coreApi.deleteContact(vars.id, vars.reason),
    onSuccess: (r, vars) => {
      qc.invalidateQueries({ queryKey: ["core-contacts"] });
      toast.success("איש הקשר הועבר לארכיון", {
        action: {
          label: "שחזר",
          onClick: async () => {
            try {
              await coreApi.restoreContact(vars.id);
              qc.invalidateQueries({ queryKey: ["core-contacts"] });
              qc.invalidateQueries({ queryKey: ["core-contact", vars.id] });
              toast.success("איש הקשר שוחזר");
            } catch (e: any) {
              toast.error("השחזור נכשל: " + String(e?.code ?? e?.message ?? e));
            }
          },
        },
      });
      onDeleted?.(r);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error("המחיקה נכשלה: " + String(e?.code ?? e?.message ?? e)),
  });

  const canDelete =
    !!contactId && reason.trim().length >= MIN_REASON_LENGTH && isDeleteConfirmed(confirmation) && !del.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !del.isPending && onOpenChange(v)}>
      <DialogContent dir={dir} className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-destructive">מחיקת לקוח</DialogTitle>
          <DialogDescription>
            {contactName || "ללא שם"} — הלקוח יועבר לארכיון ב-Hostinger Core. ניתן לשחזר אותו מיד לאחר מכן.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
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
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={del.isPending}>ביטול</Button>
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={!canDelete}
            onClick={() => del.mutate({ id: contactId as string, reason: reason.trim() })}
          >
            {del.isPending ? "מוחק..." : "מחק"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
