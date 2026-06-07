import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { analyzeOfferIntelligence } from "@/lib/offer-intelligence.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tag, ChevronRight, Pencil, Trash2, Megaphone, Plus, Users, Trophy, Activity, Sparkles, RefreshCw, AlertTriangle } from "lucide-react";
import { CATEGORY_LABELS, INTEREST_LABELS, ALL_INTERESTS, SPENDING_LABELS, formatRelative } from "@/lib/i18n";
import { ContextBanner } from "@/components/context-banner";
import { CURRENCIES, formatPrice } from "@/lib/currency";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/offers/$id")({
  head: () => ({ meta: [{ title: "פרופיל הצעה — Zooga CRM" }] }),
  component: OfferDetailPage,
});

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  draft: "bg-muted text-muted-foreground border-border",
  archived: "bg-muted text-muted-foreground/60 border-border",
};

const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "טיוטה", active: "פעיל", paused: "מושהה", completed: "הסתיים", archived: "ארכיון",
};

function Field({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return null;
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-sm">{Array.isArray(value) ? value.join(", ") : String(value)}</div>
    </div>
  );
}

function OfferDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const { data: offer, isLoading, refetch } = useQuery({
    queryKey: ["offer", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("offers").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: campaigns } = useQuery({
    queryKey: ["offer-campaigns", id],
    queryFn: async () => {
      const { data } = await supabase.from("campaigns").select("id,name,status,source_platform,updated_at").eq("offer_id", id).order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: campaignStats } = useQuery({
    queryKey: ["offer-campaign-stats", id, campaigns?.map((c: any) => c.id).join(",")],
    enabled: !!campaigns?.length,
    queryFn: async () => {
      const ids = (campaigns || []).map((c: any) => c.id);
      if (!ids.length) return {};
      const { data } = await supabase.from("campaign_contacts").select("campaign_id, conversion_stage").in("campaign_id", ids);
      const byCamp: Record<string, { leads: number; converted: number }> = {};
      (data || []).forEach((r: any) => {
        if (!byCamp[r.campaign_id]) byCamp[r.campaign_id] = { leads: 0, converted: 0 };
        byCamp[r.campaign_id].leads++;
        if (r.conversion_stage === "converted") byCamp[r.campaign_id].converted++;
      });
      return byCamp;
    },
  });

  if (isLoading) return <div className="p-10 text-center text-muted-foreground" dir="rtl">טוען...</div>;
  if (!offer) return (
    <div className="p-10 text-center" dir="rtl">
      <p className="text-muted-foreground mb-4">הצעה לא נמצאה</p>
      <Link to="/offers"><Button variant="outline">חזרה</Button></Link>
    </div>
  );

  async function remove() {
    if (!confirm("למחוק את ההצעה? קמפיינים מקושרים יישארו ללא הצעה.")) return;
    const { error } = await supabase.from("offers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("נמחק");
    navigate({ to: "/offers" });
  }

  const totalLeads = Object.values(campaignStats || {}).reduce((s, v: any) => s + v.leads, 0);
  const totalConverted = Object.values(campaignStats || {}).reduce((s, v: any) => s + v.converted, 0);

  if (editing) {
    return (
      <div className="p-6 max-w-3xl" dir="rtl">
        <h1 className="text-3xl font-bold mb-4">עריכת הצעה</h1>
        <OfferEditForm offer={offer} onSaved={() => { setEditing(false); refetch(); }} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-3 max-w-6xl" dir="rtl">
      <nav className="text-sm text-muted-foreground flex items-center gap-1 mb-2">
        <Link to="/offers" className="hover:text-foreground">הצעות</Link>
        <ChevronRight className="h-3 w-3 rotate-180" />
        <span className="text-foreground truncate">{offer.title}</span>
      </nav>

      <ContextBanner id="offer-detail">
        <strong>הצעה</strong> = המוצר/השירות שאתה מוכר. כדי להביא אנשים אליה — צרף אותה ל<strong>קמפיין</strong> שיווקי.
      </ContextBanner>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-14 w-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Tag className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{offer.title}</h1>
                <Badge variant="outline" className={STATUS_TONE[offer.status]}>{offer.status}</Badge>
                {offer.category && <Badge variant="secondary">{CATEGORY_LABELS[offer.category] || offer.category}</Badge>}
                {offer.price && <Badge>{formatPrice(offer.price, offer.currency)}</Badge>}
              </div>
              {offer.description && <p className="text-muted-foreground mt-2">{offer.description}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-1" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> ערוך</Button>
            <Button variant="outline" className="gap-1 text-destructive" onClick={remove}><Trash2 className="h-4 w-4" /> מחק</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Megaphone className="h-4 w-4" /></div>
          <div><div className="text-xs text-muted-foreground">קמפיינים</div><div className="text-xl font-bold">{campaigns?.length || 0}</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-500/10 text-blue-700 flex items-center justify-center"><Users className="h-4 w-4" /></div>
          <div><div className="text-xs text-muted-foreground">לידים שהובאו</div><div className="text-xl font-bold">{totalLeads}</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-amber-500/10 text-amber-700 flex items-center justify-center"><Trophy className="h-4 w-4" /></div>
          <div><div className="text-xs text-muted-foreground">המרות</div><div className="text-xl font-bold">{totalConverted}</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-emerald-500/10 text-emerald-700 flex items-center justify-center"><Activity className="h-4 w-4" /></div>
          <div><div className="text-xs text-muted-foreground">% המרה</div><div className="text-xl font-bold">{totalLeads ? Math.round((totalConverted / totalLeads) * 100) : 0}%</div></div>
        </Card>
      </div>

      <Card className="p-5 grid sm:grid-cols-2 gap-4">
        <Field label="אזור יעד" value={offer.target_region} />
        <Field label="גילאי יעד" value={(offer.target_min_age || offer.target_max_age) ? `${offer.target_min_age || "—"}-${offer.target_max_age || "—"}` : null} />
        <Field label="פרופיל הוצאה" value={offer.target_spending_profile ? (SPENDING_LABELS[offer.target_spending_profile] || offer.target_spending_profile) : null} />
        <Field label="קישור" value={offer.offer_url} />
        {offer.target_interests?.length > 0 && (
          <div className="sm:col-span-2">
            <div className="text-xs text-muted-foreground mb-1">תחומי עניין יעד</div>
            <div className="flex flex-wrap gap-1.5">
              {offer.target_interests.map((i: string) => <Badge key={i} variant="secondary">{INTEREST_LABELS[i] || i}</Badge>)}
            </div>
          </div>
        )}
      </Card>

      <OfferIntelligencePanel offer={offer} onRefreshed={refetch} />

      <div className="flex items-center justify-between pt-4">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Megaphone className="h-4 w-4 text-primary" /> קמפיינים שמקדמים את ההצעה</h2>
        <Link to="/campaigns/new" search={{ offer_id: id }}>
          <Button size="sm" variant="outline" className="gap-1"><Plus className="h-4 w-4" /> צור קמפיין להצעה</Button>
        </Link>
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-3 font-medium">שם הקמפיין</th>
                <th className="p-3 font-medium">סטטוס</th>
                <th className="p-3 font-medium">פלטפורמה</th>
                <th className="p-3 font-medium">לידים</th>
                <th className="p-3 font-medium">המרות</th>
                <th className="p-3 font-medium">עודכן</th>
              </tr>
            </thead>
            <tbody>
              {(!campaigns || campaigns.length === 0) && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                  אין קמפיינים מקושרים. <Link to="/campaigns/new" search={{ offer_id: id }} className="text-primary hover:underline">צור עכשיו</Link>
                </td></tr>
              )}
              {campaigns?.map((c: any) => {
                const s = (campaignStats as any)?.[c.id] || { leads: 0, converted: 0 };
                return (
                  <tr key={c.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <Link to="/campaigns/$id" params={{ id: c.id }} className="font-medium hover:text-primary">{c.name}</Link>
                    </td>
                    <td className="p-3"><Badge variant="outline">{CAMPAIGN_STATUS_LABELS[c.status] || c.status}</Badge></td>
                    <td className="p-3 text-muted-foreground">{c.source_platform || "—"}</td>
                    <td className="p-3">{s.leads}</td>
                    <td className="p-3">{s.converted}</td>
                    <td className="p-3 text-muted-foreground text-xs">{formatRelative(c.updated_at)}</td>
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

function OfferEditForm({ offer, onSaved, onCancel }: any) {
  const [s, setS] = useState<any>({ ...offer, price: offer.price ?? "", currency: offer.currency ?? "ILS" });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!s.title?.trim()) { toast.error("שם חובה"); return; }
    setSaving(true);
    const { error } = await supabase.from("offers").update({
      title: s.title, description: s.description || null, category: s.category, status: s.status,
      price: s.price ? Number(s.price) : null, offer_url: s.offer_url || null,
      currency: s.currency || "ILS",
      target_region: s.target_region || null, target_interests: s.target_interests || [],
      target_spending_profile: s.target_spending_profile || null,
      target_min_age: s.target_min_age ? Number(s.target_min_age) : null,
      target_max_age: s.target_max_age ? Number(s.target_max_age) : null,
    }).eq("id", offer.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("נשמר");
    onSaved();
  }

  return (
    <Card className="p-6 space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><Label>שם *</Label><Input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label>תיאור</Label><Textarea rows={3} value={s.description || ""} onChange={(e) => setS({ ...s, description: e.target.value })} /></div>
        <div>
          <Label>קטגוריה</Label>
          <Select value={s.category} onValueChange={(v) => setS({ ...s, category: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>סטטוס</Label>
          <Select value={s.status} onValueChange={(v) => setS({ ...s, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">טיוטה</SelectItem>
              <SelectItem value="active">פעיל</SelectItem>
              <SelectItem value="archived">ארכיון</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>מחיר</Label>
          <div className="flex gap-2">
            <Input type="number" className="flex-1" value={s.price} onChange={(e) => setS({ ...s, price: e.target.value })} />
            <Select value={s.currency} onValueChange={(v) => setS({ ...s, currency: v })}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.symbol} {c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div><Label>אזור יעד</Label><Input value={s.target_region || ""} onChange={(e) => setS({ ...s, target_region: e.target.value })} /></div>
        <div><Label>גיל מינ׳</Label><Input type="number" value={s.target_min_age ?? ""} onChange={(e) => setS({ ...s, target_min_age: e.target.value })} /></div>
        <div><Label>גיל מקס׳</Label><Input type="number" value={s.target_max_age ?? ""} onChange={(e) => setS({ ...s, target_max_age: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label>קישור</Label><Input dir="ltr" value={s.offer_url || ""} onChange={(e) => setS({ ...s, offer_url: e.target.value })} /></div>
        <div className="sm:col-span-2">
          <Label className="mb-2 block">תחומי עניין יעד</Label>
          <div className="flex flex-wrap gap-2">
            {ALL_INTERESTS.map((k) => {
              const on = (s.target_interests || []).includes(k);
              return (
                <button key={k} type="button"
                  onClick={() => setS({ ...s, target_interests: on ? s.target_interests.filter((x: string) => x !== k) : [...(s.target_interests || []), k] })}
                  className={`px-3 py-1.5 rounded-full text-sm border ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
                  {INTEREST_LABELS[k]}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-3">
        <Button variant="outline" onClick={onCancel}>ביטול</Button>
        <Button onClick={save} disabled={saving}>{saving ? "שומר..." : "שמור"}</Button>
      </div>
    </Card>
  );
}

function OfferIntelligencePanel({ offer, onRefreshed }: { offer: any; onRefreshed: () => void }) {
  const analyzeFn = useServerFn(analyzeOfferIntelligence);
  const [busy, setBusy] = useState(false);

  const status: string = offer.ingestion_status || "idle";
  const isError = status.startsWith("error");
  const isRunning = status === "running" || busy;
  const hasData = !!offer.ai_summary || (offer.faq_bundle?.length ?? 0) > 0;

  async function run() {
    if (!offer.offer_url) {
      toast.error("להצעה אין קישור (offer_url) — הוסיפו URL ונסו שוב.");
      return;
    }
    setBusy(true);
    try {
      await analyzeFn({ data: { offerId: offer.id } });
      toast.success("האינטליגנציה של ההצעה עודכנה");
      onRefreshed();
    } catch (e: any) {
      toast.error(e?.message || "שגיאה בניתוח ההצעה");
      onRefreshed();
    } finally {
      setBusy(false);
    }
  }

  const facts = offer.grounded_facts && typeof offer.grounded_facts === "object" ? offer.grounded_facts : {};
  const faq: any[] = Array.isArray(offer.faq_bundle) ? offer.faq_bundle : [];
  const objections: any[] = Array.isArray(offer.objection_notes) ? offer.objection_notes : [];
  const tags: string[] = Array.isArray(offer.matching_tags) ? offer.matching_tags : [];
  const escalation = offer.escalation_boundary && typeof offer.escalation_boundary === "object" ? offer.escalation_boundary : {};

  return (
    <Card className="p-5 space-y-4 border-primary/30">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Sparkles className="h-4 w-4" /></div>
          <div>
            <h2 className="text-lg font-semibold">אינטליגנציית הצעה (Tamar-ready)</h2>
            <div className="text-xs text-muted-foreground">
              {offer.last_ingested_at ? `נותח לאחרונה: ${formatRelative(offer.last_ingested_at)}` : "טרם נותח"}
              {" · "}סטטוס: <span className={isError ? "text-destructive" : ""}>{status}</span>
            </div>
          </div>
        </div>
        <Button onClick={run} disabled={isRunning} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isRunning ? "animate-spin" : ""}`} />
          {hasData ? "רענון אינטליגנציה" : "ניתוח הצעה"}
        </Button>
      </div>

      {isError && (
        <div className="flex items-start gap-2 text-sm bg-destructive/10 text-destructive p-3 rounded-lg">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>{status}</div>
        </div>
      )}

      {!hasData && !isError && (
        <div className="text-sm text-muted-foreground bg-muted/50 p-4 rounded-lg">
          עדיין אין אינטליגנציה להצעה. לחצו "ניתוח הצעה" — נמשוך את עמוד המקור, ננתח אותו ב-AI ונבנה תקציר מוצק, FAQ, התנגדויות וגבולות הסלמה לתמר.
        </div>
      )}

      {hasData && (
        <div className="grid md:grid-cols-2 gap-4">
          <Section title="תקציר AI (Tamar-safe)">
            <p className="text-sm whitespace-pre-wrap">{offer.ai_summary || "—"}</p>
          </Section>

          <Section title="זווית מכירה">
            <p className="text-sm whitespace-pre-wrap">{offer.sales_angle || "—"}</p>
          </Section>

          <Section title="עובדות מוצקות (Grounded Facts)">
            {Object.keys(facts).length === 0 ? <Empty /> : (
              <dl className="text-sm space-y-1">
                {Object.entries(facts).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-muted-foreground min-w-[120px]">{k}</dt>
                    <dd className="font-medium break-words">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <Section title="תגיות התאמה">
            {tags.length === 0 ? <Empty /> : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
              </div>
            )}
          </Section>

          <Section title="שאלות נפוצות (FAQ)">
            {faq.length === 0 ? <Empty /> : (
              <ul className="space-y-2 text-sm">
                {faq.map((f, i) => (
                  <li key={i}>
                    <div className="font-medium">{f.q || f.question}</div>
                    <div className="text-muted-foreground">{f.a || f.answer}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="התנגדויות ומענה">
            {objections.length === 0 ? <Empty /> : (
              <ul className="space-y-2 text-sm">
                {objections.map((o, i) => (
                  <li key={i}>
                    <div className="font-medium">{o.objection}</div>
                    <div className="text-muted-foreground">{o.response}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="גבולות הסלמה (מה תמר עונה / מתי להעביר לאדם)" className="md:col-span-2">
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs font-medium text-emerald-700 mb-1">תמר יכולה לענות</div>
                <ul className="list-disc pr-4 space-y-0.5">
                  {(escalation.tamar_can_answer || []).map((s: string, i: number) => <li key={i}>{s}</li>)}
                  {!(escalation.tamar_can_answer?.length) && <Empty />}
                </ul>
              </div>
              <div>
                <div className="text-xs font-medium text-amber-700 mb-1">חובה להעביר לאדם</div>
                <ul className="list-disc pr-4 space-y-0.5">
                  {(escalation.must_escalate || []).map((s: string, i: number) => <li key={i}>{s}</li>)}
                  {!(escalation.must_escalate?.length) && <Empty />}
                </ul>
              </div>
            </div>
          </Section>
        </div>
      )}
    </Card>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-muted/30 rounded-lg p-3 ${className || ""}`}>
      <div className="text-xs font-medium text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  );
}

function Empty() {
  return <span className="text-xs text-muted-foreground">—</span>;
}
