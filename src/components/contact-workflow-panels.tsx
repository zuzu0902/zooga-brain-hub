import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { operatorTime } from "@/lib/hostinger-core/control-center";
import {
  consentStatusLabel, consentView, fieldLabel, memoryText, stateLabel,
  type ContactWorkflow, type WorkflowMessage,
} from "@/lib/hostinger-core/contact-workflow";
import { Empty } from "./operator-data";

export function WorkflowConversation({ messages, hasOlder, loadingOlder, onLoadOlder }: { messages: WorkflowMessage[]; hasOlder: boolean; loadingOlder: boolean; onLoadOlder: () => void }) {
  return <div className="space-y-3 pt-4">
    {hasOlder && <div className="text-center"><Button variant="outline" size="sm" disabled={loadingOlder} onClick={onLoadOlder}>{loadingOlder ? "טוען…" : "טען הודעות קודמות"}</Button></div>}
    {!messages.length ? <Empty text="אין הודעות בשיחה" /> : <ol className="space-y-2" aria-label="רצף השיחה">
      {messages.map(m => <li key={m.id} data-direction={m.direction} className={`flex ${m.direction === "inbound" ? "justify-start" : "justify-end"}`}>
        <div className={`max-w-[80%] rounded-lg px-3 py-2 border ${m.direction === "inbound" ? "bg-muted/50" : "bg-primary/10 border-primary/20"}`}>
          <div className="text-[11px] text-muted-foreground mb-1">{m.direction === "inbound" ? "הלקוח" : "תמר / צוות"}</div>
          <p className="text-sm whitespace-pre-wrap break-words">{m.text || "—"}</p>
          <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">{operatorTime(m.occurred_at)}{m.direction === "outbound" && m.delivery_state ? ` · ${stateLabel(m.delivery_state)}` : ""}</div>
        </div>
      </li>)}
    </ol>}
  </div>;
}

export function WorkflowConsent({ w }: { w: ContactWorkflow }) {
  return <section className="space-y-3">
    <h2 className="font-semibold">הסכמת הלקוח: <Badge variant="secondary">{consentStatusLabel(w.customer_consent)}</Badge></h2>
    {!w.consents.length ? <p className="text-sm text-muted-foreground">אין רישומי הסכמה</p> : <ul className="divide-y divide-border">
      {w.consents.map((c, i) => { const v = consentView(c); return <li key={i} className="py-3 space-y-1 text-sm">
        <div className="flex gap-2 flex-wrap items-center"><span className="font-medium">{c.channel === "whatsapp" ? "WhatsApp" : c.channel || "ערוץ לא ידוע"}</span><Badge variant="outline">{v.label}</Badge><span className={v.fromCustomer ? "text-success text-xs" : "text-warning-foreground text-xs font-medium"}>{v.note}</span></div>
        {v.askWording && <p className="text-muted-foreground whitespace-pre-wrap">נוסח הבקשה: {v.askWording}{v.askedAt ? ` (${operatorTime(v.askedAt)})` : ""}</p>}
        {v.customerText && <p className="whitespace-pre-wrap">תשובת הלקוח: „{v.customerText}”{v.respondedAt ? ` · ${operatorTime(v.respondedAt)}` : ""}</p>}
        <p className="text-xs text-muted-foreground">נרשם: {operatorTime(c.recorded_at)}{c.wording_version ? ` · גרסת נוסח ${c.wording_version}` : ""}</p>
      </li>; })}
    </ul>}
  </section>;
}

export function WorkflowIntake({ w }: { w: ContactWorkflow }) {
  const pct = Math.round(Math.min(1, Math.max(0, w.intake.completion_score > 1 ? w.intake.completion_score / 100 : w.intake.completion_score)) * 100);
  return <section className="space-y-3">
    <h2 className="font-semibold">אינטייק · {stateLabel(w.intake.state)} · {pct}%</h2>
    <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
    <div className="grid sm:grid-cols-2 gap-4 text-sm">
      <div><h3 className="text-muted-foreground mb-1">ידוע</h3>{w.intake.completed.length ? <div className="flex gap-1 flex-wrap">{w.intake.completed.map(k => <Badge key={k} variant="outline">{fieldLabel(k)}</Badge>)}</div> : <p className="text-muted-foreground">—</p>}</div>
      <div><h3 className="text-muted-foreground mb-1">חסר</h3>{w.intake.missing.length ? <div className="flex gap-1 flex-wrap">{w.intake.missing.map(k => <Badge key={k} variant="secondary">{fieldLabel(k)}</Badge>)}</div> : <p className="text-muted-foreground">אין שדות חסרים</p>}</div>
    </div>
  </section>;
}

export function WorkflowKnowledge({ w }: { w: ContactWorkflow }) {
  const summaries = w.audits.filter(a => a.summary || a.intent || a.next_question);
  return <div className="space-y-8 pt-4">
    <WorkflowConsent w={w} />
    <WorkflowIntake w={w} />
    <section className="space-y-2"><h2 className="font-semibold">עובדות שהלקוח מסר</h2>
      {!w.facts.length ? <p className="text-sm text-muted-foreground">לא חולצו עובדות</p> : <ul className="divide-y divide-border">{w.facts.map((f, i) => <li key={i} className="py-2 text-sm"><span className="font-medium">{fieldLabel(f.field_key)}:</span> {f.value_text || "—"}{f.evidence_quote && <p className="text-muted-foreground whitespace-pre-wrap mt-1">ציטוט: „{f.evidence_quote}”</p>}<p className="text-xs text-muted-foreground">מקור: {operatorTime(f.observed_at)}</p></li>)}</ul>}
    </section>
    <section className="space-y-2"><h2 className="font-semibold">סיכום וניתוח של המודל</h2><p className="text-xs text-muted-foreground">פרשנות שנוצרה אוטומטית — אינה עובדה שהלקוח מסר.</p>
      {!summaries.length ? <p className="text-sm text-muted-foreground">אין סיכומים</p> : <ul className="divide-y divide-border">{summaries.map((a, i) => <li key={i} className="py-2 text-sm space-y-1">{a.summary && <p className="whitespace-pre-wrap">{a.summary}</p>}{a.intent && <p className="text-muted-foreground">כוונה מזוהה: {a.intent}</p>}{a.next_question && <p className="text-muted-foreground">שאלה הבאה מתוכננת: {a.next_question}</p>}<p className="text-xs text-muted-foreground">{operatorTime(a.source_updated_at)}</p></li>)}</ul>}
    </section>
    <section className="space-y-2"><h2 className="font-semibold">זיכרון</h2>
      {!w.memories.length ? <p className="text-sm text-muted-foreground">אין פריטי זיכרון</p> : <ul className="divide-y divide-border">{w.memories.map((m, i) => <li key={i} className="py-2 text-sm"><span className="font-medium">{fieldLabel(m.memory_key)}:</span> <span className="whitespace-pre-wrap">{memoryText(m.memory_value)}</span><p className="text-xs text-muted-foreground">{operatorTime(m.source_updated_at)}</p></li>)}</ul>}
    </section>
  </div>;
}

export function WorkflowHandoffs({ w }: { w: ContactWorkflow }) {
  if (!w.handoffs.length) return <Empty text="אין פניות לטיפול מנהל" />;
  return <ul className="divide-y divide-border pt-2">{w.handoffs.map(h => <li key={h.id} className="py-3 text-sm space-y-1"><div className="flex gap-2 items-center"><Badge variant="outline">{stateLabel(h.state)}</Badge><span className="text-xs text-muted-foreground">{operatorTime(h.created_at)}</span></div>{h.reason && <p className="whitespace-pre-wrap">סיבה: {h.reason}</p>}{h.manager_summary && <p className="text-muted-foreground whitespace-pre-wrap">סיכום מנהל: {h.manager_summary}</p>}</li>)}</ul>;
}

export function WorkflowTasks({ w }: { w: ContactWorkflow }) {
  if (!w.tasks.length) return <Empty text="אין משימות" />;
  return <ul className="divide-y divide-border pt-2">{w.tasks.map(t => <li key={t.id} className="py-3 text-sm space-y-1"><div className="flex gap-2 items-center flex-wrap"><span className="font-medium">{t.title || "משימה"}</span>{t.priority && <Badge variant="outline">{stateLabel(t.priority)}</Badge>}<span className="text-xs text-muted-foreground">{stateLabel(t.status)} · {operatorTime(t.created_at)}</span></div>{t.description && <p className="text-muted-foreground whitespace-pre-wrap">{t.description}</p>}</li>)}</ul>;
}
