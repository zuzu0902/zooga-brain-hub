/**
 * "הפעלת תמר" — admin-initiated conversation starter inside the contact card.
 *
 * The UI never sends by itself: it previews through the server (which runs the
 * full safety gate), then asks for an explicit confirmation before the send or
 * the scheduling.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MessageCirclePlus, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { isOfferSellable } from "@/lib/offer-sellable";
import {
  ACTIVATION_TOPICS,
  activationFormBlockers,
  effectiveInstruction,
  MIN_INSTRUCTION_LENGTH,
  STATUS_LABELS_HE,
  topicSpec,
  type ActivationStatus,
} from "@/lib/tamar-activation/core";
import {
  cancelTamarActivation,
  previewTamarActivation,
  startTamarActivation,
} from "@/lib/tamar-activation.functions";

const NO_OFFER = "__none__";

/** datetime-local (Israel wall clock in the admin's browser) → UTC ISO. */
function localToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
}

export function TamarActivationCard({ contactId, contactName }: { contactId: string; contactName?: string | null }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: activations } = useQuery({
    queryKey: ["tamar-activations", contactId],
    queryFn: async () => {
      const { data } = await supabase
        .from("tamar_activations" as any)
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(15);
      const rows = (data as any[]) ?? [];
      const ids = Array.from(new Set(rows.map((r) => r.offer_id).filter(Boolean)));
      let titles: Record<string, string> = {};
      if (ids.length) {
        const { data: offers } = await supabase.from("offers").select("id, title").in("id", ids as string[]);
        titles = Object.fromEntries(((offers as any[]) ?? []).map((o) => [o.id, o.title]));
      }
      return rows.map((r) => ({ ...r, offer_title: r.offer_id ? (titles[r.offer_id] ?? null) : null }));
    },
  });

  const cancelFn = useServerFn(cancelTamarActivation);
  const cancel = useMutation({
    mutationFn: (activationId: string) => cancelFn({ data: { activation_id: activationId } }) as Promise<any>,
    onSuccess: (r) => {
      if (r?.ok) toast.success("ההפעלה בוטלה");
      else toast.error(r?.error ?? "הביטול נכשל");
      qc.invalidateQueries({ queryKey: ["tamar-activations", contactId] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold">הפעלת תמר</div>
          <div className="text-xs text-muted-foreground">פתיחת שיחה יזומה עם הלקוח, עכשיו או במועד עתידי.</div>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <MessageCirclePlus className="h-4 w-4" /> פתיחת שיחה עם תמר
        </Button>
      </div>

      {!!activations?.length && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">היסטוריית הפעלות</div>
          <ul className="space-y-2">
            {activations.map((a: any) => (
              <li key={a.id} className="rounded-lg border border-border/70 p-2.5 text-xs space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={a.status === "sent" ? "default" : "secondary"}>
                    {STATUS_LABELS_HE[a.status as ActivationStatus] ?? a.status}
                  </Badge>
                  <span className="font-medium">{topicSpec(a.topic)?.label_he ?? a.topic}</span>
                  <span className="text-muted-foreground">
                    {a.executed_at ? `נשלח ${fmt(a.executed_at)}` : a.scheduled_at ? `מתוזמן ל-${fmt(a.scheduled_at)}` : fmt(a.created_at)}
                  </span>
                  {a.transport && <span className="text-muted-foreground">· {a.transport === "template" ? "תבנית" : "חלון שירות"}</span>}
                  {a.transport === "template" && topicSpec(a.topic)?.template?.name && (
                    <span className="text-muted-foreground">· {topicSpec(a.topic)!.template!.name}</span>
                  )}
                  {a.offer_title && <span className="text-muted-foreground">· {a.offer_title}</span>}
                  {["draft", "scheduled"].includes(a.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 gap-1"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(a.id)}
                    >
                      <X className="h-3 w-3" /> ביטול
                    </Button>
                  )}
                </div>
                {a.actual_message && <div className="whitespace-pre-wrap text-muted-foreground">{a.actual_message}</div>}
                {a.block_reason_he && <div className="text-destructive">נחסם: {a.block_reason_he}</div>}
                {a.last_error && <div className="text-destructive">שגיאה: {a.last_error}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <TamarActivationDialog
        open={open}
        onOpenChange={setOpen}
        contactId={contactId}
        contactName={contactName}
        onDone={() => qc.invalidateQueries({ queryKey: ["tamar-activations", contactId] })}
      />
    </div>
  );
}

function TamarActivationDialog({
  open, onOpenChange, contactId, contactName, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  contactName?: string | null;
  onDone?: () => void;
}) {
  const [topic, setTopic] = useState<string>("intake_continue");
  const [instruction, setInstruction] = useState("");
  const [offerId, setOfferId] = useState<string>(NO_OFFER);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduleLocal, setScheduleLocal] = useState("");
  const [preview, setPreview] = useState<string>("");
  const [previewMeta, setPreviewMeta] = useState<{
    template_name: string | null;
    offer_title: string | null;
    offer_auto_selected: boolean;
    transport: string | null;
  } | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { data: offers } = useQuery({
    queryKey: ["sellable-offers"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("offers")
        .select("id, title, status, event_date, event_end_date")
        .eq("status", "active")
        .order("event_date", { ascending: true })
        .limit(100);
      return ((data as any[]) ?? []).filter((o) => isOfferSellable(o));
    },
  });

  const previewFn = useServerFn(previewTamarActivation);
  const startFn = useServerFn(startTamarActivation);

  const scheduledAt = useMemo(() => (when === "later" ? localToIso(scheduleLocal) : null), [when, scheduleLocal]);
  const instructionOptional = !!topicSpec(topic)?.instruction_optional;
  const instructionValid = effectiveInstruction(topic, instruction).length >= MIN_INSTRUCTION_LENGTH;
  const blockers = activationFormBlockers({
    topic,
    instruction,
    when,
    scheduledAt,
    previewReady: !!preview,
    gateReasonHe: gateError,
  });

  const runPreview = useMutation({
    mutationFn: () =>
      previewFn({
        data: {
          contact_id: contactId,
          topic,
          instruction: instruction.trim(),
          offer_id: offerId === NO_OFFER ? null : offerId,
        },
      }) as Promise<any>,
    onSuccess: (r) => {
      if (!r?.gate?.allowed) {
        setPreview("");
        setGateError(r?.gate?.reason_he ?? "הפעולה נחסמה");
        return;
      }
      setGateError(null);
      setPreview(String(r.preview ?? ""));
      setPreviewMeta({
        template_name: r.template_name ?? null,
        offer_title: r.offer_title ?? null,
        offer_auto_selected: !!r.offer_auto_selected,
        transport: r.transport ?? null,
      });
    },
    onError: (e: any) => setGateError(String(e?.message ?? e)),
  });

  const start = useMutation({
    mutationFn: () =>
      startFn({
        data: {
          contact_id: contactId,
          topic,
          instruction: instruction.trim(),
          offer_id: offerId === NO_OFFER ? null : offerId,
          scheduled_at: scheduledAt,
          preview: preview || null,
        },
      }) as Promise<any>,
    onSuccess: (r) => {
      if (!r?.ok) return toast.error(r?.error ?? "ההפעלה נכשלה");
      const ex = r.execution;
      if (!ex) toast.success("ההפעלה תוזמנה");
      else if (ex.status === "sent") toast.success("תמר שלחה את ההודעה");
      else if (ex.status === "blocked") toast.error("נחסם: " + (ex.reason_he ?? ex.reason));
      else toast.error("ההפעלה נכשלה: " + (ex.reason ?? ""));
      onDone?.();
      close(false);
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  function close(v: boolean) {
    if (start.isPending) return;
    if (!v) {
      setInstruction("");
      setOfferId(NO_OFFER);
      setWhen("now");
      setScheduleLocal("");
      setPreview("");
      setGateError(null);
      setConfirming(false);
    }
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>הפעלת תמר {contactName ? `· ${contactName}` : ""}</DialogTitle>
          <DialogDescription>
            תמר תפתח שיחה על בסיס ההוראה שלך, הפרופיל וההיסטוריה. ההודעה נשלחת רק אחרי אישור מפורש.
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-border p-3 space-y-1">
              <div><span className="text-muted-foreground">נמען: </span>{contactName ?? contactId}</div>
              <div><span className="text-muted-foreground">מטרה: </span>{topicSpec(topic)?.label_he}</div>
            {previewMeta?.template_name && (
              <div><span className="text-muted-foreground">תבנית מאושרת: </span>{previewMeta.template_name}</div>
            )}
            {previewMeta?.offer_title && (
              <div>
                <span className="text-muted-foreground">פעילות מקושרת: </span>
                {previewMeta.offer_title}
                {previewMeta.offer_auto_selected ? " (נבחרה אוטומטית)" : ""}
              </div>
            )}
              <div>
                <span className="text-muted-foreground">מועד: </span>
                {when === "now" ? "עכשיו" : fmt(scheduledAt)}
              </div>
            </div>
            <div className="rounded-md border border-border p-3 whitespace-pre-wrap">{preview}</div>
            <div className="text-xs text-muted-foreground">
              השערים ייבדקו מחדש רגע לפני השליחה. אם משהו השתנה — ההודעה תיחסם ולא תישלח.
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <Label>מטרת השיחה</Label>
              <Select value={topic} onValueChange={(v) => { setTopic(v); setPreview(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVATION_TOPICS.map((t) => (
                    <SelectItem key={t.key} value={t.key}>{t.label_he}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="activation-instruction">
                {instructionOptional ? "הוראה לתמר (אופציונלי)" : "הוראה לתמר (חובה)"}
              </Label>
              <Textarea
                id="activation-instruction"
                rows={3}
                value={instruction}
                onChange={(e) => { setInstruction(e.target.value); setPreview(""); }}
                placeholder={
                  instructionOptional
                    ? "אפשר להשאיר ריק — תמר תחדש קשר סביב הפעילות הפעילה, בלי להמציא פרטים"
                    : "לדוגמה: תשאלי אם היא רוצה לשמוע על הטיול לאלבניה בספטמבר"
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>מוצר מקושר (אופציונלי)</Label>
              <Select value={offerId} onValueChange={(v) => { setOfferId(v); setPreview(""); }}>
                <SelectTrigger><SelectValue placeholder="ללא מוצר" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OFFER}>ללא מוצר</SelectItem>
                  {(offers ?? []).map((o: any) => (
                    <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">מוצגים רק מוצרים פעילים שטרם פגו.</div>
            </div>

            <div className="space-y-1.5">
              <Label>מועד</Label>
              <div className="flex gap-2">
                <Button type="button" variant={when === "now" ? "default" : "outline"} size="sm" onClick={() => setWhen("now")}>
                  עכשיו
                </Button>
                <Button type="button" variant={when === "later" ? "default" : "outline"} size="sm" onClick={() => setWhen("later")}>
                  מועד עתידי
                </Button>
              </div>
              {when === "later" && (
                <Input
                  type="datetime-local"
                  value={scheduleLocal}
                  onChange={(e) => setScheduleLocal(e.target.value)}
                  className="mt-2"
                />
              )}
              <div className="text-xs text-muted-foreground">שעון ישראל.</div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>תצוגה מקדימה</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={!instructionValid || runPreview.isPending}
                  onClick={() => runPreview.mutate()}
                >
                  <RefreshCw className="h-3 w-3" /> {runPreview.isPending ? "מכינה..." : preview ? "רענון" : "צור תצוגה מקדימה"}
                </Button>
              </div>
              {gateError && <div className="rounded-md border border-destructive/50 p-2.5 text-destructive">{gateError}</div>}
              {preview && (
                <Textarea rows={4} value={preview} onChange={(e) => setPreview(e.target.value)} />
              )}
              <div className="text-xs text-muted-foreground">
                אפשר לערוך את ההוראה ולרענן. ההודעה נשארת מבוססת עובדות בלבד.
              </div>
            </div>

            {blockers.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs space-y-1">
                <div className="font-medium">כדי להפעיל את תמר צריך להשלים:</div>
                <ul className="list-disc pr-4 space-y-0.5 text-muted-foreground">
                  {blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {confirming ? (
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={start.isPending}>חזרה</Button>
              <Button onClick={() => start.mutate()} disabled={start.isPending}>
                {start.isPending ? "מפעילה..." : when === "now" ? "אשר ושלח" : "אשר ותזמן"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => close(false)}>ביטול</Button>
              <Button
                disabled={blockers.length > 0}
                onClick={() => setConfirming(true)}
              >
                אשר והפעל את תמר
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}