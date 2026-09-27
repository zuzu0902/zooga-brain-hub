/** Pure audience parsing for the Campaign Manager (no sending). */
import { cleanPhone } from "./phone-bulk";

export type Recipient = { name: string; phone: string };
export type AudienceResult = { valid: Recipient[]; invalid: string[]; duplicates: number };

export const TAMAR_FOLLOW_UP_INSTRUCTION = "אם עונים בחיוב -> שלח לינק להצעה/לקבוצה.";
export const DEFAULT_OPENING_SCRIPT =
  "היי [שם], כאן תמר, העוזרת הדיגיטלית של זוגה 😊\nאנחנו קהילה שמחברת בין אנשים דרך טיולים, אירועים ומפגשים.\nאשמח לשאול כמה שאלות קצרות כדי להתאים לך הצעות שבאמת מעניינות אותך — זה בסדר מבחינתך שנדבר כאן בוואטסאפ?";

const NAME_ALIASES = ["name", "full name", "fullname", "first name", "שם", "שם מלא", "שם פרטי", "איש קשר"];
const PHONE_ALIASES = ["phone", "mobile", "phone number", "cell", "tel", "whatsapp", "טלפון", "נייד", "מספר טלפון", "פלאפון", "סלולרי", "וואטסאפ"];

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/^\ufeff/, "");

export function renderScript(script: string, name: string): string {
  return script.replace(/\[שם\]/g, name || "");
}

/** Rows as arrays; first row may be headers. */
export function parseRows(rows: unknown[][]): AudienceResult {
  const out: AudienceResult = { valid: [], invalid: [], duplicates: 0 };
  const seen = new Set<string>();
  let nameIdx = -1, phoneIdx = -1, start = 0;
  const header = (rows[0] ?? []).map(norm);
  const hp = header.findIndex((h) => PHONE_ALIASES.includes(h));
  if (hp >= 0) {
    phoneIdx = hp;
    nameIdx = header.findIndex((h) => NAME_ALIASES.includes(h));
    start = 1;
  }
  for (let i = start; i < rows.length; i++) {
    const row = (rows[i] ?? []).map((c) => String(c ?? "").trim());
    if (!row.some(Boolean)) continue;
    let phone: string | null = null;
    let name = "";
    if (phoneIdx >= 0) {
      phone = cleanPhone(row[phoneIdx] ?? "");
      name = nameIdx >= 0 ? row[nameIdx] ?? "" : "";
    } else {
      const pi = row.findIndex((c) => cleanPhone(c));
      if (pi >= 0) {
        phone = cleanPhone(row[pi]);
        name = row.filter((_, j) => j !== pi).join(" ").trim();
      }
    }
    if (!phone) { out.invalid.push(row.join(", ")); continue; }
    if (seen.has(phone)) { out.duplicates++; continue; }
    seen.add(phone);
    out.valid.push({ phone, name: name.slice(0, 80) });
  }
  return out;
}

export function parsePasted(text: string): AudienceResult {
  return parseRows(text.split(/\r?\n/).map((l) => l.split(/[,\t;]/)));
}

export function mergeResults(a: AudienceResult, b: AudienceResult): AudienceResult {
  const seen = new Set(a.valid.map((r) => r.phone));
  let dup = a.duplicates + b.duplicates;
  const valid = [...a.valid];
  for (const r of b.valid) { if (seen.has(r.phone)) dup++; else { seen.add(r.phone); valid.push(r); } }
  return { valid, invalid: [...a.invalid, ...b.invalid], duplicates: dup };
}
