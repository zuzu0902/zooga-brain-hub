/**
 * Canonical WhatsApp template model — pure logic.
 *
 * Meta status is the only authority for whether a template may be sent. This
 * module parses Meta's component payload into a stable record, decides which
 * templates may be offered for a given topic/offer, auto-fills known
 * parameters and validates the exact variable count and order. It never
 * performs network or database access, so both the preview and the send path
 * can run it identically.
 */

export type TemplateButton = { type: string; text: string; url: string | null };

export type TemplateVariable = { index: number; key: string | null; example: string | null };

export type ParsedTemplate = {
  meta_template_id: string | null;
  name: string;
  language: string;
  language_base: string;
  status: string;
  category: string | null;
  body_text: string;
  header: { format: string; text: string | null } | null;
  footer_text: string | null;
  buttons: TemplateButton[];
  components: any[];
  variable_count: number;
  variable_schema: TemplateVariable[];
};

export type TemplateMapping = {
  purpose: string | null;
  topics: string[];
  is_default: boolean;
  requires_active_offer: boolean;
  allowed_offer_categories: string[];
  variable_mappings: Record<string, string>;
  variable_defaults: Record<string, string>;
};

export type TemplateRecord = ParsedTemplate &
  TemplateMapping & {
    id: string;
    is_available: boolean;
    last_checked_at: string | null;
    sync_error: string | null;
  };

/** Reserved for the consent opening only — never a follow-up template. */
export const RESERVED_TEMPLATE_NAMES = ["zooga_opening_consent"];
export const CONSENT_PURPOSE = "consent_opening";

export function normalizeLanguage(lang: string | null | undefined): string {
  return String(lang ?? "").trim().replace(/-/g, "_").toLowerCase();
}

export function languageBase(lang: string | null | undefined): string {
  return normalizeLanguage(lang).split("_")[0] ?? "";
}

export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeLanguage(a);
  const nb = normalizeLanguage(b);
  if (!na || !nb) return false;
  return na === nb || languageBase(na) === languageBase(nb);
}

function variableIndexes(text: string): number[] {
  const found = new Set<number>();
  for (const m of String(text ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

/** Meta's raw template payload → the canonical record we store. */
export function parseMetaTemplate(raw: any): ParsedTemplate {
  const components: any[] = Array.isArray(raw?.components) ? raw.components : [];
  const body = components.find((c) => String(c?.type).toUpperCase() === "BODY");
  const headerC = components.find((c) => String(c?.type).toUpperCase() === "HEADER");
  const footerC = components.find((c) => String(c?.type).toUpperCase() === "FOOTER");
  const buttonsC = components.find((c) => String(c?.type).toUpperCase() === "BUTTONS");
  const body_text = String(body?.text ?? "");
  const indexes = variableIndexes(body_text);
  const examples: string[] = body?.example?.body_text?.[0] ?? [];
  const language = String(raw?.language ?? "");
  return {
    meta_template_id: raw?.id != null ? String(raw.id) : null,
    name: String(raw?.name ?? ""),
    language,
    language_base: languageBase(language),
    status: String(raw?.status ?? "UNKNOWN").toUpperCase(),
    category: raw?.category ? String(raw.category).toUpperCase() : null,
    body_text,
    header: headerC
      ? { format: String(headerC.format ?? "TEXT").toUpperCase(), text: headerC.text ? String(headerC.text) : null }
      : null,
    footer_text: footerC?.text ? String(footerC.text) : null,
    buttons: Array.isArray(buttonsC?.buttons)
      ? buttonsC.buttons.map((b: any) => ({
          type: String(b?.type ?? "").toUpperCase(),
          text: String(b?.text ?? ""),
          url: b?.url ? String(b.url) : null,
        }))
      : [],
    components,
    variable_count: indexes.length,
    variable_schema: indexes.map((i, pos) => ({
      index: i,
      key: null,
      example: examples[pos] != null ? String(examples[pos]) : null,
    })),
  };
}

/** Sync plan: which templates to upsert and which stored ones Meta no longer has. */
export function diffTemplatesForSync(
  stored: { id: string; name: string; language: string; is_available: boolean }[],
  fromMeta: ParsedTemplate[],
): { upserts: ParsedTemplate[]; softDisable: { id: string; name: string; language: string }[] } {
  const key = (n: string, l: string) => `${n}|${normalizeLanguage(l)}`;
  const live = new Set(fromMeta.map((t) => key(t.name, t.language)));
  return {
    upserts: fromMeta,
    softDisable: stored
      .filter((s) => s.is_available && !live.has(key(s.name, s.language)))
      .map((s) => ({ id: s.id, name: s.name, language: s.language })),
  };
}

export type TemplateContext = {
  topic: string;
  language?: string | null;
  offerSellable?: boolean;
  offerCategory?: string | null;
  /** true only for the consent-opening flow */
  consentOpening?: boolean;
};

/** null = usable. Otherwise an exact Hebrew reason, never a silent disable. */
export function templateBlockReason(t: TemplateRecord, ctx: TemplateContext): string | null {
  if (!t.is_available)
    return `התבנית "${t.name}" אינה קיימת יותר בחשבון ה-WhatsApp`;
  if (t.status !== "APPROVED")
    return `התבנית "${t.name}" (${t.language}) בסטטוס ${t.status} במטא ואינה מאושרת לשליחה`;
  if (ctx.language && !sameLanguage(t.language, ctx.language))
    return `התבנית "${t.name}" אינה בשפה ${ctx.language}`;
  const reserved = RESERVED_TEMPLATE_NAMES.includes(t.name) || t.purpose === CONSENT_PURPOSE;
  if (reserved && !ctx.consentOpening)
    return "תבנית פתיחת ההסכמה אינה מיועדת לשיחות המשך";
  if (!reserved && ctx.consentOpening)
    return "לפתיחת הסכמה יש להשתמש בתבנית ההסכמה בלבד";
  if (!ctx.consentOpening && !(t.topics.includes(ctx.topic) || t.purpose === ctx.topic))
    return `התבנית "${t.name}" אינה משויכת למטרה "${ctx.topic}" — יש לשייך אותה במסך ניהול התבניות`;
  if (t.requires_active_offer && !ctx.offerSellable)
    return `התבנית "${t.name}" דורשת פעילות פעילה למכירה`;
  if (t.allowed_offer_categories.length && ctx.offerCategory && !t.allowed_offer_categories.includes(ctx.offerCategory))
    return `התבנית "${t.name}" אינה מותרת לקטגוריית המוצר "${ctx.offerCategory}"`;
  return null;
}

export function eligibleTemplates(list: TemplateRecord[], ctx: TemplateContext): TemplateRecord[] {
  return list
    .filter((t) => templateBlockReason(t, ctx) === null)
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
}

export type AutofillSource = {
  firstName?: string | null;
  contactName?: string | null;
  offerTitle?: string | null;
  offerUrl?: string | null;
  offerDate?: string | null;
};

const FALLBACK_NAME = "חבר/ה יקר/ה";

function autofillValue(key: string | null, src: AutofillSource): string {
  switch (key) {
    case "first_name":
      return String(src.firstName ?? "").trim().split(/\s+/)[0] || FALLBACK_NAME;
    case "contact_name":
      return String(src.contactName ?? src.firstName ?? "").trim() || FALLBACK_NAME;
    case "offer_title":
      return String(src.offerTitle ?? "").trim();
    case "offer_url":
      return String(src.offerUrl ?? "").trim();
    case "offer_date":
      return String(src.offerDate ?? "").trim();
    default:
      return "";
  }
}

/** Ordered parameters, mapping first, then admin defaults; {{1}} defaults to the first name. */
export function autofillParams(t: TemplateRecord, src: AutofillSource): string[] {
  return t.variable_schema.map((v) => {
    const idx = String(v.index);
    const mapped = t.variable_mappings?.[idx] ?? (v.index === 1 ? "first_name" : null);
    const value = autofillValue(mapped, src);
    if (value) return value;
    const fallback = t.variable_defaults?.[idx];
    return fallback ? String(fallback) : "";
  });
}

export type ParamValidation = {
  ok: boolean;
  missing: number[];
  extra: number;
  reason_he: string | null;
  params: string[];
};

/** Exact count and order. Missing, extra or blank parameters block the send. */
export function validateTemplateParams(t: TemplateRecord, params: string[] | null | undefined): ParamValidation {
  const list = Array.isArray(params) ? params.map((p) => String(p ?? "").trim()) : [];
  const missing = t.variable_schema
    .map((v, i) => (list[i] ? null : v.index))
    .filter((v): v is number => v !== null);
  const extra = Math.max(0, list.length - t.variable_count);
  if (missing.length)
    return {
      ok: false,
      missing,
      extra,
      params: list,
      reason_he: `חסרים ערכים למשתני התבנית "${t.name}": ${missing.map((i) => `{{${i}}}`).join(", ")}`,
    };
  if (extra > 0)
    return {
      ok: false,
      missing,
      extra,
      params: list,
      reason_he: `לתבנית "${t.name}" נדרשים ${t.variable_count} משתנים בדיוק — התקבלו ${list.length}`,
    };
  return { ok: true, missing: [], extra: 0, params: list, reason_he: null };
}

/** Exact body preview with the parameters substituted in order. */
export function renderTemplateBody(t: Pick<TemplateRecord, "body_text">, params: string[]): string {
  return String(t.body_text ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, d) => {
    const v = params[Number(d) - 1];
    return v == null || v === "" ? `{{${d}}}` : v;
  });
}

/** Full rendered preview, header + body + footer + buttons, as the customer sees it. */
export function renderTemplatePreview(t: TemplateRecord, params: string[]): string {
  const parts: string[] = [];
  if (t.header?.text) parts.push(t.header.text);
  parts.push(renderTemplateBody(t, params));
  if (t.footer_text) parts.push(t.footer_text);
  if (t.buttons.length) parts.push(t.buttons.map((b) => `[${b.text}]`).join(" "));
  return parts.filter(Boolean).join("\n");
}

/** Meta send components for the ordered body parameters. */
export function buildTemplateComponents(params: string[]): any[] {
  if (!params.length) return [];
  return [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }];
}

/** Stable signature: any change to selection or parameters invalidates a preview. */
export function templateSelectionSignature(args: {
  templateId: string | null;
  topic: string;
  offerId: string | null;
  params: string[];
}): string {
  return [args.templateId ?? "none", args.topic, args.offerId ?? "no-offer", args.params.join("|")].join("::");
}