import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { CATEGORY_LABELS, INTEREST_LABELS, ALL_INTERESTS, SPENDING_LABELS } from "@/lib/i18n";
import { ContextBanner } from "@/components/context-banner";

export const Route = createFileRoute("/_app/offers")({
  head: () => ({ meta: [{ title: "הצעות — Zooga CRM" }] }),
  component: OffersRoute,
});

function OffersRoute() {
  const location = useLocation();
  if (location.pathname.startsWith("/offers/")) return <Outlet />;
  return <OffersPage />;
}

function OffersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: offers } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => {
      const { data } = await supabase.from("offers").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">הצעות</h1>
          <p className="text-muted-foreground mt-1">אירועים, טיולים, מסיבות, סדנאות ועוד</p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2"><Plus className="h-4 w-4" />הצעה חדשה</Button>
      </header>
      <ContextBanner id="offers-list">
        <strong>הצעות</strong> = מה שאת מוכרת (טיול, סדנה, מסיבה). כל הצעה תוכל להיות מקודמת ב<strong>קמפיין</strong> אחד או יותר.
      </ContextBanner>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {offers?.map((o: any) => (
          <Card key={o.id} className="p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Badge variant="outline">{CATEGORY_LABELS[o.category]}</Badge>
                <Link to="/offers/$id" params={{ id: o.id }}>
                  <h3 className="font-semibold mt-2 hover:text-primary cursor-pointer">{o.title}</h3>
                </Link>
              </div>
              <Badge>{o.status}</Badge>
            </div>
            {o.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{o.description}</p>}
            <div className="flex gap-2 flex-wrap mt-3">
              {(o.target_interests || []).map((i: string) => (
                <Badge key={i} variant="secondary">{INTEREST_LABELS[i] || i}</Badge>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4 gap-2">
              <div className="text-sm text-muted-foreground">{o.price ? `₪${o.price}` : ""}</div>
              <div className="flex gap-1">
                <Button asChild size="sm" variant="ghost">
                  <Link to="/offers/$id" params={{ id: o.id }}>פתח</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/send-offer" search={{ offerId: o.id } as any}>שלח</Link>
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {offers?.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground col-span-full">אין הצעות. צור הצעה חדשה.</Card>
        )}
      </div>

      <OfferDialog open={open} onOpenChange={setOpen} onCreated={() => qc.invalidateQueries({ queryKey: ["offers"] })} />
    </div>
  );
}

function OfferDialog({ open, onOpenChange, onCreated }: any) {
  const [s, setS] = useState<any>({
    title: "", description: "", category: "event", price: "",
    target_interests: [], target_region: "", status: "active", offer_url: "",
    target_spending_profile: "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!s.title) { toast.error("שם חובה"); return; }
    setSaving(true);
    const { error } = await supabase.from("offers").insert({
      ...s,
      price: s.price ? Number(s.price) : null,
      target_spending_profile: s.target_spending_profile || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("הצעה נוצרה");
    onOpenChange(false);
    onCreated?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>הצעה חדשה</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>שם</Label><Input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></div>
          <div><Label>תיאור</Label><Textarea rows={3} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>קטגוריה</Label>
              <Select value={s.category} onValueChange={(v) => setS({ ...s, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>מחיר ₪</Label><Input type="number" value={s.price} onChange={(e) => setS({ ...s, price: e.target.value })} /></div>
            <div><Label>אזור יעד</Label><Input value={s.target_region} onChange={(e) => setS({ ...s, target_region: e.target.value })} /></div>
            <div>
              <Label>פרופיל הוצאה יעד</Label>
              <Select value={s.target_spending_profile} onValueChange={(v) => setS({ ...s, target_spending_profile: v })}>
                <SelectTrigger><SelectValue placeholder="כל" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SPENDING_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>קישור</Label><Input dir="ltr" value={s.offer_url} onChange={(e) => setS({ ...s, offer_url: e.target.value })} /></div>
          <div>
            <Label className="mb-2 block">תחומי עניין יעד</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_INTERESTS.map((k) => {
                const on = s.target_interests.includes(k);
                return (
                  <button key={k} type="button"
                    onClick={() => setS({ ...s, target_interests: on ? s.target_interests.filter((x: string) => x !== k) : [...s.target_interests, k] })}
                    className={`px-3 py-1.5 rounded-full text-sm border ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
                    {INTEREST_LABELS[k]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={save} disabled={saving}>{saving ? "שומר..." : "צור"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}