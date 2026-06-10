import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({ offerId: z.string().uuid() });

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeta(html: string): string {
  const parts: string[] = [];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title?.[1]) parts.push(`TITLE: ${title[1].trim()}`);
  const metaRe = /<meta\s+[^>]*?(?:name|property)=["']([^"']+)["'][^>]*?content=["']([^"']*)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  const keep = /^(description|og:title|og:description|og:site_name|twitter:title|twitter:description|keywords)$/i;
  while ((m = metaRe.exec(html))) {
    if (keep.test(m[1])) parts.push(`${m[1]}: ${m[2].trim()}`);
  }
  // JSON-LD blocks often contain product/event facts
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let l: RegExpExecArray | null;
  while ((l = ldRe.exec(html))) {
    parts.push(`JSON-LD: ${l[1].trim().slice(0, 2000)}`);
  }
  return parts.join("\n");
}

const SYSTEM_PROMPT = `אתה עוזר אנליסט עבור הסוכנת "תמר" — בוט מכירות בעברית.
תפקידך: לקרוא תוכן של דף הצעה (מוצר/טיול/אירוע) ולהפיק מבנה ידע "מוצק" (grounded) שתמר תוכל לענות ולמכור ממנו.

חוקים קריטיים:
- אל תמציא עובדות. אם מידע לא מופיע במקור — אל תכתוב אותו.
- כל מה שלא ידוע — הכנס תחת escalation_boundary.must_escalate (הפניה לאדם).
- כתוב בעברית, חם-מקצועי.
- אל תכלול קישורים שלא במקור.

החזר אך ורק JSON תקין במבנה הבא:
{
  "ai_summary": "פסקה קצרה (2-4 משפטים) שמתארת את ההצעה בשפה שתמר תוכל לצטט.",
  "extracted_title": "כותרת מדויקת של ההצעה מהמקור — או null אם לא ברור.",
  "extracted_price": 0,
  "extracted_currency": "ILS|USD|EUR או null אם לא צוין",
  "extracted_event_date": "תאריך התחלת האירוע בפורמט ISO 8601 (YYYY-MM-DD או YYYY-MM-DDTHH:MM:SSZ) או null",
  "extracted_event_end_date": "תאריך סיום האירוע בפורמט ISO 8601 או null",
  "grounded_facts": { "key": "value", ... עובדות מוצקות מהמקור: תאריכים, מחיר, מיקום, משך, מה כלול, מה לא כלול },
  "faq_bundle": [ { "q": "שאלה", "a": "תשובה מהמקור בלבד" }, ... 3-8 פריטים ],
  "objection_notes": [ { "objection": "התנגדות שגולש עלול להעלות", "response": "מענה מבוסס מקור" }, ... 2-5 פריטים ],
  "sales_angle": "משפט-שניים על הזווית השיווקית — למי זה מתאים ולמה לרכוש עכשיו.",
  "matching_tags": ["תגיות התאמה קצרות לסגמנטציה", ...],
  "escalation_boundary": {
    "tamar_can_answer": ["נושאים שתמר יכולה לענות עליהם מהמקור"],
    "must_escalate": ["נושאים שדורשים אדם — לדוגמה תנאי ביטול לא מצוינים, מחיר לא ברור, אישורים רפואיים וכו'"]
  }
}`;

export const analyzeOfferIntelligence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const { offerId } = data;
    const sb = supabaseAdmin;

    const { data: offer, error: loadErr } = await sb
      .from("offers")
      .select("id, title, description, category, price, currency, offer_url")
      .eq("id", offerId)
      .maybeSingle();

    if (loadErr) throw new Error(loadErr.message);
    if (!offer) throw new Error("Offer not found");
    if (!offer.offer_url) throw new Error("להצעה אין קישור (offer_url) — לא ניתן לנתח.");

    await sb.from("offers").update({ ingestion_status: "running" }).eq("id", offerId);

    try {
      // 1. Fetch the page
      const res = await fetch(offer.offer_url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,*/*",
          "Accept-Language": "he-IL,he;q=0.9,en;q=0.7",
        },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
      const html = await res.text();
      const metaBlock = extractMeta(html);
      const bodyText = stripHtml(html);
      const combined = [metaBlock, bodyText].filter(Boolean).join("\n\n").slice(0, 18000);
      if (combined.replace(/\s+/g, "").length < 20) {
        throw new Error("לא הצלחנו לחלץ תוכן מהדף (יתכן דף JS דינמי או חסום). ודאו שה-URL נגיש ציבורית.");
      }

      // 2. Call Lovable AI Gateway
      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

      const userPrompt = `כותרת ההצעה: ${offer.title}
תיאור פנימי: ${offer.description ?? "(אין)"}
קטגוריה: ${offer.category ?? "(אין)"}
מחיר במערכת: ${offer.price ?? "(אין)"} ${offer.price ? (offer as any).currency ?? "ILS" : ""}
URL מקור: ${offer.offer_url}

תוכן הדף (מטא + טקסט נקי מ-HTML):
"""
${combined}
"""

הפק את ה-JSON לפי המבנה שהוגדר.`;

      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        if (aiRes.status === 429) throw new Error("מכסת AI חרגה — נסו שוב בעוד דקה.");
        if (aiRes.status === 402) throw new Error("נדרש תשלום ל-Lovable AI workspace.");
        throw new Error(`AI Gateway ${aiRes.status}: ${errText.slice(0, 300)}`);
      }

      const aiJson = await aiRes.json();
      const content: string = aiJson?.choices?.[0]?.message?.content ?? "";
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("מודל AI החזיר תוכן לא תקין (לא JSON).");
        parsed = JSON.parse(match[0]);
      }

      const update = {
        ai_summary: typeof parsed.ai_summary === "string" ? parsed.ai_summary : null,
        grounded_facts: parsed.grounded_facts ?? {},
        faq_bundle: Array.isArray(parsed.faq_bundle) ? parsed.faq_bundle : [],
        objection_notes: Array.isArray(parsed.objection_notes) ? parsed.objection_notes : [],
        sales_angle: typeof parsed.sales_angle === "string" ? parsed.sales_angle : null,
        matching_tags: Array.isArray(parsed.matching_tags)
          ? parsed.matching_tags.filter((t: unknown) => typeof t === "string")
          : [],
        escalation_boundary: parsed.escalation_boundary ?? {},
        ingestion_status: "ready",
        last_ingested_at: new Date().toISOString(),
      } as Record<string, unknown>;

      // Typed-column backfill — only set when extractable and not already set
      // by the operator. This is what lets "URL + Analyze" be enough.
      const extractedTitle = typeof parsed.extracted_title === "string" ? parsed.extracted_title.trim() : "";
      if (
        extractedTitle &&
        (!offer.title || offer.title.trim() === "" || offer.title.trim() === offer.offer_url?.trim())
      ) {
        update.title = extractedTitle.slice(0, 200);
      }

      const rawPrice = parsed.extracted_price;
      const priceNum = typeof rawPrice === "number" ? rawPrice : Number(String(rawPrice ?? "").replace(/[^\d.]/g, ""));
      if (Number.isFinite(priceNum) && priceNum > 0 && (offer.price == null)) {
        update.price = priceNum;
      }

      const curRaw = typeof parsed.extracted_currency === "string" ? parsed.extracted_currency.toUpperCase() : "";
      const curNormalized = ["ILS", "USD", "EUR"].includes(curRaw)
        ? curRaw
        : /(₪|שח|שקל|nis)/i.test(curRaw)
        ? "ILS"
        : /\$|usd|דולר/i.test(curRaw)
        ? "USD"
        : /€|eur|אירו/i.test(curRaw)
        ? "EUR"
        : "";
      if (curNormalized && (!offer.currency || offer.currency === "ILS")) {
        update.currency = curNormalized;
      }

      const parseDate = (v: unknown): string | null => {
        if (typeof v !== "string" || !v.trim()) return null;
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d.toISOString();
      };
      const evStart = parseDate(parsed.extracted_event_date);
      const evEnd = parseDate(parsed.extracted_event_end_date);
      if (evStart) update.event_date = evStart;
      if (evEnd) update.event_end_date = evEnd;

      const { error: updErr } = await sb.from("offers").update(update as any).eq("id", offerId);
      if (updErr) throw new Error(updErr.message);

      return { success: true, offerId, ...update };
    } catch (e: any) {
      await sb
        .from("offers")
        .update({ ingestion_status: `error: ${String(e?.message || e).slice(0, 200)}` })
        .eq("id", offerId);
      throw e;
    }
  });