/**
 * RELATIONSHIP AI INSIGHTS — admin-only server functions.
 * Never customer facing, never sends WhatsApp.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole } from "@/lib/relationship-insights/authz";

const UUID = /^[0-9a-f-]{36}$/i;

const assertAdmin = assertAdminRole;

function contactInput(input: { contactId: string }) {
  const id = String(input?.contactId ?? "").trim();
  if (!UUID.test(id)) throw new Error("invalid_contact_id");
  return { contactId: id };
}

export const getRelationshipInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(contactInput)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { getCurrentInsights } = await import("@/lib/relationship-insights/insights.server");
    return getCurrentInsights(data.contactId);
  });

export const refreshRelationshipInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(contactInput)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { getCurrentInsights } = await import("@/lib/relationship-insights/insights.server");
    const { enqueueRelationshipInsights, runInsightsWorker } = await import(
      "@/lib/relationship-insights/queue.server"
    );
    // Durable first: the forced job is committed before anything else, so the
    // refresh survives a terminated request. Then drain inline (awaited) so the
    // admin normally sees the result in the same response.
    const enqueued = await enqueueRelationshipInsights(data.contactId, {
      force: true,
      requestedBy: context.userId,
    });
    let drain: { claimed: number; succeeded: number; failed: number; dead_letter: number } | null = null;
    if (enqueued.enqueued) {
      try {
        const report = await runInsightsWorker({ worker: `admin-refresh`, limit: 1, leaseSeconds: 180 });
        drain = {
          claimed: report.claimed,
          succeeded: report.succeeded,
          failed: report.failed,
          dead_letter: report.dead_letter,
        };
      } catch {
        /* the queued job stays due and the shared drain retries it */
      }
    }
    return { result: { enqueued, drain }, ...(await getCurrentInsights(data.contactId)) };
  });