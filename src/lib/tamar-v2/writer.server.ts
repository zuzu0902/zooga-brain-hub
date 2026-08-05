/**
 * TAMAR BRAIN V2 — grounded response wording.
 *
 * The writer never decides WHAT happens; the deterministic engine already
 * decided. It only phrases an answer to a customer question using approved
 * facts. If nothing grounds the answer, it must say so honestly.
 */
import { callStage } from "./model-registry.server";
import type { AgentVersion, SellableOffer } from "./types";

export async function writeGroundedAnswer(args: {
  agent: AgentVersion;
  message: string;
  facts: string[];
  offers: SellableOffer[];
}): Promise<string | null> {
  const id = args.agent.identity;
  const facts = args.facts.filter(Boolean).slice(0, 12);
  const catalog = args.offers
    .slice(0, 8)
    .map((o) => `- ${o.title}${o.offer_url ? ` (${o.offer_url})` : ""}${o.summary ? `: ${String(o.summary).slice(0, 200)}` : ""}`)
    .join("\n");

  const system = `את ${id.name}, ${id.role}. סגנון: ${id.tone}. תשובה קצרה (עד 3 שורות), חמה, בעברית, גוף ראשון.
כללים מוחלטים:
- מותר להסתמך רק על העובדות והמוצרים שלמטה. אין להמציא מחיר, תאריך, זמינות או פרט שלא מופיע.
- אם המידע חסר — אמרי בכנות שאין לך את זה ושאפשר לבדוק מול הצוות.
- אל תשאלי שאלה. אל תוסיפי הצעות שלא ברשימה. בלי הבטחות ובלי לחץ מכירתי.
${id.forbidden_phrases?.length ? `- ביטויים אסורים: ${id.forbidden_phrases.join(", ")}` : ""}`;

  const user = `עובדות מאושרות:
${facts.length ? facts.map((f) => `- ${f}`).join("\n") : "(אין)"}

מוצרים פתוחים למכירה:
${catalog || "(אין)"}

שאלת הלקוח: ${args.message}`;

  const res = await callStage("response_writer", [
    { role: "system", content: system },
    { role: "user", content: user },
  ], { json: false, context: "writer" });

  const text = (res.content ?? "").trim();
  return text || null;
}
