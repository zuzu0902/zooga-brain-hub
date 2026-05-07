import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDate, SOURCE_LABELS } from "@/lib/i18n";

export const Route = createFileRoute("/_app/inbox")({
  head: () => ({ meta: [{ title: "תיבת קליטה — Zooga CRM" }] }),
  component: InboxPage,
});

function InboxPage() {
  const qc = useQueryClient();
  const { data: items, isLoading } = useQuery({
    queryKey: ["intake"],
    queryFn: async () => {
      const { data } = await supabase
        .from("intake_inbox")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  async function approve(item: any) {
    // Try to detect duplicate first
    let existing: any = null;
    if (item.parsed_phone) {
      const { data } = await supabase.from("contacts").select("id").eq("phone", item.parsed_phone).maybeSingle();
      existing = data;
    }
    if (!existing && item.parsed_facebook_id) {
      const { data } = await supabase.from("contacts").select("id").eq("facebook_id", item.parsed_facebook_id).maybeSingle();
      existing = data;
    }
    if (!existing && item.parsed_email) {
      const { data } = await supabase.from("contacts").select("id").eq("email", item.parsed_email).maybeSingle();
      existing = data;
    }

    if (existing) {
      await supabase.from("interactions").insert({
        contact_id: existing.id,
        type: "facebook_message",
        source: String(item.source),
        content: item.parsed_message || "",
      });
      await supabase.from("intake_inbox").update({
        status: "merged", matched_contact_id: existing.id, processed_at: new Date().toISOString(),
      }).eq("id", item.id);
      toast.success("מוזג עם איש קשר קיים");
    } else {
      const nameParts = (item.parsed_name || "").split(" ");
      const { data: contact, error } = await supabase.from("contacts").insert({
        first_name: nameParts[0] || null,
        last_name: nameParts.slice(1).join(" ") || null,
        phone: item.parsed_phone,
        email: item.parsed_email,
        facebook_id: item.parsed_facebook_id,
        source: item.source,
        status: "new_lead",
      }).select("id").single();
      if (error) { toast.error("שגיאה: " + error.message); return; }
      if (item.parsed_message) {
        await supabase.from("interactions").insert({
          contact_id: contact!.id,
          type: "facebook_message",
          source: String(item.source),
          content: item.parsed_message,
        });
      }
      await supabase.from("intake_inbox").update({
        status: "approved", matched_contact_id: contact!.id, processed_at: new Date().toISOString(),
      }).eq("id", item.id);
      toast.success("איש הקשר נוצר");
    }
    qc.invalidateQueries({ queryKey: ["intake"] });
  }

  async function reject(item: any) {
    await supabase.from("intake_inbox").update({ status: "rejected", processed_at: new Date().toISOString() }).eq("id", item.id);
    qc.invalidateQueries({ queryKey: ["intake"] });
  }

  return (
    <div className="p-6 space-y-5">
      <header>
        <h1 className="text-3xl font-bold">תיבת קליטה</h1>
        <p className="text-muted-foreground mt-1">לידים נכנסים מבוט תמר וערוצי פייסבוק</p>
      </header>

      {isLoading ? <div className="text-muted-foreground">טוען...</div> : (
        <div className="space-y-3">
          {items?.length === 0 && (
            <Card className="p-8 text-center text-muted-foreground">
              אין פריטים בתיבת הקליטה. כשהוובהוק יקבל ליד חדש, הוא יופיע כאן.
            </Card>
          )}
          {items?.map((it: any) => (
            <Card key={it.id} className="p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{it.parsed_name || "ללא שם"}</span>
                    <Badge variant="outline">{SOURCE_LABELS[it.source] || it.source}</Badge>
                    <Badge variant={it.status === "pending" ? "default" : "secondary"}>{it.status}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(it.created_at)}</span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 flex gap-3 flex-wrap" dir="ltr">
                    {it.parsed_phone && <span>📱 {it.parsed_phone}</span>}
                    {it.parsed_email && <span>✉️ {it.parsed_email}</span>}
                    {it.parsed_facebook_id && <span>FB: {it.parsed_facebook_id}</span>}
                  </div>
                  {it.parsed_message && (
                    <div className="mt-2 p-3 rounded-lg bg-muted/50 text-sm">{it.parsed_message}</div>
                  )}
                </div>
                {it.status === "pending" && (
                  <div className="flex gap-2">
                    <Button onClick={() => approve(it)}>אישור</Button>
                    <Button variant="outline" onClick={() => reject(it)}>דחה</Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}