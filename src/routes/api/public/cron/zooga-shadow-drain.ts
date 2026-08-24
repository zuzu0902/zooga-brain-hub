/**
 * ZOOGA OS SHADOW TRANSPORT — scheduler-only drain endpoint.
 *
 * Auth: Authorization: Bearer <dedicated Zooga scheduler token>.
 * The raw token is never stored, logged or returned; it is hashed with SHA-256
 * server-side and verified through zooga_verify_scheduler_token_hash.
 * No customer sends, no LLM, no contact mutation, no traffic change.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Extracts the bearer token, or null when the header is missing/malformed. */
export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length >= 20 ? token : null;
}

export function hashSchedulerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const Route = createFileRoute("/api/public/cron/zooga-shadow-drain")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = extractBearerToken(request.headers.get("authorization"));
        if (!token) return json({ ok: false, error_code: "unauthorized" }, 401);

        const candidateHash = hashSchedulerToken(token);

        let authorized = false;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await (supabaseAdmin as any).rpc(
            "zooga_verify_scheduler_token_hash",
            { _candidate_hash: candidateHash },
          );
          authorized = !error && data === true;
        } catch {
          authorized = false;
        }
        if (!authorized) return json({ ok: false, error_code: "unauthorized" }, 401);

        const { drainShadowOutbox } = await import("@/lib/zooga-gateway/shadow-outbox.server");
        // Bounded retention maintenance only. No proposals, no canonical
        // results, no LLM: the comparison brain is intentionally disabled.
        const { pruneShadowRuns } = await import("@/lib/zooga-gateway/shadow-runs.server");
        try {
          const drain = await drainShadowOutbox(20);
          const pruned = await pruneShadowRuns(200);
          return json({ ok: true, ...drain, runs_pruned: pruned });
        } catch {
          return json({ ok: false, claimed: 0, delivered: 0, failed: 0, error_code: "drain_failed" }, 200);
        }
      },
    },
  },
});
