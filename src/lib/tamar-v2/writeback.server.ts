/**
 * TAMAR BRAIN V2 — idempotent CRM + memory writeback (server-only).
 *
 * Exactly ONE writeback per inbound message id (ledger row with a unique
 * key). A retry of the same wamid finds the ledger row and writes nothing:
 * no duplicate facts, memories, history rows or insights.
 *
 * Truth hierarchy is delegated to the canonical fact-audit pipeline, so an
 * inferred value can never overwrite an explicit one.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordFactExtraction } from "@/lib/fact-audit/persist.server";
import { planWriteback, writebackKey, type WritebackPlan } from "./writeback";
import type { Interpretation } from "./types";

const db = () => supabaseAdmin as any;

export type WritebackResult = {
  skipped: boolean;
  reason: string;
  facts_written: number;
  memories_written: number;
  insights_written: number;
  summary: string | null;
};

/** Claim the ledger row. Returns false when this inbound was already written. */
async function claim(args: { contactId: string; key: string }): Promise<boolean> {
  const { data, error } = await db()
    .from("tamar_writeback_ledger")
    .upsert(
      {
        contact_id: args.contactId,
        inbound_message_id: args.key,
        runtime: "tamar_v2",
      },
      { onConflict: "inbound_message_id,runtime", ignoreDuplicates: true },
    )
    .select("id");
  if (error) return false;
  return Array.isArray(data) ? data.length > 0 : !!data;
}

/** Upsert one durable memory: same key + same value is a no-op. */
async function upsertMemory(args: {
  contactId: string;
  key: string;
  type: string;
  value: string;
  confidence: number;
  sourceInboundId: string;
}): Promise<"inserted" | "updated" | "unchanged"> {
  const { data } = await db()
    .from("contact_memories")
    .select("id,memory_value,confidence_score")
    .eq("contact_id", args.contactId)
    .eq("memory_key", args.key)
    .limit(1);
  const existing = ((data as any[]) ?? [])[0];
  if (existing && String(existing.memory_value ?? "") === args.value) return "unchanged";
  if (existing) {
    // current/superseded semantics: one CURRENT row per key, the previous
    // value is preserved in the profile-history ledger by the caller.
    await db()
      .from("contact_memories")
      .update({
        memory_value: args.value,
        memory_type: args.type,
        confidence_score: args.confidence,
        extracted_from: args.sourceInboundId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return "updated";
  }
  await db().from("contact_memories").insert({
    contact_id: args.contactId,
    memory_key: args.key,
    memory_type: args.type,
    memory_value: args.value,
    confidence_score: args.confidence,
    extracted_from: args.sourceInboundId,
  });
  return "inserted";
}

export async function applyWriteback(args: {
  contactId: string;
  inboundMessageId?: string | null;
  message: string;
  interpretation: Interpretation;
  capturedFields?: Record<string, string>;
  previousSummary?: string | null;
  outboundText?: string | null;
  sourceType?: "text" | "voice" | "interactive";
}): Promise<WritebackResult> {
  const plan: WritebackPlan = planWriteback({
    message: args.message,
    interpretation: args.interpretation,
    capturedFields: args.capturedFields,
    previousSummary: args.previousSummary,
    outboundText: args.outboundText,
  });
  const key = writebackKey({
    inboundMessageId: args.inboundMessageId ?? null,
    contactId: args.contactId,
    message: args.message,
  });

  const claimed = await claim({ contactId: args.contactId, key }).catch(() => false);
  if (!claimed) {
    return { skipped: true, reason: "already_written", facts_written: 0, memories_written: 0, insights_written: 0, summary: plan.summary };
  }

  let facts_written = 0;
  let memories_written = 0;
  let insights_written = 0;

  // ---- explicit facts through the canonical truth hierarchy --------------
  const before: Record<string, string | null> = {};
  if (plan.facts.length) {
    try {
      const { data } = await db()
        .from("contact_profile_facts")
        .select("field_key,value_text")
        .eq("contact_id", args.contactId)
        .eq("is_current", true);
      for (const r of ((data as any[]) ?? [])) before[String(r.field_key)] = r.value_text ?? null;
    } catch { /* history is best-effort */ }

    const res = await recordFactExtraction({
      contactId: args.contactId,
      proposed: plan.facts,
      source: {
        source: "tamar_v2",
        source_message_id: key,
        source_type: args.sourceType ?? "text",
        observed_at: new Date().toISOString(),
      },
    }).catch(() => ({ audited: 0, accepted: 0, cleared: 0 }));
    facts_written = res.accepted;

    // profile history for every value that actually changed
    for (const f of plan.facts) {
      const old = before[f.field_key] ?? null;
      if (!f.value || old === f.value) continue;
      try {
        await db().from("contact_profile_history").insert({
          contact_id: args.contactId,
          field_name: f.field_key,
          old_value: old,
          new_value: f.value,
          changed_by: "tamar_v2",
          confidence_score: Math.round(f.confidence),
          source: "tamar_v2_writeback",
        });
      } catch { /* ignore */ }
    }
  }

  // ---- durable memories ---------------------------------------------------
  for (const m of plan.memories) {
    const out = await upsertMemory({
      contactId: args.contactId,
      key: m.memory_key,
      type: m.memory_type,
      value: m.memory_value,
      confidence: m.confidence_score,
      sourceInboundId: key,
    }).catch(() => "unchanged" as const);
    if (out !== "unchanged") memories_written++;
  }

  // ---- inferred / low confidence -> internal pending insights only -------
  for (const i of plan.insights) {
    try {
      const { data } = await db()
        .from("pending_ai_insights")
        .select("id")
        .eq("contact_id", args.contactId)
        .eq("field_name", i.field_name)
        .eq("status", "pending")
        .limit(1);
      if (((data as any[]) ?? []).length) continue;
      await db().from("pending_ai_insights").insert({
        contact_id: args.contactId,
        category: i.category,
        field_name: i.field_name,
        proposed_value: i.proposed_value,
        confidence_score: i.confidence_score,
        reasoning: i.reasoning,
        source_message: key,
        status: "pending",
      });
      insights_written++;
    } catch { /* ignore */ }
  }

  try {
    await db()
      .from("tamar_writeback_ledger")
      .update({
        facts_written,
        memories_written,
        insights_written,
        summary_updated: !!plan.summary,
        details: { fact_keys: plan.facts.map((f) => f.field_key), memory_keys: plan.memories.map((m) => m.memory_key) },
      })
      .eq("inbound_message_id", key)
      .eq("runtime", "tamar_v2");
  } catch { /* ledger stats are advisory */ }

  return { skipped: false, reason: "written", facts_written, memories_written, insights_written, summary: plan.summary };
}
