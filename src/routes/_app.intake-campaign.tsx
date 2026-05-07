import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { sendIntakeCampaign } from "@/lib/intake-campaign.functions";

export const Route = createFileRoute("/_app/intake-campaign")({
  head: () => ({ meta: [{ title: "קמפיין אינטייק — Zooga CRM" }] }),
  component: IntakeCampaignPage,
});

const TEMPLATES = [
  { value: "zooga_intro_intake", label: "zooga_intro_intake — היכרות והזמנה" },
  { value: "zooga_followup", label: "zooga_followup — תזכורת" },
];

const PREVIEWS: Record<string, string> = {
  zooga_intro_intake:
    "שלום {{full_name}}, כאן תמר מ-Zooga 👋\nשמחה להכיר! נשמח לשמוע מעט עליך כדי להתאים את הקהילה.",
  zooga_followup:
    "היי {{full_name}}, רק תזכורת קטנה — נשמח לשמוע ממך כשנוח 🙂",
};

function IntakeCampaignPage() {
  const [campaignName, setCampaignName] = useState("Zooga Intake " + new Date().toLocaleDateString("he-IL"));
  const [template, setTemplate] = useState("zooga_intro_intake");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const sendFn = useServerFn(sendIntakeCampaign);

  const { data: leads, refetch, isLoading } = useQuery({
    queryKey: ["ready_leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("imported_leads")
        .select("id, full_name, phone, source_campaign, whatsapp_template_status, import_status, last_message_at")
        .in("import_status", ["ready_for_intake", "sent_to_tamar", "replied", "failed"])
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const readyLeads = leads?.filter((l: any) => l.import_status === "ready_for_intake") ?? [];

  function toggle(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    if (selected.size === readyLeads.length) setSelected(new Set());
    else setSelected(new Set(readyLeads.map((l: any) => l.id)));
  }

  async function send() {
    if (selected.size === 0) {
      toast.error("בחר לפחות ליד אחד");
      return;
    }
    setSending(true);
    try {
      const result = await sendFn({
        data: {
          campaign_name: campaignName,
          template_name: template,
          lead_ids: Array.from(selected),
        },
      });
      if (result.ok) {
        toast.success(`נשלחו ${result.sent_count} לידים לתמר`);
        setSelected(new Set());
        refetch();
      } else {
        toast.error("שגיאה: " + (result.error || "לא ידוע"));
      }
    } catch (e: any) {
      toast.error("שגיאת רשת: " + (e?.message || String(e)));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <header>
        <h1 className="text-3xl font-bold">קמפיין אינטייק</h1>
        <p className="text-muted-foreground mt-1">
          שליחת לידים מוכנים לבוט תמר לצורך תחילת שיחת אינטייק בוואטסאפ
        </p>
      </header>

      <Card className="p-5 space-y-4 max-w-3xl">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>שם קמפיין</Label>
            <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
          </div>
          <div>
            <Label>תבנית WhatsApp</Label>
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TEMPLATES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>תצוגה מקדימה של ההודעה</Label>
          <Textarea value={PREVIEWS[template] || ""} readOnly rows={4} />
        </div>
        <div className="flex items-center justify-end gap-3">
          <div className="text-sm text-muted-foreground">נבחרו {selected.size} מתוך {readyLeads.length} מוכנים</div>
          <Button onClick={send} disabled={sending || selected.size === 0} className="gap-2">
            <Megaphone className="h-4 w-4" />
            {sending ? "שולח..." : "שלח לתמר"}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-3 w-10">
                  <Checkbox
                    checked={readyLeads.length > 0 && selected.size === readyLeads.length}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th className="p-3 font-medium">שם</th>
                <th className="p-3 font-medium">טלפון</th>
                <th className="p-3 font-medium">סטטוס ייבוא</th>
                <th className="p-3 font-medium">סטטוס וואטסאפ</th>
                <th className="p-3 font-medium">קמפיין מקור</th>
                <th className="p-3 font-medium">הודעה אחרונה</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">טוען...</td></tr>
              )}
              {!isLoading && (leads?.length ?? 0) === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">אין לידים להצגה</td></tr>
              )}
              {leads?.map((l: any) => {
                const isReady = l.import_status === "ready_for_intake";
                return (
                  <tr key={l.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <Checkbox
                        disabled={!isReady}
                        checked={selected.has(l.id)}
                        onCheckedChange={() => toggle(l.id)}
                      />
                    </td>
                    <td className="p-3 font-medium">{l.full_name || "—"}</td>
                    <td className="p-3 text-muted-foreground" dir="ltr">{l.phone}</td>
                    <td className="p-3"><Badge variant="secondary">{l.import_status}</Badge></td>
                    <td className="p-3"><Badge variant="outline">{l.whatsapp_template_status}</Badge></td>
                    <td className="p-3 text-muted-foreground">{l.source_campaign || "—"}</td>
                    <td className="p-3 text-muted-foreground text-xs" dir="ltr">
                      {l.last_message_at ? new Date(l.last_message_at).toLocaleString("he-IL") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}