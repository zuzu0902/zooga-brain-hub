/**
 * Meta -> DB sync for the canonical whatsapp_templates table.
 * Admin mapping fields are never overwritten by a sync; templates that Meta
 * no longer returns are soft-disabled instead of deleted.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { listMetaTemplatesRaw, maskAccount } from "@/lib/whatsapp-templates.server";
import {
  diffTemplatesForSync,
  languageBase,
  normalizeLanguage,
  parseMetaTemplate,
  type TemplateRecord,
} from "./schema";

const TABLE = "whatsapp_templates" as const;

export function rowToRecord(row: any): TemplateRecord {
  return {
    id: String(row.id),
    meta_template_id: row.meta_template_id ?? null,
    name: String(row.name),
    language: String(row.language),
    language_base: String(row.language_base ?? languageBase(row.language)),
    status: String(row.status ?? "UNKNOWN").toUpperCase(),
    category: row.category ?? null,
    body_text: String(row.body_text ?? ""),
    header: row.header ?? null,
    footer_text: row.footer_text ?? null,
    buttons: Array.isArray(row.buttons) ? row.buttons : [],
    components: Array.isArray(row.components) ? row.components : [],
    variable_count: Number(row.variable_count ?? 0),
    variable_schema: Array.isArray(row.variable_schema) ? row.variable_schema : [],
    purpose: row.purpose ?? null,
    topics: Array.isArray(row.topics) ? row.topics : [],
    is_default: !!row.is_default,
    requires_active_offer: !!row.requires_active_offer,
    allowed_offer_categories: Array.isArray(row.allowed_offer_categories) ? row.allowed_offer_categories : [],
    variable_mappings: (row.variable_mappings ?? {}) as Record<string, string>,
    variable_defaults: (row.variable_defaults ?? {}) as Record<string, string>,
    is_available: row.is_available !== false,
    last_checked_at: row.last_checked_at ?? null,
    sync_error: row.sync_error ?? null,
  };
}

export async function listStoredTemplates(): Promise<TemplateRecord[]> {
  const { data } = await supabaseAdmin.from(TABLE as any).select("*").order("name");
  return ((data as any[]) ?? []).map(rowToRecord);
}

export async function getStoredTemplate(id: string): Promise<TemplateRecord | null> {
  const { data } = await supabaseAdmin.from(TABLE as any).select("*").eq("id", id).maybeSingle();
  return data ? rowToRecord(data) : null;
}

export type SyncResult = {
  ok: boolean;
  error: string | null;
  account: string | null;
  checked_at: string;
  upserted: number;
  soft_disabled: number;
  templates: { name: string; language: string; status: string; category: string | null }[];
};

/** Safe upsert. Never deletes, never touches admin mapping columns. */
export async function syncWhatsAppTemplates(opts: { force?: boolean } = {}): Promise<SyncResult> {
  const lookup = await listMetaTemplatesRaw({ force: opts.force ?? true });
  const checked_at = lookup.fetched_at;
  if (!lookup.ok) {
    await supabaseAdmin
      .from(TABLE as any)
      .update({ sync_error: lookup.error, last_checked_at: checked_at } as any)
      .neq("id", "00000000-0000-0000-0000-000000000000");
    return {
      ok: false,
      error: lookup.error,
      account: lookup.account,
      checked_at,
      upserted: 0,
      soft_disabled: 0,
      templates: [],
    };
  }

  const parsed = lookup.raw.map(parseMetaTemplate).filter((t) => t.name);
  const { data: storedRows } = await supabaseAdmin.from(TABLE as any).select("id, name, language, is_available");
  const stored = ((storedRows as any[]) ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    language: String(r.language),
    is_available: r.is_available !== false,
  }));
  const plan = diffTemplatesForSync(stored, parsed);

  let upserted = 0;
  for (const t of plan.upserts) {
    const payload = {
      meta_template_id: t.meta_template_id,
      name: t.name,
      language: t.language,
      language_base: languageBase(t.language),
      waba_masked: maskAccount(process.env.WHATSAPP_WABA_ID ?? null) ?? lookup.account,
      status: t.status,
      category: t.category,
      body_text: t.body_text,
      header: t.header,
      footer_text: t.footer_text,
      buttons: t.buttons,
      components: t.components,
      variable_count: t.variable_count,
      variable_schema: t.variable_schema,
      is_available: true,
      removed_at: null,
      last_checked_at: checked_at,
      last_synced_at: checked_at,
      sync_error: null,
    };
    const { error } = await supabaseAdmin
      .from(TABLE as any)
      .upsert(payload as any, { onConflict: "name,language" });
    if (!error) upserted++;
  }

  for (const gone of plan.softDisable) {
    await supabaseAdmin
      .from(TABLE as any)
      .update({
        is_available: false,
        removed_at: checked_at,
        last_checked_at: checked_at,
        sync_error: "not_returned_by_meta",
      } as any)
      .eq("id", gone.id);
  }

  return {
    ok: true,
    error: null,
    account: lookup.account,
    checked_at,
    upserted,
    soft_disabled: plan.softDisable.length,
    templates: parsed.map((t) => ({
      name: t.name,
      language: normalizeLanguage(t.language),
      status: t.status,
      category: t.category,
    })),
  };
}

export async function updateTemplateMapping(
  id: string,
  patch: Partial<{
    purpose: string | null;
    topics: string[];
    is_default: boolean;
    requires_active_offer: boolean;
    allowed_offer_categories: string[];
    variable_mappings: Record<string, string>;
    variable_defaults: Record<string, string>;
  }>,
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabaseAdmin.from(TABLE as any).update(patch as any).eq("id", id);
  return { ok: !error, error: error?.message ?? null };
}