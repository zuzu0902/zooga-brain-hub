import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Filter, X, AlertCircle } from "lucide-react";
import {
  STATUS_LABELS, SOURCE_LABELS, INTEREST_LABELS, ALL_INTERESTS,
  SALES_TEMP_LABELS, SALES_TEMP_TONE, formatRelative,
} from "@/lib/i18n";
import { ContactCreateDialog } from "@/components/contact-create-dialog";

export const Route = createFileRoute("/_app/contacts")({
  head: () => ({ meta: [{ title: "אנשי קשר — Zooga CRM" }] }),
  component: ContactsPage,
});

const STATUS_TONE: Record<string, string> = {
  new_lead: "bg-info/10 text-info border-info/30",
  active_member: "bg-success/15 text-success border-success/30",
  interested: "bg-warning/15 text-warning-foreground border-warning/30",
  customer: "bg-primary/10 text-primary border-primary/30",
  VIP: "bg-gradient-to-l from-amber-400/20 to-amber-200/20 text-amber-800 border-amber-400/40",
  inactive: "bg-muted text-muted-foreground border-border",
};

function ContactsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [region, setRegion] = useState<string>("all");
  const [interest, setInterest] = useState<string>("all");
  const [temperature, setTemperature] = useState<string>("all");
  const [activity, setActivity] = useState<string>("all");
  const [consent, setConsent] = useState<string>("all");
  const [open, setOpen] = useState(false);

  const { data: contacts, isLoading, refetch } = useQuery({
    queryKey: ["contacts-rich"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, full_name, first_name, last_name, phone, email, status, source, region, city, age, age_range, gender, relationship_status, interests, activity_score, engagement_score, sales_temperature, manager_attention_required, consent_marketing, last_interaction_at, interaction_count, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("contacts-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refetch]);

  const regions = useMemo(() => {
    const s = new Set<string>();
    (contacts ?? []).forEach((c: any) => c.region && s.add(c.region));
    return Array.from(s).sort();
  }, [contacts]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (contacts ?? []).filter((c: any) => {
      if (status !== "all" && c.status !== status) return false;
      if (source !== "all" && c.source !== source) return false;
      if (region !== "all" && c.region !== region) return false;
      if (interest !== "all" && !(c.interests || []).includes(interest)) return false;
      if (temperature !== "all" && c.sales_temperature !== temperature) return false;
      if (activity === "low" && (c.activity_score ?? 0) >= 30) return false;
      if (activity === "med" && ((c.activity_score ?? 0) < 30 || (c.activity_score ?? 0) > 70)) return false;
      if (activity === "high" && (c.activity_score ?? 0) < 70) return false;
      if (consent === "yes" && !c.consent_marketing) return false;
      if (consent === "no" && c.consent_marketing) return false;
      if (t) {
        const hay = [
          c.full_name, c.phone, c.email, c.city,
          ...(c.interests || []).map((i: string) => INTEREST_LABELS[i] || i),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [contacts, search, status, source, region, interest, temperature, activity, consent]);

  function clearFilters() {
    setSearch(""); setStatus("all"); setSource("all"); setRegion("all");
    setInterest("all"); setTemperature("all"); setActivity("all"); setConsent("all");
  }

  const filterCount = [status, source, region, interest, temperature, activity, consent]
    .filter((x) => x !== "all").length + (search ? 1 : 0);

  return (
    <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">אנשי קשר</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length.toLocaleString("he-IL")} מתוך {(contacts?.length ?? 0).toLocaleString("he-IL")}
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> הוסף איש קשר
        </Button>
      </header>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="חיפוש לפי שם, טלפון, עיר או תחום עניין"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 bg-background"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            {filterCount > 0 ? `${filterCount} סינונים פעילים` : "ללא סינון"}
            {filterCount > 0 && (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={clearFilters}>
                <X className="h-3.5 w-3.5 ml-1" /> איפוס
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <FilterSelect value={status} onChange={setStatus} placeholder="סטטוס" options={STATUS_LABELS} />
          <FilterSelect value={source} onChange={setSource} placeholder="מקור" options={SOURCE_LABELS} />
          <FilterSelect value={region} onChange={setRegion} placeholder="אזור" options={Object.fromEntries(regions.map((r) => [r, r]))} />
          <FilterSelect value={interest} onChange={setInterest} placeholder="תחום עניין" options={Object.fromEntries(ALL_INTERESTS.map((k) => [k, INTEREST_LABELS[k]]))} />
          <FilterSelect value={temperature} onChange={setTemperature} placeholder="טמפרטורה" options={SALES_TEMP_LABELS} />
          <FilterSelect value={activity} onChange={setActivity} placeholder="פעילות" options={{ low: "נמוכה", med: "בינונית", high: "גבוהה" }} />
          <FilterSelect value={consent} onChange={setConsent} placeholder="הסכמה" options={{ yes: "אישרו", no: "לא אישרו" }} />
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-xs uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
                <th className="px-4 py-3 font-medium">שם</th>
                <th className="px-4 py-3 font-medium">טלפון</th>
                <th className="px-4 py-3 font-medium">מקור</th>
                <th className="px-4 py-3 font-medium">סטטוס</th>
                <th className="px-4 py-3 font-medium">אזור / עיר</th>
                <th className="px-4 py-3 font-medium">גיל / מגדר</th>
                <th className="px-4 py-3 font-medium">סטטוס משפחתי</th>
                <th className="px-4 py-3 font-medium">תחומי עניין</th>
                <th className="px-4 py-3 font-medium">פעילות</th>
                <th className="px-4 py-3 font-medium">טמפ׳</th>
                <th className="px-4 py-3 font-medium">אינטר׳</th>
                <th className="px-4 py-3 font-medium">הסכמה</th>
                <th className="px-4 py-3 font-medium">אחרון</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={13} className="p-10 text-center text-muted-foreground">טוען...</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={13} className="p-10 text-center text-muted-foreground">אין אנשי קשר התואמים לסינון</td></tr>
              )}
              {filtered.map((c: any) => {
                const initials = (c.full_name || c.first_name || "?").trim().slice(0, 1);
                return (
                  <tr
                    key={c.id}
                    onClick={() => navigate({ to: "/contacts/$id", params: { id: c.id } })}
                    className="border-b last:border-b-0 hover:bg-muted/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        to="/contacts/$id"
                        params={{ id: c.id }}
                        preload="intent"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2.5 hover:text-primary"
                      >
                        <div className="h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate flex items-center gap-1.5">
                            {c.full_name || "ללא שם"}
                            {c.manager_attention_required && (
                              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                            )}
                          </div>
                          {c.email && <div className="text-[11px] text-muted-foreground truncate">{c.email}</div>}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap" dir="ltr">{c.phone || "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{SOURCE_LABELS[c.source] || c.source || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_TONE[c.status] || "bg-muted text-muted-foreground border-border"}`}>
                        {STATUS_LABELS[c.status] || c.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {[c.region, c.city].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {c.age || c.age_range || "—"}{c.gender ? ` · ${genderHe(c.gender)}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.relationship_status || "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1 max-w-[220px]">
                        {(c.interests || []).slice(0, 3).map((i: string) => (
                          <Badge key={i} variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                            {INTEREST_LABELS[i] || i}
                          </Badge>
                        ))}
                        {(c.interests || []).length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{c.interests.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <ScoreBar value={c.activity_score ?? 0} />
                    </td>
                    <td className="px-4 py-2.5">
                      {c.sales_temperature ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${SALES_TEMP_TONE[c.sales_temperature] || "border-border"}`}>
                          {SALES_TEMP_LABELS[c.sales_temperature]}
                        </span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{c.interaction_count ?? 0}</td>
                    <td className="px-4 py-2.5">
                      {c.consent_marketing
                        ? <span className="text-success text-xs font-medium">✓</span>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{formatRelative(c.last_interaction_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <ContactCreateDialog open={open} onOpenChange={setOpen} onCreated={() => refetch()} />
    </div>
  );
}

function FilterSelect({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder: string; options: Record<string, string>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="bg-background h-9 text-xs"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder} — הכל</SelectItem>
        {Object.entries(options).map(([k, v]) => (
          <SelectItem key={k} value={k}>{v}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ScoreBar({ value }: { value: number }) {
  const v = Math.min(100, Math.max(0, value || 0));
  const tone = v >= 70 ? "bg-success" : v >= 30 ? "bg-warning" : "bg-muted-foreground/40";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums w-6">{v}</span>
    </div>
  );
}

function genderHe(g: string) {
  return ({ male: "ז", female: "נ", other: "א", prefer_not_to_say: "—" } as any)[g] || g;
}