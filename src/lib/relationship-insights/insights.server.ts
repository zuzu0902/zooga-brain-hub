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
  // Version allocation + current-flag switching happen inside one transaction
  // with a per-contact advisory lock, so concurrent completion and manual
  // refresh can never violate the partial unique `is_current` index.
  const { data, error } = await db().rpc("ri_persist_insights", {
    p_contact_id: args.contactId,
    p_source_hash: args.hash,
    p_status: args.status,
    p_summary_he: args.payload.summary_he,
    p_sections: args.payload.sections,
    p_matching_tags: args.payload.matching_tags,
    p_missing_info: args.payload.missing_info,
    p_contradictions: args.payload.contradictions,
    p_confidence: args.payload.confidence,
    p_section_confidence: args.payload.section_confidence,
    p_answered_keys: args.answered,
    p_model_id: args.modelId,
    p_prompt_version: INSIGHTS_PROMPT_VERSION,
    p_error: args.error,
  });
  if (error) throw new Error(error.message);
  const version = Number(((data as any[]) ?? [])[0]?.version ?? 0);
  return { version, status: args.status };
}

export type GenerateResult = {
  generated: boolean;
  reason?: string;
  status?: InsightsStatus;
  version?: number;
  source_hash?: string;
};

/** Current answer hash for a contact, or null when the questionnaire is empty. */
export async function currentSourceHash(contactId: string): Promise<string | null> {
  const snapshot = await loadRelationshipAnswers(contactId);
  return answeredKeys(snapshot.answers).length ? answersSourceHash(snapshot.answers) : null;
}

/**
 * Generate insights for a contact. Idempotent by (contact_id, source_hash):
 * a duplicate trigger for the same answers is a no-op unless `force` is set.
 */
export async function generateRelationshipInsights(
  contactId: string,
  opts: { force?: boolean; expectedHash?: string } = {},
): Promise<GenerateResult> {
  const { answers, labels, ctx } = await loadContext(contactId);
  const answered = answeredKeys(answers);
  if (!answered.length) return { generated: false, reason: "no_answers" };
  const hash = answersSourceHash(answers);
  // The answers moved on while the job was queued: this job's work is obsolete
  // and a newer enqueue owns the new hash. Never burn a model call on it.
  if (opts.expectedHash && opts.expectedHash !== hash) {
    return { generated: false, reason: "stale_job", source_hash: hash };
  }

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

/**
 * Durable trigger used on questionnaire completion: enqueues a job (awaited)
 * and never throws, so completion succeeds even if the queue is unavailable.
 */
export async function triggerRelationshipInsights(contactId: string): Promise<void> {
  try {
    const { enqueueRelationshipInsights } = await import("./queue.server");
    await enqueueRelationshipInsights(contactId);
  } catch {
    /* insights must never break the questionnaire */
  }
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
  const { latestInsightJob } = await import("./queue.server");
  const job = await latestInsightJob(contactId);
  return {
    current: (data as any) ?? null,
    history: ((history as any[]) ?? []),
    stale: !!data && !!hash && data.source_hash !== hash,
    has_answers: !!hash,
    job,
  };
}