/**
 * Fact audit persistence. Writes the durable audit trail and persists ONLY
 * accepted facts through the canonical `contact_profile_facts` hierarchy.
 * Truth is never duplicated: dynamic_profile_fields keeps a read-model mirror,
 * not a second source.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { auditFactBatch, type AuditSource, type ProposedFact } from "./audit";
import type { ProfileFact } from "@/lib/onboarding/types";

const db = () => supabaseAdmin as any;

export async function loadCurrentFacts(contactId: string): Promise<Record<string, ProfileFact>> {
  const { data, error } = await db()
    .from("contact_profile_facts")
    .select("field_key,value_text,explicit_or_inferred,confidence,source,source_message_id,evidence,observed_at")
    .eq("contact_id", contactId)
    .eq("is_current", true);
  if (error) throw new Error(`profile_facts_query_failed: ${error.message ?? error}`);
  const out: Record<string, ProfileFact> = {};
  for (const row of (data as any[]) ?? []) out[row.field_key] = row as ProfileFact;
  return out;
}

export async function recordFactExtraction(args: {
  contactId: string;
  proposed: ProposedFact[];
  source: AuditSource;
}): Promise<{ audited: number; accepted: number; cleared: number }> {
  if (!args.proposed.length) return { audited: 0, accepted: 0, cleared: 0 };
  const current = await loadCurrentFacts(args.contactId);
  const outcome = auditFactBatch({
    contactId: args.contactId,
    proposed: args.proposed,
    current,
    source: args.source,
  });

  if (outcome.records.length) {
    await db().from("fact_extraction_audit").insert(outcome.records);
  }

  for (const { field_key, fact } of outcome.accepted) {
    await db()
      .from("contact_profile_facts")
      .update({ is_current: false })
      .eq("contact_id", args.contactId)
      .eq("field_key", field_key)
      .eq("is_current", true);
    await db().from("contact_profile_facts").insert({
      contact_id: args.contactId,
      field_key,
      value_text: fact.value_text,
      explicit_or_inferred: fact.explicit_or_inferred,
      confidence: fact.confidence,
      source: fact.source,
      source_message_id: fact.source_message_id,
      evidence: fact.evidence,
      observed_at: fact.observed_at,
      is_current: true,
    });
  }

  // explicit corrections only: an empty proposal never clears anything
  for (const field_key of outcome.cleared) {
    await db()
      .from("contact_profile_facts")
      .update({ is_current: false })
      .eq("contact_id", args.contactId)
      .eq("field_key", field_key)
      .eq("is_current", true);
  }

  return {
    audited: outcome.records.length,
    accepted: outcome.accepted.length,
    cleared: outcome.cleared.length,
  };
}