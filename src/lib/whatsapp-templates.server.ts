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
  | { ok: true; templates: TemplateInfo[] }
  | { ok: false; error: string; templates: [] };

function countVars(body: string): number {
  const found = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(m[1]!);
  return found.size;
}

async function resolveWabaId(token: string, phoneId: string): Promise<string | null> {
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
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, error: "whatsapp_credentials_missing", templates: [] };

  const wabaId = await resolveWabaId(token, phoneId);
  if (!wabaId) return { ok: false, error: "waba_id_unavailable", templates: [] };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?limit=200&fields=name,status,language,components`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: String(json?.error?.message ?? `meta_${res.status}`).slice(0, 200), templates: [] };
    }
    const templates: TemplateInfo[] = (json?.data ?? []).map((tpl: any) => {
      const body = (tpl?.components ?? []).find((c: any) => c?.type === "BODY");
      const text = String(body?.text ?? "");
      return {
        name: String(tpl?.name ?? ""),
        language: String(tpl?.language ?? ""),
        status: String(tpl?.status ?? "UNKNOWN"),
        variable_count: countVars(text),
        body_preview: text ? text.slice(0, 300) : null,
      };
    });
    return { ok: true, templates };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200), templates: [] };
  }
}

export type TemplateGate = {
  ok: boolean;
  reason: string | null;
  status: string | null;
  variable_count: number;
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
  if (!lookup.ok) {
    return { ok: false, reason: `לא ניתן לאמת את התבנית מול Meta (${lookup.error})`, status: null, variable_count: 0 };
  }
  const byName = lookup.templates.filter((t) => t.name === name);
  if (!byName.length) return { ok: false, reason: `התבנית "${name}" לא קיימת בחשבון ה-WhatsApp`, status: null, variable_count: 0 };

  const match =
    byName.find((t) => t.language === language) ??
    byName.find((t) => t.language.split("_")[0] === language.split("_")[0]);
  if (!match) {
    return {
      ok: false,
      reason: `התבנית "${name}" לא קיימת בשפה ${language} (קיימות: ${byName.map((t) => t.language).join(", ")})`,
      status: null,
      variable_count: 0,
    };
  }
  if (match.status !== "APPROVED") {
    return { ok: false, reason: `התבנית "${name}" בסטטוס ${match.status} ואינה מאושרת לשליחה`, status: match.status, variable_count: match.variable_count };
  }
  if (match.variable_count > 1) {
    return {
      ok: false,
      reason: `התבנית "${name}" דורשת ${match.variable_count} משתנים — נתמך כרגע עד משתנה אחד ({{1}}=שם פרטי)`,
      status: match.status,
      variable_count: match.variable_count,
    };
  }
  return { ok: true, reason: null, status: match.status, variable_count: match.variable_count };
}
