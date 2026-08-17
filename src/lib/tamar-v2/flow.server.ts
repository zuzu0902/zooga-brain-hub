/**
 * TAMAR BRAIN V2 — loading the active agent version (identity, safety, flow).
 * Everything here is admin-editable data, not code.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_IDENTITY,
  DEFAULT_SAFETY,
  type AgentVersion,
  type FlowStep,
  type SellableOffer,
} from "./types";

export async function loadAgentVersion(versionId?: string | null): Promise<AgentVersion> {
  let q = supabaseAdmin.from("tamar_agent_versions" as any).select("*");
  q = versionId ? q.eq("id", versionId) : q.eq("status", "active");
  const { data: ver } = await q.order("version", { ascending: false }).limit(1).maybeSingle();
  const row: any = ver ?? null;

  const steps: FlowStep[] = [];
  if (row?.id) {
    const { data: stepRows } = await supabaseAdmin
      .from("tamar_flow_steps" as any)
      .select("*")
      .eq("agent_version_id", row.id)
      .order("order_index", { ascending: true });
    const ids = ((stepRows as any[]) ?? []).map((s) => s.id);
    const { data: optRows } = ids.length
      ? await supabaseAdmin.from("tamar_flow_options" as any).select("*").in("step_id", ids)
      : { data: [] as any[] };
    for (const s of ((stepRows as any[]) ?? [])) {
      steps.push({
        step_key: s.step_key,
        field_key: s.field_key ?? null,
        stage: s.stage,
        question_text: s.question_text,
        help_text: s.help_text ?? null,
        presentation: (s.presentation ?? "text") as FlowStep["presentation"],
        required: !!s.required,
        skippable: !!s.skippable,
        conditions: s.conditions ?? {},
        order_index: Number(s.order_index ?? 0),
        enabled: s.enabled !== false,
        options: ((optRows as any[]) ?? [])
          .filter((o) => o.step_id === s.id)
          .map((o) => ({
            option_id: o.option_id,
            label: o.label,
            value: o.value,
            order_index: Number(o.order_index ?? 0),
            enabled: o.enabled !== false,
          }))
          .sort((a, b) => a.order_index - b.order_index),
      });
    }
  }

  return {
    id: row?.id ?? null,
    version: Number(row?.version ?? 0),
    status: row?.status ?? "active",
    identity: { ...DEFAULT_IDENTITY, ...(row?.identity ?? {}) },
    safety: { ...DEFAULT_SAFETY, ...(row?.safety ?? {}) },
    steps,
  };
}

/** Only sellable offers may ever be recommended. */
export async function loadSellableOffers(limit = 12): Promise<SellableOffer[]> {
  // canonical catalog — same source of truth as the live engine and Lite
  const { loadCatalog } = await import("@/lib/offer-catalog/catalog.server");
  const { rows } = await loadCatalog();
  return (rows as any[]).slice(0, limit).map((o) => ({
    id: o.id,
    title: o.title,
    offer_url: o.offer_url ?? null,
    summary: o.ai_summary ?? o.description ?? null,
  }));
}

/** Known intake values for a contact, keyed by flow field_key. */
export function knownFieldsFromContact(contact: any, steps: FlowStep[]): Record<string, string> {
  const known: Record<string, string> = {};
  const dyn = (contact?.dynamic_profile_fields ?? {}) as Record<string, unknown>;
  for (const s of steps) {
    const key = s.field_key ?? s.step_key;
    if (key === "consent_marketing") continue;
    const direct = contact?.[key];
    const value =
      typeof direct === "string" && direct.trim()
        ? direct
        : Array.isArray(direct) && direct.length
          ? String(direct[0])
          : dyn?.[key] != null && String(dyn[key]).trim()
            ? String(dyn[key])
            : "";
    if (value) known[key] = value;
  }
  return known;
}
