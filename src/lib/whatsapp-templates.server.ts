/**
 * Meta WhatsApp message-template introspection.
 * Used to block a campaign launch when the chosen template is not APPROVED,
 * not available in the requested language, or has a different variable count.
 * Never returns or logs a token.
 */
const GRAPH_VERSION = "v21.0";

export type TemplateInfo = {
  name: string;
  language: string;
  status: string;
  variable_count: number;
  body_preview: string | null;
};

export type TemplateLookup =
  | { ok: true; templates: TemplateInfo[]; account: string | null; fetched_at: string }
  | { ok: false; error: string; templates: []; account: string | null; fetched_at: string };

/** Never expose a full WABA id in UI copy or logs. */
export function maskAccount(id: string | null | undefined): string | null {
  const s = String(id ?? "").trim();
  if (!s) return null;
  if (s.length <= 7) return "***";
  return `${s.slice(0, 4)}***${s.slice(-3)}`;
}

const CACHE_TTL_MS = 60_000;
let _cache: { at: number; value: TemplateLookup } | null = null;

function countVars(body: string): number {
  const found = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(m[1]!);
  return found.size;
}

async function resolveWabaId(token: string, phoneId: string): Promise<string | null> {
  // Preferred: explicit WABA id. Graph v21 removed the `whatsapp_business_account`
  // field from the phone-number node, so discovery is no longer reliable.
  const explicit = String(process.env.WHATSAPP_WABA_ID ?? "").trim();
  if (explicit) return explicit;
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}?fields=whatsapp_business_account`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json: any = await res.json().catch(() => ({}));
    return json?.whatsapp_business_account?.id ?? null;
  } catch {
    return null;
  }
}

/** List every message template on the connected WABA. */
export async function listMetaTemplates(): Promise<TemplateLookup> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.value;
  const value = await fetchMetaTemplates();
  // Only a successful lookup is cached; a transient API failure must retry.
  if (value.ok) _cache = { at: Date.now(), value };
  return value;
}

async function fetchMetaTemplates(): Promise<TemplateLookup> {
  const fetched_at = new Date().toISOString();
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId)
    return { ok: false, error: "whatsapp_credentials_missing", templates: [], account: null, fetched_at };

  const wabaId = await resolveWabaId(token, phoneId);
  if (!wabaId)
    return { ok: false, error: "waba_id_unavailable_set_WHATSAPP_WABA_ID", templates: [], account: null, fetched_at };
  const account = maskAccount(wabaId);

  try {
    const templates: TemplateInfo[] = [];
    let url: string | null =
      `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?limit=200&fields=name,status,language,components`;
    let pages = 0;
    while (url && pages < 20) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: String(json?.error?.message ?? `meta_${res.status}`).slice(0, 200),
          templates: [],
          account,
          fetched_at,
        };
      }
      for (const tpl of json?.data ?? []) {
        const body = (tpl?.components ?? []).find((c: any) => c?.type === "BODY");
        const text = String(body?.text ?? "");
        templates.push({
          name: String(tpl?.name ?? ""),
          language: String(tpl?.language ?? ""),
          status: String(tpl?.status ?? "UNKNOWN"),
          variable_count: countVars(text),
          body_preview: text ? text.slice(0, 300) : null,
        });
      }
      url = json?.paging?.next ?? null;
      pages++;
    }
    return { ok: true, templates, account, fetched_at };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200), templates: [], account, fetched_at };
  }
}

export type TemplateGate = {
  ok: boolean;
  reason: string | null;
  status: string | null;
  variable_count: number;
  /** true only when Meta itself could not be reached / answered with an error */
  lookup_failed?: boolean;
  account?: string | null;
  language?: string | null;
  fetched_at?: string | null;
};

/**
 * Launch gate. Blocks unless the template exists in the requested language and
 * is APPROVED. Supports 0 or 1 body variable ({{1}} = first_name).
 */
export async function validateTemplateForLaunch(
  name: string,
  language: string,
): Promise<TemplateGate> {
  const lookup = await listMetaTemplates();
  const meta = { account: lookup.account, fetched_at: lookup.fetched_at };
  if (!lookup.ok) {
    return {
      ok: false,
      lookup_failed: true,
      reason: `לא ניתן לאמת את התבנית "${name}" מול Meta (חשבון ${lookup.account ?? "לא ידוע"}): ${lookup.error}. נדרשת בדיקת חיבור/הרשאות WhatsApp — לא בוצעה קביעה שהתבנית אינה מאושרת.`,
      status: null,
      variable_count: 0,
      language: null,
      ...meta,
    };
  }
  const byName = lookup.templates.filter((t) => t.name === name);
  if (!byName.length)
    return {
      ok: false,
      reason: `התבנית "${name}" לא נמצאה בחשבון ה-WhatsApp ${lookup.account ?? ""} (נסרקו ${lookup.templates.length} תבניות). יש לוודא שהתבנית קיימת בחשבון הזה או לעדכן את WHATSAPP_WABA_ID.`,
      status: null,
      variable_count: 0,
      language: null,
      ...meta,
    };

  const match =
    byName.find((t) => t.language.toLowerCase() === language.toLowerCase()) ??
    byName.find(
      (t) => t.language.toLowerCase().split("_")[0] === language.toLowerCase().split("_")[0],
    );
  if (!match) {
    return {
      ok: false,
      reason: `התבנית "${name}" לא קיימת בשפה ${language} (קיימות: ${byName.map((t) => t.language).join(", ")})`,
      status: null,
      variable_count: 0,
      language: null,
      ...meta,
    };
  }
  if (match.status.toUpperCase() !== "APPROVED") {
    return {
      ok: false,
      reason: `התבנית "${name}" (${match.language}) בחשבון ${lookup.account ?? ""} בסטטוס ${match.status} ואינה מאושרת לשליחה — נדרש אישור במטא.`,
      status: match.status,
      variable_count: match.variable_count,
      language: match.language,
      ...meta,
    };
  }
  if (match.variable_count > 1) {
    return {
      ok: false,
      reason: `התבנית "${name}" דורשת ${match.variable_count} משתנים — נתמך כרגע עד משתנה אחד ({{1}}=שם פרטי)`,
      status: match.status,
      variable_count: match.variable_count,
      language: match.language,
      ...meta,
    };
  }
  return {
    ok: true,
    reason: null,
    status: match.status,
    variable_count: match.variable_count,
    language: match.language,
    ...meta,
  };
}
