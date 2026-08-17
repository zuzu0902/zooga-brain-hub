/**
 * FACT EXTRACTION AUDIT (PURE).
 *
 * Every proposed fact — deterministic or AI — produces one durable audit
 * record: proposed value, previous value, accepted/rejected + reason,
 * confidence, source message/type/time.
 *
 * Hard rule: an empty/null proposal NEVER deletes a stored value unless the
 * customer explicitly corrected it (`correction: true`).
 */
import { mergeFact, type IncomingFact } from "@/lib/onboarding/profile-facts";
import type { ProfileFact } from "@/lib/onboarding/types";

export type ProposedFact = {
  field_key: string;
  value: string | null;
  kind: "explicit" | "inferred";
  confidence: number;
  /** the customer explicitly retracted / corrected this value */
  correction?: boolean;
  evidence?: string | null;
};

export type AuditSource = {
  source: string;
  source_message_id: string | null;
  source_type: "text" | "voice" | "interactive";
  observed_at: string;
};

export type FactAuditRecord = {
  contact_id: string;
  field_key: string;
  proposed_value: string | null;
  previous_value: string | null;
  accepted: boolean;
  reason: string;
  confidence: number;
  kind: "explicit" | "inferred";
  source: string;
  source_message_id: string | null;
  source_type: "text" | "voice" | "interactive";
  observed_at: string;
};

export type AuditOutcome = {
  records: FactAuditRecord[];
  /** facts to persist through the existing truth hierarchy */
  accepted: Array<{ field_key: string; fact: ProfileFact }>;
  /** fields the customer explicitly cleared */
  cleared: string[];
};

export function auditFactBatch(args: {
  contactId: string;
  proposed: ProposedFact[];
  current: Record<string, ProfileFact | undefined>;
  source: AuditSource;
}): AuditOutcome {
  const records: FactAuditRecord[] = [];
  const accepted: AuditOutcome["accepted"] = [];
  const cleared: string[] = [];

  for (const p of args.proposed) {
    const previous = args.current[p.field_key];
    const previous_value = previous?.value_text ?? null;
    const base = {
      contact_id: args.contactId,
      field_key: p.field_key,
      proposed_value: p.value,
      previous_value,
      confidence: Math.max(0, Math.min(100, Math.round(p.confidence))),
      kind: p.kind,
      source: args.source.source,
      source_message_id: args.source.source_message_id,
      source_type: args.source.source_type,
      observed_at: args.source.observed_at,
    };

    const empty = p.value == null || String(p.value).trim() === "";
    if (empty) {
      if (p.correction && previous_value) {
        cleared.push(p.field_key);
        records.push({ ...base, accepted: true, reason: "explicit_correction_cleared" });
      } else {
        records.push({ ...base, accepted: false, reason: "empty_value_never_deletes" });
      }
      continue;
    }

    const incoming: IncomingFact = {
      field_key: p.field_key,
      value: String(p.value),
      kind: p.kind,
      confidence: base.confidence,
      source: args.source.source,
      source_message_id: args.source.source_message_id,
      evidence: p.evidence ?? null,
      observed_at: args.source.observed_at,
    };
    // an explicit correction may overwrite an older explicit value
    const current = p.correction ? undefined : previous;
    const merged = mergeFact(current, incoming);
    if (merged.action === "reject") {
      records.push({ ...base, accepted: false, reason: merged.reason });
    } else {
      accepted.push({ field_key: p.field_key, fact: merged.fact });
      records.push({ ...base, accepted: true, reason: merged.action });
    }
  }

  return { records, accepted, cleared };
}