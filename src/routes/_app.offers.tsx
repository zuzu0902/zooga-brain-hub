import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { analyzeOfferIntelligence } from "@/lib/offer-intelligence.functions";
import { validateOfferUrl } from "@/lib/offer-pricing-block";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CATEGORY_LABELS, INTEREST_LABELS } from "@/lib/i18n";
import { ContextBanner } from "@/components/context-banner";
import { formatPrice } from "@/lib/currency";
import { useT, useLanguage } from "@/lib/language-context";
import { offerBucket, validateOfferDates, type OfferBucket } from "@/lib/offer-sellable";

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
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<OfferBucket>("active");
  const { data: offers } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => {
      const { data } = await supabase.from("offers").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Bucketing is computed from event_end_date vs now — it does NOT depend on
  // anyone opening this screen. The DB view `offers_sellable` applies the same
  // rule to every customer-facing path.
  const buckets = {
    active: [] as any[],
    needs_date_review: [] as any[],
    past: [] as any[],
  };
  for (const o of offers ?? []) buckets[offerBucket(o as any)].push(o);
  const shown = buckets[tab];

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("הצעות")}</h1>
          <p className="text-muted-foreground mt-1">{t("אירועים, טיולים, מסיבות, סדנאות ועוד")}</p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2"><Plus className="h-4 w-4" />{t("הצעה חדשה")}</Button>
      </header>
      <ContextBanner id="offers-list">
        <strong>{t("הצעות")}</strong> = מה שאת מוכרת (טיול, סדנה, מסיבה). כל הצעה תוכל להיות מקודמת ב<strong>קמפיין</strong> אחד או יותר.
      </ContextBanner>

      <Tabs value={tab} onValueChange={(v) => setTab(v as OfferBucket)}>
        <TabsList>
          <TabsTrigger value="active">{t("פעילים")} ({buckets.active.length})</TabsTrigger>
          <TabsTrigger value="needs_date_review">{t("דורשים השלמת תאריך")} ({buckets.needs_date_review.length})</TabsTrigger>
          <TabsTrigger value="past">{t("אירועי עבר")} ({buckets.past.length})</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
      {tab === "needs_date_review" && (
        <p className="text-sm text-muted-foreground mb-3">
          {t("להצעות האלו חסר תאריך התחלה או סיום. הן אינן נשלחות ללקוחות ואינן מוזרקות לתמר עד להשלמה ידנית — המערכת לא מנחשת תאריכים.")}
        </p>
      )}
      {tab === "past" && (
        <p className="text-sm text-muted-foreground mb-3">
          {t("אירועים שתאריך הסיום שלהם עבר. הרשומות נשמרות להיסטוריה, ניתן לצפות ולערוך, וניתן להחזיר לפעיל רק עם תאריכים עתידיים תקינים.")}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {shown.map((o: any) => (
          <Card key={o.id} className="p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Badge variant="outline">{t(CATEGORY_LABELS[o.category] ?? o.category)}</Badge>
                <Link to="/offers/$id" params={{ id: o.id }}>
                  <h3 className="font-semibold mt-2 hover:text-primary cursor-pointer">{o.title}</h3>
                </Link>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge>{t(o.status)}</Badge>
                {o.needs_date_review && (
                  <Badge variant="outline" className="text-amber-700 border-amber-500/40 bg-amber-500/10">
                    {t("חסר תאריך")}
                  </Badge>
                )}
                {o.event_end_date && new Date(o.event_end_date) < new Date() && (
                  <Badge variant="outline" className="text-amber-700 border-amber-500/40 bg-amber-500/10">
                    {t("תאריך עבר")}
                  </Badge>
                )}
              </div>
            </div>
            {o.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{o.description}</p>}
            <div className="text-xs text-muted-foreground mt-2" dir="ltr">
              {o.event_date ? new Date(o.event_date).toLocaleDateString("he-IL") : "—"}
              {" → "}
              {o.event_end_date ? new Date(o.event_end_date).toLocaleDateString("he-IL") : "—"}
            </div>
            <div className="flex gap-2 flex-wrap mt-3">
              {(o.target_interests || []).map((i: string) => (
                <Badge key={i} variant="secondary">{t(INTEREST_LABELS[i] ?? i)}</Badge>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4 gap-2">
              <div className="text-sm text-muted-foreground">{formatPrice(o.price, o.currency)}</div>
              <div className="flex gap-1">
                <Button asChild size="sm" variant="ghost">
                  <Link to="/offers/$id" params={{ id: o.id }}>{t("פתח")}</Link>
                </Button>
                {tab === "active" && (
                  <Button asChild size="sm" variant="outline">
                    <Link to="/send-offer" search={{ offerId: o.id } as any}>{t("שלח")}</Link>
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
        {shown.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground col-span-full">{t("אין הצעות. צור הצעה חדשה.")}</Card>
        )}
      </div>
        </TabsContent>
      </Tabs>

      <OfferDialog open={open} onOpenChange={setOpen} onCreated={() => qc.invalidateQueries({ queryKey: ["offers"] })} />
    </div>
  );
}

function OfferDialog({ open, onOpenChange, onCreated }: any) {
  const t = useT();
  const { dir } = useLanguage();
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
    if (!cleanUrl) { toast.error(t("נדרש קישור לעמוד האירוע")); return; }
    try { new URL(cleanUrl); } catch { toast.error(t("קישור לא תקין")); return; }
    const urlGate = validateOfferUrl(cleanUrl);
    if (urlGate) { toast.error(urlGate); return; }

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
      toast.error(error?.message || t("שגיאה ביצירת ההצעה"));
      return;
    }

    setBusy("analyzing");
    try {
      await analyzeFn({ data: { offerId: created.id } });
      toast.success(t("ההצעה נוצרה ונלמדה — זמינה כעת לתמר"));
    } catch (e: any) {
      // The offer exists; analysis can be retried from the detail page.
      toast.warning(e?.message || t("ההצעה נוצרה אך הניתוח האוטומטי נכשל — אפשר לנסות שוב מתוך ההצעה"));
    }
    setBusy("idle");
    onOpenChange(false);
    reset();
    onCreated?.();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent dir={dir} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("הצעה חדשה")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("מדביקים קישור לעמוד האירוע — המערכת תלמד ממנו אוטומטית את הכותרת, המחיר, התאריך, שאלות נפוצות והתנגדויות, ותתחיל להציע אותו ללקוחות.")}
        </p>
        <div className="space-y-3">
          <div>
            <Label>{t("קישור לעמוד *")}</Label>
            <Input dir="ltr" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("כותרת (לא חובה)")}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("תילמד מהדף אם ריק")} />
            </div>
            <div>
              <Label>{t("קטגוריה")}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{t(v as string)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("כל יתר השדות (מחיר, תאריך, FAQ, סיכום, התנגדויות, תגיות) ימולאו אוטומטית. אפשר לערוך אחר כך בעמוד ההצעה. אם תאריך האירוע חולף — ההצעה תיפול אוטומטית מתוך הקטלוג של תמר.")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy !== "idle"} onClick={() => onOpenChange(false)}>{t("ביטול")}</Button>
          <Button onClick={addAndAnalyze} disabled={busy !== "idle"} className="gap-2">
            {busy === "idle" && <Sparkles className="h-4 w-4" />}
            {busy !== "idle" && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy === "creating" ? t("יוצר...") : busy === "analyzing" ? t("לומד את האירוע...") : t("הוסף ונתח")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}