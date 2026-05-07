import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ArrowRight, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  STATUS_LABELS, SOURCE_LABELS, INTEREST_LABELS, LIFESTYLE_LABELS,
  SPENDING_LABELS, INCOME_LABELS, INTERACTION_TYPE_LABELS, ALL_INTERESTS,
  ALL_LIFESTYLE, formatDate, MESSAGE_STATUS_LABELS, CHANNEL_LABELS,
} from "@/lib/i18n";

export const Route = createFileRoute("/_app/contacts/$id")({
  head: () => ({ meta: [{ title: "פרופיל איש קשר — Zooga CRM" }] }),
  component: ContactProfile,
});

function ContactProfile() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const { data: contact, isLoading } = useQuery({
    queryKey: ["contact", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: interactions } = useQuery({
    queryKey: ["interactions", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("interactions")
        .select("*")
        .eq("contact_id", id)
        .order("timestamp", { ascending: false });
      return data ?? [];
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["messages-of", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("messages")
        .select("*, offers(title)")
        .eq("contact_id", id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const [interactionOpen, setInteractionOpen] = useState(false);

  async function update(patch: any) {
    const { error } = await supabase.from("contacts").update(patch).eq("id", id);
    if (error) toast.error("שגיאה: " + error.message);
    else {
      toast.success("עודכן");
      qc.invalidateQueries({ queryKey: ["contact", id] });
    }
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">טוען...</div>;
  if (!contact) return <div className="p-6">איש קשר לא נמצא</div>;

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <Link to="/contacts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowRight className="h-4 w-4" /> חזרה לרשימה
      </Link>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div
              className="h-16 w-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-primary-foreground"
              style={{ background: "var(--gradient-warm)" }}
            >
              {(contact.full_name || "?").slice(0, 1)}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{contact.full_name || "ללא שם"}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="secondary">{STATUS_LABELS[contact.status as string] || contact.status}</Badge>
                <Badge variant="outline">{SOURCE_LABELS[(contact.source as string) || ""] || contact.source}</Badge>
                {contact.region && <span className="text-sm text-muted-foreground">· {contact.region}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select value={contact.status} onValueChange={(v) => update({ status: v })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setInteractionOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> אינטראקציה
            </Button>
            <Button asChild variant="outline">
              <Link to="/send-offer" search={{ contactId: id } as any}>שלח הצעה</Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <Stat label="ציון מעורבות" value={contact.engagement_score} />
          <Stat label="ציון כלכלי" value={contact.economic_score} />
          <Stat label="גיל" value={(contact as any).age ?? "—"} />
          <Stat label="אינטראקציה אחרונה" value={contact.last_interaction_at ? formatDate(contact.last_interaction_at) : "—"} small />
        </div>
      </Card>

      <Tabs defaultValue="details">
        <TabsList className="flex-wrap">
          <TabsTrigger value="details">פרטים</TabsTrigger>
          <TabsTrigger value="interests">תחומי עניין ותגיות</TabsTrigger>
          <TabsTrigger value="economic">פרופיל כלכלי</TabsTrigger>
          <TabsTrigger value="timeline">ציר זמן</TabsTrigger>
          <TabsTrigger value="messages">הצעות שנשלחו</TabsTrigger>
          <TabsTrigger value="ai">תובנות AI</TabsTrigger>
          <TabsTrigger value="notes">הערות</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <DetailsTab contact={contact} update={update} />
        </TabsContent>
        <TabsContent value="interests">
          <InterestsTab contact={contact} update={update} />
        </TabsContent>
        <TabsContent value="economic">
          <EconomicTab contact={contact} update={update} />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineTab interactions={interactions ?? []} />
        </TabsContent>
        <TabsContent value="messages">
          <MessagesTab messages={messages ?? []} />
        </TabsContent>
        <TabsContent value="ai">
          <AITab contact={contact} update={update} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab contact={contact} update={update} />
        </TabsContent>
      </Tabs>

      <AddInteractionDialog
        open={interactionOpen}
        onOpenChange={setInteractionOpen}
        contactId={id}
        onAdded={() => {
          qc.invalidateQueries({ queryKey: ["interactions", id] });
          qc.invalidateQueries({ queryKey: ["contact", id] });
        }}
      />
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: any; small?: boolean }) {
  return (
    <div className="p-3 rounded-lg bg-muted/40">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={small ? "text-sm font-medium mt-1" : "text-2xl font-bold mt-1"}>{value}</div>
    </div>
  );
}

function Field({ label, value, onSave, type = "text", dir }: any) {
  const [v, setV] = useState(value ?? "");
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={v} type={type} dir={dir} onChange={(e) => setV(e.target.value)} />
        {String(v) !== String(value ?? "") && (
          <Button size="icon" variant="outline" onClick={() => onSave(v)}><Save className="h-4 w-4" /></Button>
        )}
      </div>
    </div>
  );
}

function DetailsTab({ contact, update }: any) {
  return (
    <Card className="p-5 mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="שם פרטי" value={contact.first_name} onSave={(v: string) => update({ first_name: v })} />
      <Field label="שם משפחה" value={contact.last_name} onSave={(v: string) => update({ last_name: v })} />
      <Field label="טלפון" value={contact.phone} dir="ltr" onSave={(v: string) => update({ phone: v || null })} />
      <Field label="אימייל" value={contact.email} dir="ltr" onSave={(v: string) => update({ email: v || null })} />
      <Field label="וואטסאפ" value={contact.whatsapp_number} dir="ltr" onSave={(v: string) => update({ whatsapp_number: v || null })} />
      <Field label="Facebook ID" value={contact.facebook_id} dir="ltr" onSave={(v: string) => update({ facebook_id: v || null })} />
      <Field label="עיר" value={contact.city} onSave={(v: string) => update({ city: v })} />
      <Field label="אזור" value={contact.region} onSave={(v: string) => update({ region: v })} />
      <Field label="תאריך לידה" value={contact.birth_date} type="date" onSave={(v: string) => update({ birth_date: v || null })} />
      <div>
        <Label>מגדר</Label>
        <Select value={contact.gender ?? ""} onValueChange={(v) => update({ gender: v || null })}>
          <SelectTrigger><SelectValue placeholder="בחר" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="male">זכר</SelectItem>
            <SelectItem value="female">נקבה</SelectItem>
            <SelectItem value="other">אחר</SelectItem>
            <SelectItem value="prefer_not_to_say">מעדיף לא לציין</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Field label="מצב משפחתי" value={contact.relationship_status} onSave={(v: string) => update({ relationship_status: v })} />
      <div className="flex items-center justify-between p-3 rounded-lg border">
        <div>
          <div className="font-medium">הסכמה לשיווק</div>
          <div className="text-xs text-muted-foreground">{contact.consent_date ? `אושר ב-${formatDate(contact.consent_date)}` : "לא אושר"}</div>
        </div>
        <Switch
          checked={!!contact.consent_marketing}
          onCheckedChange={(v) => update({ consent_marketing: v, consent_date: v ? new Date().toISOString() : null })}
        />
      </div>
    </Card>
  );
}

function ChipPicker({ all, labels, selected, onChange }: any) {
  return (
    <div className="flex flex-wrap gap-2">
      {all.map((k: string) => {
        const on = selected.includes(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(on ? selected.filter((x: string) => x !== k) : [...selected, k])}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              on ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
            }`}
          >
            {labels[k] || k}
          </button>
        );
      })}
    </div>
  );
}

function InterestsTab({ contact, update }: any) {
  const [tagInput, setTagInput] = useState("");
  return (
    <Card className="p-5 mt-3 space-y-6">
      <div>
        <Label className="mb-2 block">תחומי עניין</Label>
        <ChipPicker
          all={ALL_INTERESTS}
          labels={INTEREST_LABELS}
          selected={contact.interests || []}
          onChange={(v: string[]) => update({ interests: v })}
        />
      </div>
      <div>
        <Label className="mb-2 block">סגנון חיים</Label>
        <ChipPicker
          all={ALL_LIFESTYLE}
          labels={LIFESTYLE_LABELS}
          selected={contact.lifestyle_tags || []}
          onChange={(v: string[]) => update({ lifestyle_tags: v })}
        />
      </div>
      <div>
        <Label className="mb-2 block">תגיות חופשיות</Label>
        <div className="flex gap-2 flex-wrap mb-2">
          {(contact.tags || []).map((t: string) => (
            <Badge key={t} variant="secondary" className="gap-1">
              {t}
              <button onClick={() => update({ tags: (contact.tags || []).filter((x: string) => x !== t) })}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="תגית חדשה"
            onKeyDown={(e) => {
              if (e.key === "Enter" && tagInput.trim()) {
                update({ tags: [...(contact.tags || []), tagInput.trim()] });
                setTagInput("");
              }
            }}
          />
          <Button
            onClick={() => {
              if (tagInput.trim()) {
                update({ tags: [...(contact.tags || []), tagInput.trim()] });
                setTagInput("");
              }
            }}
          >הוסף</Button>
        </div>
      </div>
    </Card>
  );
}

function EconomicTab({ contact, update }: any) {
  return (
    <Card className="p-5 mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <Label>טווח הכנסה</Label>
        <Select value={contact.income_range ?? ""} onValueChange={(v) => update({ income_range: v || null })}>
          <SelectTrigger><SelectValue placeholder="בחר" /></SelectTrigger>
          <SelectContent>
            {Object.entries(INCOME_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>פרופיל הוצאה</Label>
        <Select value={contact.spending_profile ?? ""} onValueChange={(v) => update({ spending_profile: v || null })}>
          <SelectTrigger><SelectValue placeholder="בחר" /></SelectTrigger>
          <SelectContent>
            {Object.entries(SPENDING_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>רגישות מחיר</Label>
        <Select value={contact.price_sensitivity ?? ""} onValueChange={(v) => update({ price_sensitivity: v || null })}>
          <SelectTrigger><SelectValue placeholder="בחר" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="high">גבוהה</SelectItem>
            <SelectItem value="medium">בינונית</SelectItem>
            <SelectItem value="low">נמוכה</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Field label="ציון כלכלי (0-100)" type="number" value={contact.economic_score} onSave={(v: string) => update({ economic_score: parseInt(v) || 0 })} />
    </Card>
  );
}

function TimelineTab({ interactions }: any) {
  return (
    <Card className="p-5 mt-3">
      {interactions.length === 0 && <div className="text-muted-foreground">אין אינטראקציות עדיין</div>}
      <div className="space-y-3">
        {interactions.map((i: any) => (
          <div key={i.id} className="flex gap-3 p-3 rounded-lg border">
            <div className="h-2 w-2 rounded-full bg-primary mt-2" />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div className="font-medium">{INTERACTION_TYPE_LABELS[i.type] || i.type}</div>
                <div className="text-xs text-muted-foreground">{formatDate(i.timestamp)}</div>
              </div>
              {i.content && <div className="text-sm text-muted-foreground mt-1">{i.content}</div>}
              {i.source && <div className="text-xs text-muted-foreground mt-1">מקור: {i.source}</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MessagesTab({ messages }: any) {
  return (
    <Card className="p-5 mt-3">
      {messages.length === 0 && <div className="text-muted-foreground">לא נשלחו הצעות</div>}
      <div className="space-y-3">
        {messages.map((m: any) => (
          <div key={m.id} className="p-3 rounded-lg border">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="font-medium">{m.offers?.title || "הודעה ידנית"}</div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{CHANNEL_LABELS[m.channel]}</Badge>
                <Badge>{MESSAGE_STATUS_LABELS[m.status]}</Badge>
                <span className="text-xs text-muted-foreground">{formatDate(m.created_at)}</span>
              </div>
            </div>
            <div className="text-sm mt-2 whitespace-pre-wrap">{m.message_text}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AITab({ contact, update }: any) {
  const [s, setS] = useState({
    ai_summary: contact.ai_summary || "",
    ai_profile_notes: contact.ai_profile_notes || "",
    ai_recommended_next_action: contact.ai_recommended_next_action || "",
    ai_offer_fit: contact.ai_offer_fit || "",
    ai_risk_flags: contact.ai_risk_flags || "",
    ai_confidence_score: contact.ai_confidence_score ?? "",
  });
  return (
    <Card className="p-5 mt-3 space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
        🔒 שדות פנימיים — לעיני המנהל בלבד. שדות אלו מוכנים לחיבור עתידי ל-LLM של בוט תמר.
      </div>
      <div>
        <Label>סיכום AI</Label>
        <Textarea rows={3} value={s.ai_summary} onChange={(e) => setS({ ...s, ai_summary: e.target.value })} />
      </div>
      <div>
        <Label>הערות פרופיל</Label>
        <Textarea rows={4} value={s.ai_profile_notes} onChange={(e) => setS({ ...s, ai_profile_notes: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>פעולה מומלצת הבאה</Label>
          <Textarea rows={3} value={s.ai_recommended_next_action} onChange={(e) => setS({ ...s, ai_recommended_next_action: e.target.value })} />
        </div>
        <div>
          <Label>הצעות מתאימות</Label>
          <Textarea rows={3} value={s.ai_offer_fit} onChange={(e) => setS({ ...s, ai_offer_fit: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>סימוני סיכון</Label>
          <Textarea rows={2} value={s.ai_risk_flags} onChange={(e) => setS({ ...s, ai_risk_flags: e.target.value })} />
        </div>
        <div>
          <Label>ציון ביטחון (0-100)</Label>
          <Input type="number" value={s.ai_confidence_score} onChange={(e) => setS({ ...s, ai_confidence_score: e.target.value })} />
        </div>
      </div>
      <Button onClick={() => update({ ...s, ai_confidence_score: s.ai_confidence_score === "" ? null : Number(s.ai_confidence_score) })}>
        שמור תובנות
      </Button>
    </Card>
  );
}

function NotesTab({ contact, update }: any) {
  const [v, setV] = useState(contact.notes || "");
  return (
    <Card className="p-5 mt-3 space-y-3">
      <Textarea rows={8} value={v} onChange={(e) => setV(e.target.value)} placeholder="הערות פנימיות על איש הקשר..." />
      <Button onClick={() => update({ notes: v })}>שמור הערות</Button>
    </Card>
  );
}

function AddInteractionDialog({ open, onOpenChange, contactId, onAdded }: any) {
  const [type, setType] = useState("admin_note");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("interactions").insert({
      contact_id: contactId,
      type: type as any,
      content,
      source: "admin",
    });
    setSaving(false);
    if (error) { toast.error("שגיאה: " + error.message); return; }
    toast.success("נוסף");
    setContent("");
    onOpenChange(false);
    onAdded?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>הוסף אינטראקציה</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>סוג</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(INTERACTION_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>תוכן</Label>
            <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={save} disabled={saving}>{saving ? "שומר..." : "שמור"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}