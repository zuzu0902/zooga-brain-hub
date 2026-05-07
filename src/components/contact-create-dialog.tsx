import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { SOURCE_LABELS } from "@/lib/i18n";

export function ContactCreateDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [source, setSource] = useState("Manual");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!first && !last && !phone) {
      toast.error("יש למלא לפחות שם או טלפון");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        first_name: first || null,
        last_name: last || null,
        phone: phone || null,
        email: email || null,
        city: city || null,
        region: region || null,
        source: source as any,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      toast.error("שגיאה: " + error.message);
      return;
    }
    toast.success("איש הקשר נוצר");
    setFirst(""); setLast(""); setPhone(""); setEmail(""); setCity(""); setRegion("");
    onOpenChange(false);
    onCreated?.(data!.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>איש קשר חדש</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>שם פרטי</Label><Input value={first} onChange={(e) => setFirst(e.target.value)} /></div>
          <div><Label>שם משפחה</Label><Input value={last} onChange={(e) => setLast(e.target.value)} /></div>
          <div><Label>טלפון</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" /></div>
          <div><Label>אימייל</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" /></div>
          <div><Label>עיר</Label><Input value={city} onChange={(e) => setCity(e.target.value)} /></div>
          <div><Label>אזור</Label><Input value={region} onChange={(e) => setRegion(e.target.value)} /></div>
          <div className="col-span-2">
            <Label>מקור</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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