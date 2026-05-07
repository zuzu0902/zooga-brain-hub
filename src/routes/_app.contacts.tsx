import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Search } from "lucide-react";
import { STATUS_LABELS, SOURCE_LABELS, formatDate } from "@/lib/i18n";
import { ContactCreateDialog } from "@/components/contact-create-dialog";

export const Route = createFileRoute("/_app/contacts")({
  head: () => ({ meta: [{ title: "אנשי קשר — Zooga CRM" }] }),
  component: ContactsPage,
});

function ContactsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [open, setOpen] = useState(false);

  const { data: contacts, isLoading, refetch } = useQuery({
    queryKey: ["contacts", search, status, source],
    queryFn: async () => {
      let q = supabase
        .from("contacts")
        .select("id, full_name, phone, email, status, source, region, interests, engagement_score, consent_marketing, last_interaction_at, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (status !== "all") q = q.eq("status", status as any);
      if (source !== "all") q = q.eq("source", source as any);
      if (search.trim()) {
        const t = `%${search.trim()}%`;
        q = q.or(`full_name.ilike.${t},phone.ilike.${t},email.ilike.${t}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">אנשי קשר</h1>
          <p className="text-muted-foreground mt-1">{contacts?.length ?? 0} אנשי קשר</p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> הוסף איש קשר
        </Button>
      </header>

      <Card className="p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="חיפוש לפי שם, טלפון או אימייל"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל המקורות</SelectItem>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-3 font-medium">שם</th>
                <th className="p-3 font-medium">טלפון</th>
                <th className="p-3 font-medium">סטטוס</th>
                <th className="p-3 font-medium">מקור</th>
                <th className="p-3 font-medium">אזור</th>
                <th className="p-3 font-medium">מעורבות</th>
                <th className="p-3 font-medium">הסכמה</th>
                <th className="p-3 font-medium">אינטראקציה אחרונה</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">טוען...</td></tr>
              )}
              {!isLoading && contacts?.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">אין אנשי קשר התואמים לסינון</td></tr>
              )}
              {contacts?.map((c: any) => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <Link to="/contacts/$id" params={{ id: c.id }} className="font-medium hover:text-primary">
                      {c.full_name || "ללא שם"}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground" dir="ltr">{c.phone || "—"}</td>
                  <td className="p-3"><Badge variant="secondary">{STATUS_LABELS[c.status]}</Badge></td>
                  <td className="p-3 text-muted-foreground">{SOURCE_LABELS[c.source] || c.source}</td>
                  <td className="p-3 text-muted-foreground">{c.region || "—"}</td>
                  <td className="p-3"><span className="font-semibold text-primary">{c.engagement_score}</span></td>
                  <td className="p-3">{c.consent_marketing ? <Badge>כן</Badge> : <span className="text-muted-foreground">לא</span>}</td>
                  <td className="p-3 text-muted-foreground">{formatDate(c.last_interaction_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ContactCreateDialog open={open} onOpenChange={setOpen} onCreated={() => refetch()} />
    </div>
  );
}