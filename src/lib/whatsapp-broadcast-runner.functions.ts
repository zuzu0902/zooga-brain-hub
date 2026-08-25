/**
 * Admin-gated manual trigger for the WhatsApp group broadcast runner.
 * Kept separate from the control-plane functions module so broadcast
 * creation stays free of any send path.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("forbidden");
}

export const runBroadcastNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // A manual run releases the schedule so the runner picks it up immediately.
    await (supabaseAdmin as any)
      .from("whatsapp_broadcasts")
      .update({ status: "queued", scheduled_for: null })
      .eq("id", data.id)
      .in("status", ["draft", "queued"]);
    const { runBroadcastQueue } = await import("@/lib/whatsapp-broadcast/runner.server");
    return runBroadcastQueue({ broadcastId: data.id, budgetMs: 25_000, maxTargets: 15 });
  });
