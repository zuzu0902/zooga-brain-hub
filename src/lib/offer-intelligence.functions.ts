import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({ offerId: z.string().uuid() });

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
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
      .select("id, title, description, category, price, offer_url")
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
            "Mozilla/5.0 (compatible; ZoogaBot/1.0; +https://zooga-brain-hub.lovable.app)",
          Accept: "text/html,*/*",
        },
      });
      if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
      const html = await res.text();
      const text = stripHtml(html).slice(0, 18000);
      if (text.length < 60) throw new Error("התוכן שחולץ מהדף קצר מדי לניתוח.");

      // 2. Call Lovable AI Gateway
      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

      const userPrompt = `כותרת ההצעה: ${offer.title}
תיאור פנימי: ${offer.description ?? "(אין)"}
קטגוריה: ${offer.category ?? "(אין)"}
מחיר במערכת: ${offer.price ?? "(אין)"}
URL מקור: ${offer.offer_url}

תוכן הדף (נקי מ-HTML):
"""
${text}
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
      };

      const { error: updErr } = await sb.from("offers").update(update).eq("id", offerId);
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