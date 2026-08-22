/**
 * CANONICAL RECONCILIATION — admin server actions (dry-run first).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("forbidden");
  return context.userId as string;
}

export const runCanonicalReconciliationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { apply?: boolean; contactIds?: string[] } | undefined) => data ?? {})
  .handler(async ({ data, context }) => {
    const userId = await assertAdmin(context);
    const { runCanonicalReconciliation } = await import("@/lib/reconciliation/reconcile.server");
    return await runCanonicalReconciliation({
      apply: !!data.apply,
      contactIds: data.contactIds,
      actorUserId: userId,
      actorLabel: "admin_ui",
    });
  });
