import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RefreshCw, Rocket } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listTemplates } from "@/lib/campaign-send.functions";
import { triggerGatewayCampaign, listRecentDispatches } from "@/lib/gateway-campaign.functions";
import { parseBulk, maskPhone } from "@/lib/phone-bulk";

const DEFAULT_TEMPLATE = "new_members_first_time";
const GATEWAY_ERRORS: Record<string, string> = {
  gateway_unauthorized: "השער דחה את ההרשאה של המערכת",
  gateway_route_not_found: "כתובת הקמפיין לא קיימת בשער",
  gateway_rejected_payload: "השער דחה את נתוני הקמפיין",
  gateway_rate_limited: "השער עמוס — נסה שוב בעוד כמה דקות",
  gateway_timeout: "השער לא ענה בזמן",
  gateway_unreachable: "לא ניתן להתחבר לשער",
  gateway_config_missing: "הגדרות החיבור לשער חסרות",
};

export function QuickCampaign() {
  const [text, setText] = useState("");
  const [template, setTemplate] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const templatesFn = useServerFn(listTemplates);
  const triggerFn = useServerFn(triggerGatewayCampaign);
  const recentFn = useServerFn(listRecentDispatches);

  const parsed = useMemo(() => parseBulk(text), [text]);

  const [syncing, setSyncing] = useState(false);
  const { data: tpl, refetch: refetchTemplates } = useQuery({
    queryKey: ["wa-templates"],
    queryFn: async () => (await templatesFn({ data: {} } as any)) as any,
  });
  const approved: any[] = useMemo(
    () => Array.from(new Map((tpl?.templates ?? []).filter((t: any) => t.status === "APPROVED").map((t: any) => [t.name, t])).values()),
    [tpl],
  );
  useEffect(() => {
    if (template || approved.length === 0) return;
    setTemplate(approved.some((t) => t.name === DEFAULT_TEMPLATE) ? DEFAULT_TEMPLATE : approved[0].name);
  }, [approved, template]);
  const missingDefault = approved.length > 0 && !approved.some((t) => t.name === DEFAULT_TEMPLATE);

  async function syncTemplates() {
    setSyncing(true);
    try {
      const res: any = await templatesFn({ data: { force: true } } as any);
      if (res?.ok === false) {
        toast.error("סנכרון התבניות נכשל — בדוק את החיבור לוואטסאפ עסקי");
        return;
      }
      const count = (res?.templates ?? []).filter((t: any) => t.status === "APPROVED").length;
      toast.success(`סונכרנו ${count} תבניות מאושרות`);
      await refetchTemplates();
    } catch {
      toast.error("סנכרון התבניות נכשל");
    } finally {
      setSyncing(false);
    }
  }

  const { data: recent, refetch, isLoading } = useQuery({
    queryKey: ["gateway-dispatches"],
    queryFn: async () => (await recentFn({} as any)) as any[],
    refetchInterval: 15000,
  });

  const tooMany = parsed.valid.length > 500;
  const [lastError, setLastError] = useState<string | null>(null);

  async function launch() {
    if (busy) return;
    setBusy(true);
    setConfirm(false);
    setLastError(null);
    try {
      const res: any = await triggerFn({ data: { template_name: template, contacts: parsed.valid, confirmed: true } });
      if (!res?.ok) {
        const msg = GATEWAY_ERRORS[res?.error] ?? `שגיאה מהשער (${res?.error ?? "לא ידועה"})`;
        setLastError(msg + (res?.detail ? ` · ${res.detail}` : ""));
        toast.error("השיגור נכשל — לא נשלחה אף הודעה");
        return;
      }
      toast.success(`השער קיבל את הבקשה — ${res.count} אנשי קשר, 5 שניות בין הודעה להודעה`);
      setText("");
      refetch();
    } catch (e: any) {
      setLastError("השיגור נכשל: " + (e?.message ?? "שגיאה לא ידועה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5 space-y-4 max-w-3xl">
        <div className="space-y-2">
          <Label>מספרי טלפון (מספר בכל שורה, אפשר שם אחרי פסיק)</Label>
          <Textarea
            dir="ltr"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"0541234567, דנה\n+972 52-111-2222\n..."}
            className="font-mono text-sm"
          />
          <p className="text-sm text-muted-foreground">
            {parsed.valid.length} תקינים · {parsed.invalid.length} לא תקינים · {parsed.duplicates} כפולים הוסרו
            {tooMany && <span className="text-destructive"> · מקסימום 500 בשיגור</span>}
          </p>
        </div>
        <div className="space-y-2 max-w-sm">
          <div className="flex items-center justify-between gap-2">
            <Label>תבנית מאושרת</Label>
            <Button type="button" variant="ghost" size="sm" disabled={syncing} onClick={syncTemplates}>
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              סנכרן תבניות
            </Button>
          </div>
          <Select value={template} onValueChange={setTemplate}>
            <SelectTrigger><SelectValue placeholder="בחר תבנית" /></SelectTrigger>
            <SelectContent>
              {approved.map((t) => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}
              {approved.length === 0 && <SelectItem value="__none" disabled>לא נמצאו תבניות מאושרות</SelectItem>}
            </SelectContent>
          </Select>
          {missingDefault && <p className="text-xs text-destructive">התבנית {DEFAULT_TEMPLATE} לא נמצאה — נבחרה תבנית חלופית</p>}
        </div>
        <Button
          size="lg"
          disabled={busy || !template || parsed.valid.length === 0 || tooMany}
          onClick={() => setConfirm(true)}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          שגר קמפיין
        </Button>
        {lastError && <p className="text-sm text-destructive">{lastError}</p>}
      </Card>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>לשגר קמפיין?</AlertDialogTitle>
            <AlertDialogDescription>
              {parsed.valid.length} אנשי קשר יקבלו את התבנית "{template}", בהפרש של 5 שניות.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>ביטול</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); launch(); }}>שגר</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">50 השליחות האחרונות</h2>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : !recent?.length ? (
          <p className="text-sm text-muted-foreground">עדיין אין שליחות.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">טלפון</TableHead>
                <TableHead className="text-start">שם</TableHead>
                <TableHead className="text-start">שעת שליחה</TableHead>
                <TableHead className="text-start">תגובה</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell dir="ltr" className="font-mono text-start">{maskPhone(r.phone)}</TableCell>
                  <TableCell>{r.name ?? "—"}</TableCell>
                  <TableCell>{new Date(r.dispatched_at).toLocaleString("he-IL")}</TableCell>
                  <TableCell>
                    {r.replied ? <Badge>הגיב</Badge> : <Badge variant="secondary">עדיין לא</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
