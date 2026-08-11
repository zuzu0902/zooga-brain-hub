/**
 * RELATIONSHIP AI INSIGHTS — durable job queue (server-only).
 *
 * Enqueue is transactional and idempotent by (contact_id, source_hash) while a
 * job is open, so a terminated request never loses the work and a duplicate
 * trigger never causes a second model call. Execution happens in the shared
 * job drain (cron worker endpoint) using the existing lease / retry / backoff /
 * dead-letter conventions.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = () => supabaseAdmin as any;

export type EnqueueResult = {
  enqueued: boolean;
  duplicate: boolean;
  job_id: string | null;
  source_hash: string | null;
  reason?: string;
};

/** Backoff mirrors the zero-loss worker: 60s, 120s, 240s… capped at 15 min. */
export function insightsBackoffSeconds(attempt: number): number {
  return Math.min(60 * Math.pow(2, Math.max(0, attempt - 1)), 900);
}

/**
 * Durable enqueue. Awaited by callers, so the row exists before the request
 * returns; there is no un-awaited promise anywhere on this path.
 */
export async function enqueueRelationshipInsights(
  contactId: string,
  opts: { force?: boolean; requestedBy?: string | null } = {},
): Promise<EnqueueResult> {
  const { currentSourceHash } = await import("./insights.server");
  const hash = await currentSourceHash(contactId);
  if (!hash) return { enqueued: false, duplicate: false, job_id: null, source_hash: null, reason: "no_answers" };

  const { data, error } = await db().rpc("ri_enqueue_insight_job", {
    p_contact_id: contactId,
    p_source_hash: hash,
    p_force: !!opts.force,
    p_requested_by: opts.requestedBy ?? null,
  });
  if (error) throw new Error(`insights_enqueue_failed: ${error.message}`);
  const row = ((data as any[]) ?? [])[0] ?? {};
  return {
    enqueued: true,
    duplicate: !!row.duplicate,
    job_id: row.job_id ?? null,
    source_hash: hash,
  };
}

export type InsightsJobClaim = {
  job_id: string;
  contact_id: string;
  source_hash: string;
  force: boolean;
  attempts: number;
  max_attempts: number;
};

export async function claimInsightJobs(args: {
  worker: string;
  limit?: number;
  leaseSeconds?: number;
}): Promise<InsightsJobClaim[]> {
  const { data, error } = await db().rpc("ri_claim_insight_jobs", {
    p_worker: args.worker,
    p_limit: args.limit ?? 3,
    p_lease_seconds: args.leaseSeconds ?? 180,
  });
  if (error) throw new Error(`insights_claim_failed: ${error.message}`);
  return ((data as any[]) ?? []).map((r) => ({
    job_id: String(r.job_id),
    contact_id: String(r.contact_id),
    source_hash: String(r.source_hash),
    force: !!r.force,
    attempts: Number(r.attempts) || 1,
    max_attempts: Number(r.max_attempts) || 4,
  }));
}

export async function finishInsightJob(args: {
  jobId: string;
  success: boolean;
  error?: string | null;
  attempt?: number;
}): Promise<void> {
  await db().rpc("ri_finish_insight_job", {
    p_job_id: args.jobId,
    p_success: args.success,
    p_error: args.error ?? null,
    p_backoff_seconds: insightsBackoffSeconds(args.attempt ?? 1),
  });
}

export type InsightsWorkerReport = {
  claimed: number;
  succeeded: number;
  failed: number;
  dead_letter: number;
  results: Array<Record<string, unknown>>;
};

/**
 * Drains due insight jobs. At most one model call per claimed job, and a
 * claimed job whose answers already produced an `ok` record short-circuits
 * without calling the model at all.
 */
export async function runInsightsWorker(args: {
  worker: string;
  limit?: number;
  leaseSeconds?: number;
}): Promise<InsightsWorkerReport> {
  const claims = await claimInsightJobs(args);
  const { generateRelationshipInsights } = await import("./insights.server");
  let succeeded = 0;
  let failed = 0;
  let dead = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const c of claims) {
    try {
      const out = await generateRelationshipInsights(c.contact_id, {
        force: c.force,
        expectedHash: c.source_hash,
      });
      await finishInsightJob({ jobId: c.job_id, success: true, attempt: c.attempts });
      succeeded++;
      results.push({ job: c.job_id, ok: true, ...out });
    } catch (err) {
      const message = String((err as any)?.message ?? err);
      const atMax = c.attempts >= c.max_attempts;
      await finishInsightJob({ jobId: c.job_id, success: false, error: message, attempt: c.attempts });
      if (atMax) dead++;
      else failed++;
      results.push({ job: c.job_id, ok: false, error: message, dead_letter: atMax });
    }
  }

  return { claimed: claims.length, succeeded, failed, dead_letter: dead, results };
}

/** Latest job for a contact — drives the queued/running/failed UI badge. */
export async function latestInsightJob(contactId: string) {
  const { data } = await db()
    .from("relationship_insight_jobs")
    .select("id,state,attempts,max_attempts,source_hash,force,last_error,next_attempt_at,created_at,updated_at")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data as any[]) ?? [])[0] ?? null;
}