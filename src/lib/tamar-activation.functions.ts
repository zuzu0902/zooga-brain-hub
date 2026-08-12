import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const baseInput = z.object({
  contact_id: z.string().uuid(),
  topic: z.string().min(2).max(40),
  instruction: z.string().trim().min(6).max(1200),
  offer_id: z.string().uuid().optional().nullable(),
  scheduled_at: z.string().datetime().optional().nullable(),
});

export const previewTamarActivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => baseInput.parse(input))
  .handler(async ({ data }) => {
    const { previewActivation } = await import("@/lib/tamar-activation/activation.server");
    return previewActivation({
      contactId: data.contact_id,
      topic: data.topic,
      instruction: data.instruction,
      offerId: data.offer_id ?? null,
    });
  });

/** Creates the durable record and, when immediate, executes it at once. */
export const startTamarActivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => baseInput.extend({ preview: z.string().max(4000).optional().nullable() }).parse(input))
  .handler(async ({ data, context }) => {
    const { createActivation, executeActivation } = await import("@/lib/tamar-activation/activation.server");
    const created = await createActivation({
      contactId: data.contact_id,
      topic: data.topic,
      instruction: data.instruction,
      offerId: data.offer_id ?? null,
      scheduledAt: data.scheduled_at ?? null,
      preview: data.preview ?? null,
      createdBy: context.userId ?? null,
    });
    if (!created.ok || !created.activation) {
      return { ok: false, error: created.error ?? "יצירת ההפעלה נכשלה", activation: null, execution: null };
    }
    const row: any = created.activation;
    if (row.status === "scheduled") {
      return { ok: true, error: null, activation: row, execution: null };
    }
    const execution = await executeActivation(String(row.id));
    return { ok: true, error: null, activation: row, execution };
  });

export const cancelTamarActivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ activation_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { cancelActivation } = await import("@/lib/tamar-activation/activation.server");
    return cancelActivation(data.activation_id);
  });