import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Rocket } from "lucide-react";
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

const DEFAULT_TEMPLATE = "tamar_intro";

export function QuickCampaign() {
  const [text, setText] = useState("");
  const [template, setTemplate] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const templatesFn = useServerFn(listTemplates);
  const triggerFn = useServerFn(triggerGatewayCampaign);
  const recentFn = useServerFn(listRecentDispatches);

  const parsed = useMemo(() => parseBulk(text), [text]);

  const { data: tpl } = useQuery({
    queryKey: ["wa-templates"],
    queryFn: async () => (await templatesFn({} as any)) as any,
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

  const { data: recent, refetch, isLoading } = useQuery({
    queryKey: ["gateway-dispatches"],
    queryFn: async () => (await recentFn({} as any)) as any[],
    refetchInterval: 15000,
  });

  const tooMany = parsed.valid.length > 500;

  async function launch() {
    setBusy(true);
    try {
      const res: any = await triggerFn({ data: { template_name: template, contacts: parsed.valid } });
      if (!res?.ok) { toast.error("השיגור נכשל: " + (res?.error ?? "שגיאה לא ידועה")); return; }
      toast.success(`התקבל בשער — ${res.count} אנשי קשר, 5 שניות בין הודעה להודעה`);
      setText("");
      refetch();
    } catch (e: any) {
      toast.error("השיגור נכשל: " + (e?.message ?? ""));
    } finally {
      setBusy(false);
      setConfirm(false);
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
          <Label>תבנית מאושרת</Label>
          <Select value={template} onValueChange={setTemplate}>
            <SelectTrigger><SelectValue placeholder="בחר תבנית" /></SelectTrigger>
            <SelectContent>
              {approved.map((t) => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}
              {approved.length === 0 && <SelectItem value="__none" disabled>לא נמצאו תבניות מאושרות</SelectItem>}
            </SelectContent>
          </Select>
          {missingDefault && <p className="text-xs text-destructive">התבנית tamar_intro לא נמצאה — נבחרה תבנית חלופית</p>}
        </div>
        <Button
          size="lg"
          disabled={busy || !template || parsed.valid.length === 0 || tooMany}
          onClick={() => setConfirm(true)}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          שגר קמפיין
        </Button>
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
