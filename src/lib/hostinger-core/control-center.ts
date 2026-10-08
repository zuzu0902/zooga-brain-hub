import { z } from "zod";

const identity = z.object({ full_name: z.string().nullish(), first_name: z.string().nullish(), phone: z.string().nullish() });
const conversation = z.object({
  id: z.string(), contact_id: z.string().nullish(), identity: identity.nullish(),
  state: z.string().nullish(), ownership: z.string().nullish(), direction: z.string().nullish(),
  delivery_state: z.string().nullish(), occurred_at: z.string().nullish(), updated_at: z.string().nullish(),
  content: z.object({ text: z.string().nullish() }).nullish(),
});
const handoff = z.object({
  id: z.string(), contact_id: z.string().nullish(), identity: identity.nullish(),
  reason: z.string().nullish(), status: z.string().nullish(), ownership: z.string().nullish(),
  created_at: z.string().nullish(), updated_at: z.string().nullish(),
});
const task = z.object({
  id: z.string(), title: z.string(), description: z.string().nullish(), contact_id: z.string().nullish(),
  priority: z.string().nullish(), status: z.string().nullish(), created_at: z.string().nullish(),
  updated_at: z.string().nullish(), due_date: z.string().nullish(),
});
const counts = z.record(z.string(), z.number().nonnegative());
const adapter = z.object({ configured: z.boolean().optional(), writable: z.boolean().optional(), mode: z.string().optional() });
const readiness = z.object({
  mode: z.string().optional(), live_traffic: z.boolean().optional(), inbound_enabled: z.boolean().optional(),
  outbound_enabled: z.boolean().optional(), admin_allowlist_configured: z.boolean().optional(),
  adapters: z.object({ crm: adapter.optional(), meta: adapter.optional(), llm: adapter.optional() }).optional(),
});
const schema = z.object({
  ok: z.literal(true),
  control_center: z.object({
    summary: z.object({ contacts: z.number().nonnegative(), active_conversations: z.number().nonnegative(), open_handoffs: z.number().nonnegative(), open_tasks: z.number().nonnegative() }),
    conversations: z.array(conversation), handoffs: z.array(handoff), tasks: z.array(task),
    tamar: z.object({ shadow_by_state: counts.optional(), status: z.string().optional() }).optional(),
    delivery: z.object({ outbound_by_state: counts.optional(), status: z.string().optional() }).optional(),
  }),
  readiness: readiness.optional(),
});

export type CoreConversation = z.infer<typeof conversation>;
export type CoreHandoff = z.infer<typeof handoff>;
export type CoreTask = z.infer<typeof task>;
export type CoreControlCenter = z.infer<typeof schema>;

/** Validate the observed read-only contract; missing data must not become a false zero. */
export function parseControlCenter(body: unknown): CoreControlCenter {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error("core_control_center_unavailable");
  return parsed.data;
}

const labels: Record<string, string> = {
  tamar: "תמר", ai: "תמר", bot: "תמר", human: "מנהל", manager: "מנהל", human_owned: "מנהל",
  under_human: "בטיפול מנהל", human_locked: "בטיפול מנהל", handoff: "בטיפול מנהל", unassigned: "לא משויך",
  inbound: "נכנסת", outbound: "יוצאת", incoming: "נכנסת", outgoing: "יוצאת",
  sent: "נשלחה", delivered: "נמסרה", read: "נקראה", failed: "נכשלה", pending: "ממתינה",
  queued: "בתור", accepted: "התקבלה", received: "התקבלה", held_for_approval: "ממתינה לאישור",
  open: "פתוח", active: "פעיל", in_progress: "בטיפול", done: "הושלם", closed: "סגור", resolved: "טופל",
  completed: "הושלם", blocked: "חסום", shadow: "בדיקה", enabled: "פעיל", disabled: "לא פעיל",
  normal: "רגילה", low: "נמוכה", high: "גבוהה", urgent: "דחופה",
};
export function operatorLabel(value: string | null | undefined): string {
  return value ? labels[value] ?? "לא ידוע" : "לא ידוע";
}
export function contactLabel(row: { identity?: CoreConversation["identity"] }): string {
  return row.identity?.full_name || row.identity?.first_name || row.identity?.phone || "ללא שם";
}
export function operatorTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}