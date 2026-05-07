import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { INTEREST_LABELS, CATEGORY_LABELS } from "@/lib/i18n";
import { z } from "zod";

const search = z.object({ offerId: z.string().optional(), contactId: z.string().optional() });

export const Route = createFileRoute("/_app/send-offer")({
  head: () => ({ meta: [{ title: "שליחת הצעה — Zooga CRM" }] }),
  validateSearch: search,
  component: SendOfferPage,
});

function SendOfferPage() {
  const sp = Route.useSearch();
  const [offerId, setOfferId] = useState<string>(sp.offerId || "");
  const [selected, setSelected] = useState<Set<string>>(new Set(sp.contactId ? [sp.contactId] : []));

  const { data: offers } = useQuery({
    queryKey: ["offers-active"],
    queryFn: async () => {
      const { data } = await supabase.from("offers").select("*").eq("status", "active");
      return data ?? [];
    },
  });

  const offer = offers?.find((o) => o.id === offerId);

  const { data: candidates } = useQuery({
    queryKey: ["candidates", offerId],
    enabled: !!offer,
    queryFn: async () => {
      const { data } = await supabase
        .from("contacts")
        .select("id, full_name, first_name, region, interests, engagement_score, status, consent_marketing, last_interaction_at")
        .eq("consent_marketing", true)
        .neq("status", "inactive")
        .order("engagement_score", { ascending: false })
        .limit(200);
      const all = data ?? [];
      return all
        .map((c: any) => {
          const reasons: string[] = [];
          let score = c.engagement_score || 0;
          const matchedInterests = (offer!.target_interests || []).filter((i: string) =>
            (c.interests || []).includes(i)
          );
          if (matchedInterests.length > 0) {
            reasons.push(`מתעניין ב${matchedInterests.map((i: string) => INTEREST_LABELS[i] || i).join(", ")}`);
            score += matchedInterests.length * 10;
          }
          if (offer!.target_region && c.region === offer!.target_region) {
            reasons.push(`מאזור ${c.region}`);
            score += 15;
          }
          if (c.last_interaction_at) {
            const days = (Date.now() - new Date(c.last_interaction_at).getTime()) / 86400000;
            if (days < 30) { reasons.push("פעיל לאחרונה"); score += 5; }
          }
          return { ...c, reasons, _score: score };
        })
        .filter((c: any) =>
          (offer!.target_interests?.length ?? 0) === 0
            ? true
            : c.reasons.some((r: string) => r.startsWith("מתעניין"))
        )
        .sort((a: any, b: any) => b._score - a._score);
    },
  });

  const draft = useMemo(() => {
    if (!offer) return "";
    return `היי {first_name},\n\nראיתי שזה יכול להתאים לך:\n${offer.title}\n${offer.description || ""}\n\n${offer.offer_url || ""}`;
  }, [offer]);
  const [template, setTemplate] = useState("");
  useEffect(() => setTemplate(draft), [draft]);

  async function send() {
    if (!offer || selected.size === 0) return;
    const rows: any[] = [];
    (candidates || []).forEach((c: any) => {
      if (!selected.has(c.id)) return;
      rows.push({
        contact_id: c.id,
        offer_id: offer.id,
        channel: "Facebook",
        message_text: template.replaceAll("{first_name}", c.first_name || c.full_name || "חבר"),
        status: "draft",
      });
    });
    const { error } = await supabase.from("messages").insert(rows);
    if (error) toast.error(error.message);
    else {
      toast.success(`נוצרו ${rows.length} טיוטות הודעה. מוכן לשליחה דרך בוט תמר.`);
      setSelected(new Set());
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <header>
        <h1 className="text-3xl font-bold">שליחת הצעה</h1>
        <p className="text-muted-foreground mt-1">בחר הצעה, סמן אנשי קשר, צור טיוטות מותאמות</p>
      </header>

      <Card className="p-5">
        <label className="text-sm font-medium">הצעה</label>
        <Select value={offerId} onValueChange={setOfferId}>
          <SelectTrigger><SelectValue placeholder="בחר הצעה פעילה" /></SelectTrigger>
          <SelectContent>
            {offers?.map((o: any) => (
              <SelectItem key={o.id} value={o.id}>{CATEGORY_LABELS[o.category]} · {o.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {offer && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-5 lg:col-span-2 space-y-3">
            <h3 className="font-semibold">אנשי קשר מומלצים ({candidates?.length ?? 0})</h3>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {(candidates ?? []).map((c: any) => (
                <div key={c.id} className="flex items-start gap-3 p-3 rounded-lg border">
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={(v) => {
                      const n = new Set(selected);
                      if (v) n.add(c.id); else n.delete(c.id);
                      setSelected(n);
                    }}
                  />
                  <div className="flex-1">
                    <div className="font-medium">{c.full_name || "ללא שם"}</div>
                    <div className="flex gap-1 flex-wrap mt-1">
                      {c.reasons.map((r: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">{r}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-sm text-primary font-bold">{c.engagement_score}</div>
                </div>
              ))}
              {candidates?.length === 0 && (
                <div className="text-sm text-muted-foreground p-4 text-center">לא נמצאו אנשי קשר מתאימים</div>
              )}
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <h3 className="font-semibold">תבנית הודעה</h3>
            <p className="text-xs text-muted-foreground">השתמש ב-{`{first_name}`} להתאמה אישית</p>
            <Textarea rows={10} value={template} onChange={(e) => setTemplate(e.target.value)} />
            <Button className="w-full" disabled={selected.size === 0} onClick={send}>
              צור {selected.size} טיוטות הודעה
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}