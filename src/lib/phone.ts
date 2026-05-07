export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/[^\d+]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) {
    const digits = s.slice(1).replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return null;
    return "+" + digits;
  }
  // Israeli local: 05XXXXXXXX or 5XXXXXXXX
  const digits = s.replace(/\D/g, "");
  if (digits.startsWith("0")) {
    return "+972" + digits.slice(1);
  }
  if (digits.startsWith("972")) return "+" + digits;
  if (digits.length === 9 && digits.startsWith("5")) return "+972" + digits;
  if (digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

export function splitName(full: string | null | undefined): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = String(full).trim().split(/\s+/);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}