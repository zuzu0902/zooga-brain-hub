/** Explicit manager action: record contact, outcome and summary in Core. No messages are sent; Core decides release. */
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { coreApi, CoreApiError } from "@/lib/hostinger-core/client";
import { RESOLVE_OUTCOMES, RESOLVE_OUTCOME_LABELS, resolveBlockers } from "@/lib/hostinger-core/intake-definitions";

export function resolveErrorText(e: unknown): string {
  if (e instanceof CoreApiError) {
    if (e.status === 422) return `Core דחה את התיעוד (${e.code}) — בדקו את השדות`;
    if (e.status === 401 || e.status === 403) return "אין הרשאה לסגור את הפנייה";
    if (e.status === 404) return "הפנייה לא נמצאה ב-Core";
    if (e.status === 409) return "הפנייה כבר טופלה או נמצאת במצב שאינו מאפשר סגירה";
  }
  return "לא ניתן לשמור את התיעוד כרגע. נסו שוב.";
}

export function HandoffResolveDialog({ handoffId, contactId, onClose }: { handoffId: string | null; contactId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [contacted, setContacted] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [summary, setSummary] = useState("");
  const [contactedAt, setContactedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setContacted(false); setOutcome(""); setSummary(""); setContactedAt(""); setError(null); }, [handoffId]);
  const input = { contacted, outcome, summary, contacted_at: contactedAt || null };
  const blockers = resolveBlockers(input);

  async function submit() {
    if (!handoffId) return;
    setBusy(true); setError(null);
    try {
      const r = await coreApi.resolveHandoff(handoffId, input);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["core-contact", contactId] }),
        qc.invalidateQueries({ queryKey: ["core-contact-workflow", contactId] }),
        qc.invalidateQueries({ queryKey: ["core-control-center"] }),
        qc.invalidateQueries({ queryKey: ["core-contacts"] }),
      ]);
      toast.success(r.duplicate ? "הטיפול כבר תועד — לא בוצע שינוי" : r.released ? "הטיפול תועד והשיחה הוחזרה לתמר" : "הטיפול תועד; השיחה עדיין אצל מנהל");
      onClose();
    } catch (e) { setError(resolveErrorText(e)); }
    finally { setBusy(false); }
  }

  return <Dialog open={!!handoffId} onOpenChange={(v) => !v && !busy && onClose()}>
    <DialogContent dir="rtl">
      <DialogHeader>
        <DialogTitle>תיעוד טיפול מנהל</DialogTitle>
        <DialogDescription>התיעוד נשמר ב-Core. לא נשלחת הודעה ללקוח. תמר ממשיכה מהשיחה המלאה ומהסיכום שלך.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="flex items-center gap-2"><Checkbox id="hr-contacted" checked={contacted} onCheckedChange={v => setContacted(v === true)} /><Label htmlFor="hr-contacted">אני מאשר/ת שיצרתי קשר עם הלקוח</Label></div>
        <div className="space-y-1"><Label htmlFor="hr-at">מועד יצירת הקשר (אופציונלי)</Label><Input id="hr-at" type="datetime-local" value={contactedAt} onChange={e => setContactedAt(e.target.value)} /></div>
        <div className="space-y-1"><Label>תוצאת הטיפול</Label><Select value={outcome} onValueChange={setOutcome}><SelectTrigger aria-label="תוצאת הטיפול"><SelectValue placeholder="בחר/י תוצאה" /></SelectTrigger><SelectContent>{RESOLVE_OUTCOMES.map(o => <SelectItem key={o} value={o}>{RESOLVE_OUTCOME_LABELS[o]}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="hr-summary">סיכום מנהל (10–2000 תווים)</Label><Textarea id="hr-summary" rows={4} maxLength={2000} value={summary} onChange={e => setSummary(e.target.value)} placeholder="מה סוכם עם הלקוח, מה נותר פתוח, ומה תמר צריכה לדעת" /></div>
        {blockers.length > 0 && <ul className="text-xs text-muted-foreground space-y-0.5">{blockers.map(b => <li key={b}>{b}</li>)}</ul>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>ביטול</Button>
        <Button disabled={busy || blockers.length > 0} onClick={submit}>{busy ? "שומר…" : "שמור תיעוד"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
