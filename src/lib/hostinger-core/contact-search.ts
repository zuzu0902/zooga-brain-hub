/** Browser-safe helpers for the operator contacts list (no I/O). */

/** Display name: existing full_name, else combined first/last name, else null. */
export function contactDisplayName(c: any): string | null {
  const full = typeof c?.full_name === "string" ? c.full_name.trim() : "";
  if (full) return full;
  const combined = [c?.first_name, c?.last_name]
    .filter((x) => typeof x === "string" && x.trim())
    .map((x: string) => x.trim())
    .join(" ");
  return combined || null;
}

/** Digit-only phone variants: international (972…) and Israeli local (0…). */
export function phoneVariants(raw: unknown): string[] {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return [];
  const out = new Set<string>([d]);
  let national: string | null = null;
  if (d.startsWith("00972")) national = d.slice(5);
  else if (d.startsWith("972")) national = d.slice(3);
  else if (d.startsWith("0")) national = d.slice(1);
  if (national) {
    out.add(national);
    out.add("972" + national);
    out.add("0" + national);
  }
  return [...out];
}

/** Normalize a phone-like query to comparable digits (strips +, 00, 972, leading 0). */
function queryDigitForms(q: string): string[] {
  const d = q.replace(/\D/g, "");
  if (!d) return [];
  return phoneVariants(d);
}

export function contactMatchesSearch(c: any, query: string, extraText: string[] = []): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    contactDisplayName(c), c?.full_name, c?.first_name, c?.last_name,
    c?.phone, c?.email, c?.city, ...extraText,
  ].filter(Boolean).join(" ").toLowerCase();
  if (hay.includes(q)) return true;
  // Phone-like query: compare digit forms against phone variants.
  if (/^[\d\s+\-().]+$/.test(q)) {
    const forms = queryDigitForms(q).filter((f) => f.length >= 2);
    if (!forms.length) return false;
    const phones = phoneVariants(c?.phone);
    return phones.some((p) => forms.some((f) => p.includes(f)));
  }
  return false;
}

export function compareContactNames(a: any, b: any): number {
  return (contactDisplayName(a) || "").localeCompare(contactDisplayName(b) || "", "he");
}
