import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ChevronsUpDown, Plus, Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS } from "@/lib/i18n";
import { toast } from "sonner";

export function OfferPicker({ value, onChange }: { value?: string | null; onChange: (offerId: string | null) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: offers } = useQuery({
    queryKey: ["offers-picker"],
    queryFn: async () => {
      const { data } = await supabase.from("offers").select("id,title,category,price,status,target_min_age,target_max_age,description").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const selected = offers?.find((o: any) => o.id === value) || null;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" className="flex-1 justify-between font-normal">
              {selected ? (
                <span className="flex items-center gap-2 truncate">
                  <Tag className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="truncate">{selected.title}</span>
                  {selected.price && <span className="text-muted-foreground text-xs">· ₪{selected.price}</span>}
                </span>
              ) : (
                <span className="text-muted-foreground">בחר הצעה קיימת...</span>
              )}
              <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start" dir="rtl">
            <Command>
              <CommandInput placeholder="חיפוש לפי שם או קטגוריה..." />
              <CommandList>
                <CommandEmpty>לא נמצאו הצעות</CommandEmpty>
                <CommandGroup>
                  {offers?.map((o: any) => (
                    <CommandItem
                      key={o.id}
                      value={`${o.title} ${CATEGORY_LABELS[o.category] || o.category}`}
                      onSelect={() => { onChange(o.id); setOpen(false); }}
                    >
                      <Check className={cn("ml-2 h-4 w-4", value === o.id ? "opacity-100" : "opacity-0")} />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="truncate">{o.title}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {CATEGORY_LABELS[o.category] || o.category}{o.price ? ` · ₪${o.price}` : ""}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button type="button" variant="outline" onClick={() => setCreateOpen(true)} className="gap-1 shrink-0">
          <Plus className="h-4 w-4" /> חדשה
        </Button>
        {selected && (
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} aria-label="נקה">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {selected && (
        <div className="rounded-lg border bg-muted/30 p-3 flex items-start gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Tag className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-semibold truncate">{selected.title}</div>
              {selected.category && <Badge variant="outline">{CATEGORY_LABELS[selected.category] || selected.category}</Badge>}
              {selected.price && <Badge variant="secondary">₪{selected.price}</Badge>}
              <Badge variant="outline" className="text-xs">{selected.status}</Badge>
            </div>
            {selected.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{selected.description}</p>}
            {(selected.target_min_age || selected.target_max_age) && (
              <div className="text-xs text-muted-foreground mt-1">
                גילאי יעד: {selected.target_min_age || "—"}-{selected.target_max_age || "—"}
              </div>
            )}
          </div>
        </div>
      )}

      <CreateOfferDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id: string) => { qc.invalidateQueries({ queryKey: ["offers-picker"] }); qc.invalidateQueries({ queryKey: ["offers"] }); onChange(id); }}
      />
    </div>
  );
}

function CreateOfferDialog({ open, onOpenChange, onCreated }: any) {
  const [s, setS] = useState<any>({ title: "", description: "", category: "event", price: "", status: "active" });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!s.title.trim()) { toast.error("שם חובה"); return; }
    setSaving(true);
    const { data, error } = await supabase.from("offers").insert({
      title: s.title, description: s.description || null, category: s.category, status: s.status,
      price: s.price ? Number(s.price) : null,
    }).select("id").single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("הצעה נוצרה ושויכה");
    onOpenChange(false);
    setS({ title: "", description: "", category: "event", price: "", status: "active" });
    onCreated?.(data!.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>הצעה חדשה</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>שם *</Label><Input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></div>
          <div><Label>תיאור קצר</Label><Textarea rows={3} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></div>
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
          </div>
          <p className="text-xs text-muted-foreground">תוכל לערוך פרטים נוספים (קהל יעד, תחומי עניין) במסך ההצעות.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={save} disabled={saving}>{saving ? "שומר..." : "צור ושייך"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
