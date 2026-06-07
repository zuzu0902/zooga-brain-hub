export type CurrencyCode = "ILS" | "USD" | "EUR";

export const CURRENCIES: { code: CurrencyCode; symbol: string; label: string }[] = [
  { code: "ILS", symbol: "₪", label: "שקל (₪)" },
  { code: "USD", symbol: "$", label: "דולר ($)" },
  { code: "EUR", symbol: "€", label: "יורו (€)" },
];

export function currencySymbol(currency?: string | null): string {
  const c = CURRENCIES.find((x) => x.code === (currency || "ILS"));
  return c?.symbol ?? "₪";
}

export function formatPrice(price: number | string | null | undefined, currency?: string | null): string {
  if (price === null || price === undefined || price === "") return "";
  return `${currencySymbol(currency)}${price}`;
}