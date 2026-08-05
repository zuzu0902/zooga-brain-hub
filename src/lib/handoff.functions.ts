import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Presence-only health of the manager alert channel (no numbers, no secrets). */
export const getHandoffChannelHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { handoffChannelHealth } = await import("@/lib/tamar-handoff-core.server");
    return handoffChannelHealth();
  });

/** Manual, safe retry of a single manager alert from the console. */
export const retryHandoffAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { handoffId: string }) => {
    const id = String(input?.handoffId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid_handoff_id");
    return { handoffId: id };
  })
  .handler(async ({ data }) => {
    const { notifyManagerForHandoff } = await import("@/lib/tamar-handoff-core.server");
    return notifyManagerForHandoff(data.handoffId);
  });