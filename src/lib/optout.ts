/**
 * Inbound opt-out detection. Case-insensitive, Hebrew + English.
 * Matched as a standalone token so "אני לא רוצה להסיר את הכובע" does not trip it.
 */
const OPT_OUT_TOKENS = [
  "הסר",
  "הסירו",
  "הסירי",
  "עצור",
  "עצרו",
  "להסרה",
  "הפסק",
  "stop",
  "unsubscribe",
  "remove",
];

const OPT_IN_TOKENS = ["התחל", "start", "subscribe", "הצטרף"];

function tokens(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function isOptOutMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = tokens(text);
  if (t.length === 0 || t.length > 4) return false; // opt-out is a short command
  return t.some((w) => OPT_OUT_TOKENS.includes(w));
}

export function isOptInMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = tokens(text);
  if (t.length === 0 || t.length > 3) return false;
  return t.some((w) => OPT_IN_TOKENS.includes(w));
}

export const OPT_OUT_CONFIRMATION =
  "הוסרת מרשימת הדיוור של זוגה ולא נשלח אליך יותר תוכן שיווקי. אם תרצה לחזור — פשוט כתוב לנו \"התחל\". תודה ולהתראות 🌿";

export const OPT_IN_CONFIRMATION =
  "שמחים שחזרת! נמשיך לעדכן אותך בטיולים ובאירועים של זוגה 🌿";
