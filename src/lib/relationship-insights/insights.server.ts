/**
 * RELATIONSHIP AI INSIGHTS — server layer (admin-only, internal).
 *
 * One model call per changed answer hash. Idempotent: a hash that already
 * has a stored record is never regenerated. Never blocks the questionnaire,
 * never sends WhatsApp, never surfaces to the customer.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  loadRelationshipAnswers,
  loadRelationshipQuestions,
} from "@/lib/relationship-intake/intake.server";
import { sortedQuestions } from "@/lib/relationship-intake/questions";
import { callStage } from "@/lib/tamar-v2/model-registry.server";
import {
  INSIGHTS_PROMPT_VERSION,
  INSIGHTS_SYSTEM_PROMPT,
  answeredKeys,
  answersSourceHash,
  buildFallbackInsights,
  buildInsightsUserPrompt,
  parseInsights,
  type InsightsPayload,
  type InsightsStatus,
  type ParseContext,
} from "./core";

const db = () => supabaseAdmin as any;

async function loadContext(contactId: string) {
  const [questions, snapshot] = await Promise.all([
    loadRelationshipQuestions(),
    loadRelationshipAnswers(contactId),
  ]);
  const { data: rows } = await db()
    .from("relationship_intake_answers")
    .select("id,question_key")
    .eq("contact_id", contactId)
    .eq("is_current", true);
  const idByKey: Record<string, string> = {};
  for (const r of ((rows as any[]) ?? [])) idByKey[r.question_key] = r.id;
  const active = sortedQuestions(questions);
  const labels: Record<string, string> = {};
  for (const q of active) labels[q.question_key] = q.label;
  const missing = active
    .filter((q) => {
      const a = snapshot.answers[q.question_key];
      return !a || a.skipped_by_user || !String(a.raw_text ?? "").trim();
    })
    .map((q) => ({ question_key: q.question_key, question: q.question_text }));
  const ctx: ParseContext = {
    validKeys: new Set(Object.keys(snapshot.answers)),
    idByKey,
    missing,
  };
  return { answers: snapshot.answers, labels, ctx };
}

async function persist(args: {
  contactId: string;
  hash: string;
  status: InsightsStatus;
  payload: InsightsPayload;
  modelId: string | null;
  error: string | null;
  answered: string[];
}) {
  const { data: prev } = await db()
    .from("relationship_ai_insights")
    .select("version")
    .eq("contact_id", args.contactId)
    .order("version", { ascending: false })
    .limit(1);
  const version = Number((prev as any[])?.[0]?.version ?? 0) + 1;
  await db()
    .from("relationship_ai_insights")
    .update({ is_current: false })
    .eq("contact_id", args.contactId)
    .eq("is_current", true);
  const row = {
    contact_id: args.contactId,
    source_hash: args.hash,
    version,
    is_current: true,
    status: args.status,
    summary_he: args.payload.summary_he,
    sections: args.payload.sections,
    matching_tags: args.payload.matching_tags,
    missing_info: args.payload.missing_info,
    contradictions: args.payload.contradictions,
    confidence: args.payload.confidence,
    section_confidence: args.payload.section_confidence,
    answered_keys: args.answered,
    model_id: args.modelId,
    prompt_version: INSIGHTS_PROMPT_VERSION,
    error: args.error,
    generated_at: new Date().toISOString(),
  };
  const { error } = await db()
    .from("relationship_ai_insights")
    .upsert(row, { onConflict: "contact_id,source_hash" });
  if (error) throw new Error(error.message);
  return { version, status: args.status };
}

export type GenerateResult = {
  generated: boolean;
  reason?: string;
  status?: InsightsStatus;
  version?: number;
  source_hash?: string;
};

/**
 * Generate insights for a contact. Idempotent by (contact_id, source_hash):
 * a duplicate trigger for the same answers is a no-op unless `force` is set.
 */
export async function generateRelationshipInsights(
  contactId: string,
  opts: { force?: boolean } = {},
): Promise<GenerateResult> {
  const { answers, labels, ctx } = await loadContext(contactId);
  const answered = answeredKeys(answers);
  if (!answered.length) return { generated: false, reason: "no_answers" };
  const hash = answersSourceHash(answers);

  const { data: existing } = await db()
    .from("relationship_ai_insights")
    .select("id,status,version")
    .eq("contact_id", contactId)
    .eq("source_hash", hash)
    .maybeSingle();
  const existingOk = existing && existing.status === "ok";
  if (existing && !opts.force && existingOk) {
    return { generated: false, reason: "up_to_date", source_hash: hash, version: existing.version };
  }

  const res = await callStage(
    "relationship_insights",
    [
      { role: "system", content: INSIGHTS_SYSTEM_PROMPT },
      { role: "user", content: buildInsightsUserPrompt(answers, labels, ctx.missing) },
    ],
    { json: true, context: `relationship_insights:${contactId}` },
  );

  const parsed = res.ok ? parseInsights(res.content, ctx) : null;
  if (parsed) {
    const out = await persist({
      contactId,
      hash,
      status: "ok",
      payload: parsed,
      modelId: res.model_id,
      error: null,
      answered,
    });
    return { generated: true, ...out, source_hash: hash };
  }

  const fallback = buildFallbackInsights(answers, labels, ctx);
  const out = await persist({
    contactId,
    hash,
    status: res.ok ? "degraded" : "fallback",
    payload: fallback,
    modelId: res.model_id,
    error: res.ok ? "invalid_model_output" : res.error ?? "model_call_failed",
    answered,
  });
  return { generated: true, ...out, source_hash: hash };
}

/** Fire-and-forget trigger used on questionnaire completion. Never throws. */
export function triggerRelationshipInsights(contactId: string): void {
  void generateRelationshipInsights(contactId).catch(() => {
    /* insights must never break the questionnaire */
  });
}

export async function getCurrentInsights(contactId: string) {
  const { answers } = await loadContext(contactId);
  const hash = answeredKeys(answers).length ? answersSourceHash(answers) : null;
  const { data } = await db()
    .from("relationship_ai_insights")
    .select("*")
    .eq("contact_id", contactId)
    .eq("is_current", true)
    .maybeSingle();
  const { data: history } = await db()
    .from("relationship_ai_insights")
    .select("id,version,status,confidence,model_id,generated_at,source_hash")
    .eq("contact_id", contactId)
    .order("version", { ascending: false })
    .limit(10);
  return {
    current: (data as any) ?? null,
    history: ((history as any[]) ?? []),
    stale: !!data && !!hash && data.source_hash !== hash,
    has_answers: !!hash,
  };
}