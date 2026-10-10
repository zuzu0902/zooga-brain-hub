import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin-authz.server";
import { validateOfferUrl } from "@/lib/offer-pricing-block";

/** Read-only: fetch a public page and extract grounded event facts. Never writes anything. */
const Input = z.object({ url: z.string().url().max(2000), title: z.string().max(300).optional() });

const strip = (html: string) => html
  .replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
  .replace(/\s+/g, " ").trim();

const nullable = (type: string) => ({ type: [type, "null"] });
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "category", "description", "event_date", "event_end_date", "price", "currency", "event_knowledge"],
  properties: {
    title: nullable("string"), category: nullable("string"), description: nullable("string"),
    event_date: nullable("string"), event_end_date: nullable("string"), price: nullable("number"),
    currency: { type: ["string", "null"], enum: ["ILS", "USD", "EUR", null] }, event_knowledge: nullable("string"),
  },
};

const SYSTEM = `אתה מחלץ עובדות מדף אירוע/מוצר עבור קטלוג. כתוב בעברית.
חוקים: אל תמציא דבר. כל שדה שלא מופיע במפורש בדף — null. תאריכים בפורמט ISO 8601 (YYYY-MM-DD או YYYY-MM-DDTHH:MM). price: המחיר הראשי לאדם כמספר בלבד.
description: 1-2 משפטים. event_knowledge: סיכום עובדתי עשיר מהדף בלבד — מה קורה באירוע, קהל יעד, מיקום ולו״ז, מה כלול/לא כלול, תנאי הרשמה וביטול. אם הדף מכיל כמה הצעות, התמקד בהצעה התואמת לשם שסופק.`;

export type ExtractedEvent = { title: string | null; category: string | null; description: string | null; event_date: string | null; event_end_date: string | null; price: number | null; currency: "ILS" | "USD" | "EUR" | null; event_knowledge: string | null };

export const extractEventFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; fields: ExtractedEvent } | { ok: false; error: string }> => {
    await assertAdmin(context);
    const bad = validateOfferUrl(data.url);
    if (bad || !data.url.startsWith("https://")) return { ok: false, error: "הקישור חייב להיות כתובת https ציבורית" };
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { ok: false, error: "שירות הניתוח אינו מוגדר" };

    let text = "";
    try {
      const fc = process.env.FIRECRAWL_API_KEY;
      if (fc) {
        const r = await fetch("https://api.firecrawl.dev/v2/scrape", { method: "POST", headers: { Authorization: `Bearer ${fc}`, "Content-Type": "application/json" }, body: JSON.stringify({ url: data.url, formats: ["markdown"], onlyMainContent: true }) });
        if (r.ok) { const j: any = await r.json(); text = String(j?.data?.markdown ?? ""); }
      }
      if (text.replace(/\s/g, "").length < 40) {
        const r = await fetch(data.url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 ZoogaCatalog", "Accept-Language": "he-IL,he;q=0.9" } });
        if (!r.ok) return { ok: false, error: `לא ניתן לקרוא את הדף (HTTP ${r.status})` };
        text = strip(await r.text());
      }
    } catch { return { ok: false, error: "לא ניתן לקרוא את הדף" }; }
    text = text.slice(0, 18000);
    if (text.replace(/\s/g, "").length < 40) return { ok: false, error: "לא נמצא תוכן קריא בדף" };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Lovable-API-Key": key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra", stream: true, store: false, reasoning: { effort: "low" },
        instructions: SYSTEM,
        input: [{ role: "user", content: `שם מבוקש: ${data.title || "(לא צוין)"}\nURL: ${data.url}\n\nתוכן הדף:\n"""\n${text}\n"""` }],
        text: { format: { type: "json_schema", name: "event", strict: true, schema: SCHEMA } },
      }),
    });
    if (!res.ok || !res.body) {
      console.warn("[catalog-extract] gateway", res.status);
      return { ok: false, error: res.status === 429 ? "עומס זמני — נסו שוב בעוד דקה" : res.status === 402 ? "נגמרו קרדיטי ה-AI בסביבת העבודה" : "הניתוח נכשל, נסו שוב" };
    }
    let out = ""; let buf = "";
    const reader = res.body.getReader(); const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try { const ev = JSON.parse(line.slice(5)); if (ev.type === "response.output_text.delta") out += ev.delta; } catch { /* skip */ }
      }
    }
    try {
      const p = JSON.parse(out) as ExtractedEvent;
      const date = (v: unknown) => typeof v === "string" && !isNaN(new Date(v).getTime()) ? v : null;
      return { ok: true, fields: { ...p, event_date: date(p.event_date), event_end_date: date(p.event_end_date), price: typeof p.price === "number" && p.price >= 0 ? p.price : null } };
    } catch { return { ok: false, error: "התקבלה תשובה לא תקינה מהניתוח" }; }
  });
