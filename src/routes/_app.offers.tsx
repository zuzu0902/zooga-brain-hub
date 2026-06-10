import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { analyzeOfferIntelligence } from "@/lib/offer-intelligence.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CATEGORY_LABELS, INTEREST_LABELS } from "@/lib/i18n";
import { ContextBanner } from "@/components/context-banner";
import { formatPrice } from "@/lib/currency";

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
              <div className="text-sm text-muted-foreground">{formatPrice(o.price, o.currency)}</div>
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
  const analyzeFn = useServerFn(analyzeOfferIntelligence);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("event");
  const [busy, setBusy] = useState<"idle" | "creating" | "analyzing">("idle");

  function reset() {
    setUrl(""); setTitle(""); setCategory("event"); setBusy("idle");
  }

  async function addAndAnalyze() {
    const cleanUrl = url.trim();
    if (!cleanUrl) { toast.error("נדרש קישור לעמוד האירוע"); return; }
    try { new URL(cleanUrl); } catch { toast.error("קישור לא תקין"); return; }

    setBusy("creating");
    const placeholderTitle = title.trim() || cleanUrl;
    const { data: created, error } = await supabase
      .from("offers")
      .insert({
        title: placeholderTitle,
        category: category as any,
        status: "active",
        offer_url: cleanUrl,
        currency: "ILS",
      })
      .select("id")
      .single();
    if (error || !created) {
      setBusy("idle");
      toast.error(error?.message || "שגיאה ביצירת ההצעה");
      return;
    }

    setBusy("analyzing");
    try {
      await analyzeFn({ data: { offerId: created.id } });
      toast.success("ההצעה נוצרה ונלמדה — זמינה כעת לתמר");
    } catch (e: any) {
      // The offer exists; analysis can be retried from the detail page.
      toast.warning(e?.message || "ההצעה נוצרה אך הניתוח האוטומטי נכשל — אפשר לנסות שוב מתוך ההצעה");
    }
    setBusy("idle");
    onOpenChange(false);
    reset();
    onCreated?.();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>הצעה חדשה</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          מדביקים קישור לעמוד האירוע — המערכת תלמד ממנו אוטומטית את הכותרת, המחיר, התאריך,
          שאלות נפוצות והתנגדויות, ותתחיל להציע אותו ללקוחות.
        </p>
        <div className="space-y-3">
          <div>
            <Label>קישור לעמוד *</Label>
            <Input dir="ltr" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>כותרת (לא חובה)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="תילמד מהדף אם ריק" />
            </div>
            <div>
              <Label>קטגוריה</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v as string}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            כל יתר השדות (מחיר, תאריך, FAQ, סיכום, התנגדויות, תגיות) ימולאו אוטומטית.
            אפשר לערוך אחר כך בעמוד ההצעה. אם תאריך האירוע חולף — ההצעה תיפול אוטומטית מתוך
            הקטלוג של תמר.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy !== "idle"} onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={addAndAnalyze} disabled={busy !== "idle"} className="gap-2">
            {busy === "idle" && <Sparkles className="h-4 w-4" />}
            {busy !== "idle" && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy === "creating" ? "יוצר..." : busy === "analyzing" ? "לומד את האירוע..." : "הוסף ונתח"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}