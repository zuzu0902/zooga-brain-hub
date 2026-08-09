/**
 * DURABLE RETRY WORKER (server-only).
 *
 * Claims due jobs with an atomic lease (SKIP LOCKED inside zl_claim_jobs),
 * re-runs the exact same idempotent processing path used by the webhook and
 * moves a job to dead-letter only after max attempts. Nothing is deleted.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifyFailure } from "./core";
import { finishJob, quarantineEvent } from "./vault.server";
import { processVaultEvent } from "./processor.server";

export async function runWorker(args: { worker: string; limit?: number; leaseSeconds?: number }): Promise<{
  claimed: number;
  succeeded: number;
  failed: number;
  dead_letter: number;
  results: Array<Record<string, unknown>>;
}> {
  const { data, error } = await supabaseAdmin.rpc("zl_claim_jobs" as any, {
    p_worker: args.worker,
    p_limit: args.limit ?? 10,
    p_lease_seconds: args.leaseSeconds ?? 120,
  } as any);
  if (error) throw new Error(`claim_failed: ${error.message}`);

  const claims = ((data as any[]) ?? []);
  let succeeded = 0;
  let failed = 0;
  let dead = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const c of claims) {
    const jobId = String(c.job_id);
    const vaultId = String(c.vault_event_id);
    const attempts = Number(c.attempts) || 1;
    try {
      const outcome = await processVaultEvent({ vaultId, jobId, attempt: attempts, allowSend: false });
      await finishJob({ jobId, success: true, attempt: attempts, contactId: outcome.contact_id });
      succeeded++;
      results.push({ job: jobId, ok: true, kind: outcome.kind });
    } catch (err) {
      const reason = classifyFailure(err);
      const atMax = attempts >= (Number(c.max_attempts) || 6);
      await finishJob({ jobId, success: false, error: String((err as any)?.message ?? err), attempt: attempts });
      if (atMax) {
        dead++;
        await quarantineEvent({ vaultId, jobId: null, reason, severity: "critical", details: { attempts } });
      } else {
        failed++;
      }
      results.push({ job: jobId, ok: false, reason });
    }
  }

  return { claimed: claims.length, succeeded, failed, dead_letter: dead, results };
}