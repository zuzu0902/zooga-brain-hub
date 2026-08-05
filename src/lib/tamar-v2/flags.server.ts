/**
 * TAMAR BRAIN V2 — feature flags with a phone allowlist.
 * Rollout order: allowlist-only -> percentage-free full enable -> v1 removal.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { phoneVariants } from "@/lib/whatsapp-meta.server";

export async function v2Enabled(phone?: string | null): Promise<{ enabled: boolean; reason: string }> {
  const { data } = await supabaseAdmin
    .from("tamar_feature_flags" as any)
    .select("enabled,allowlist")
    .eq("key", "tamar_v2_enabled")
    .maybeSingle();
  const row: any = data ?? null;
  const allowlist: string[] = Array.isArray(row?.allowlist) ? row.allowlist.map(String) : [];
  if (allowlist.length) {
    const variants = phoneVariants(phone);
    const hit = allowlist.some((a) => variants.includes(a) || variants.includes(a.replace(/^\+/, "")) || a === phone);
    if (hit) return { enabled: true, reason: "allowlist_hit" };
    if (!row?.enabled) return { enabled: false, reason: "allowlist_miss" };
  }
  return { enabled: !!row?.enabled, reason: row?.enabled ? "flag_on" : "flag_off" };
}
