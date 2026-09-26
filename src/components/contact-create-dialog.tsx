import { useState } from "react";
import { coreApi, toCorePatch } from "@/lib/hostinger-core/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { SOURCE_LABELS } from "@/lib/i18n";
import { useT, useLanguage } from "@/lib/language-context";

export function ContactCreateDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const t = useT();
  const { dir } = useLanguage();
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
      toast.error(t("יש למלא לפחות שם או טלפון"));
      return;
    }
    setSaving(true);
    let created: any;
    try {
      created = await coreApi.createContact(toCorePatch({
        first_name: first || null,
        last_name: last || null,
        phone: phone || null,
        email: email || null,
        city: city || null,
        region: region || null,
        source,
      }));
    } catch (e: any) {
      setSaving(false);
      toast.error(t("שגיאה: ") + String(e?.code ?? e?.message ?? e));
      return;
    }
    setSaving(false);
    toast.success(t("איש הקשר נוצר"));
    setFirst(""); setLast(""); setPhone(""); setEmail(""); setCity(""); setRegion("");
    onOpenChange(false);
    onCreated?.(created.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir}>
        <DialogHeader><DialogTitle>{t("איש קשר חדש")}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("שם פרטי")}</Label><Input value={first} onChange={(e) => setFirst(e.target.value)} /></div>
          <div><Label>{t("שם משפחה")}</Label><Input value={last} onChange={(e) => setLast(e.target.value)} /></div>
          <div><Label>{t("טלפון")}</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" /></div>
          <div><Label>{t("אימייל")}</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" /></div>
          <div><Label>{t("עיר")}</Label><Input value={city} onChange={(e) => setCity(e.target.value)} /></div>
          <div><Label>{t("אזור")}</Label><Input value={region} onChange={(e) => setRegion(e.target.value)} /></div>
          <div className="col-span-2">
            <Label>{t("מקור")}</Label>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("ביטול")}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t("שומר...") : t("צור")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}