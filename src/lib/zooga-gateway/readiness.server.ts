/**
 * ZOOGA OS — SYSTEM READINESS (server-only, READ-ONLY).
 *
 * Aggregate counts only. No writes, no sends, no LLM call, no secret read.
 * Everything is best-effort: a failure degrades to the safe empty projection.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveTenantId } from "./shadow-outbox.server";
import {
  EMPTY_READINESS,
  collectInvalidCanonicalActions,
  isBrainProposalAction,
  sanitizeReadiness,
  type ZoogaReadiness,
} from "./readiness";

const TENANT_SLUG = "zooga";
const RUN_SCAN_CAP = 2000;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

async function headCount(table: string, tenantId: string | null): Promise<number> {
  try {
    let q = supabaseAdmin.from(table as any).select("*", { count: "exact", head: true });
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { count, error } = await q;
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

export async function getZoogaReadiness(): Promise<ZoogaReadiness> {
  try {
    const tenantId = await resolveTenantId();

    const [tenantsRes, auditTotal, auditRecent, memories, history, traces, runsRes] = await Promise.all([
      supabaseAdmin.from("tenants" as any).select("slug, status").limit(50),
      headCount("zooga_audit_events", tenantId),
      (async () => {
        try {
          const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
          let q = supabaseAdmin
            .from("zooga_audit_events" as any)
            .select("*", { count: "exact", head: true })
            .gte("created_at", since);
          if (tenantId) q = q.eq("tenant_id", tenantId);
          const { count, error } = await q;
          return error ? 0 : (count ?? 0);
        } catch {
          return 0;
        }
      })(),
      headCount("contact_memories", null),
      headCount("contact_profile_history", null),
      headCount("tamar_decision_traces", null),
      (async () => {
        try {
          let q = supabaseAdmin
            .from("zooga_shadow_runs" as any)
            .select("canonical_action")
            .limit(RUN_SCAN_CAP);
          if (tenantId) q = q.eq("tenant_id", tenantId);
          const { data, error } = await q;
          return error || !Array.isArray(data) ? [] : (data as any[]);
        } catch {
          return [] as any[];
        }
      })(),
    ]);

    const tenantRows = Array.isArray(tenantsRes.data) ? (tenantsRes.data as any[]) : [];
    const currentSlug = tenantRows.find((r) => r?.slug === TENANT_SLUG)?.slug ?? null;

    const actions = runsRes.map((r) => r?.canonical_action);
    const invalid = actions.filter((a) => typeof a === "string" && a.trim() && !isBrainProposalAction(a));

    return sanitizeReadiness({
      // Lovable holds no positive capability signal for a Gateway-side executor.
      brain_executor: "not_verified",
      tenants: {
        total: tenantRows.length,
        current_slug: currentSlug,
        isolation_enforced: !!tenantId && tenantRows.length >= 1,
      },
      memory: {
        contact_memories: memories,
        profile_history: history,
        decision_traces: traces,
        audit_events: auditTotal,
        audit_events_recent: auditRecent,
        available: memories + history + traces + auditTotal > 0,
      },
      contract: {
        checked_runs: runsRes.length,
        invalid_canonical_actions: invalid.length,
        invalid_action_samples: collectInvalidCanonicalActions(invalid),
      },
    });
  } catch {
    return sanitizeReadiness(EMPTY_READINESS);
  }
}
