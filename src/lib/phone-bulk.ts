/** Pure bulk phone parser for the Intake Campaign paste box. */
export type BulkContact = { phone: string; name: string | null };
export type BulkParseResult = { valid: BulkContact[]; invalid: string[]; duplicates: number };

export function cleanPhone(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.includes("@")) return null;
  let d = s.replace(/[\s\-().+]/g, "");
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "972" + d.slice(1);
  else if (d.length === 9 && d.startsWith("5")) d = "972" + d;
  else if (!d.startsWith("972")) d = "972" + d;
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

export function parseBulk(text: string): BulkParseResult {
  const valid: BulkContact[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [rawPhone, ...rest] = line.split(/[,\t]/);
    const phone = cleanPhone(rawPhone ?? "");
    if (!phone) { invalid.push(line.trim()); continue; }
    if (seen.has(phone)) { duplicates++; continue; }
    seen.add(phone);
    const name = rest.join(" ").trim().slice(0, 80) || null;
    valid.push({ phone, name });
  }
  return { valid, invalid, duplicates };
}

export function maskPhone(p: string): string {
  if (p.length < 7) return p;
  return p.slice(0, 5) + "•".repeat(p.length - 8) + p.slice(-3);
}
