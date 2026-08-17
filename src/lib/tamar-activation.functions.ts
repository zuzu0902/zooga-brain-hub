import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { effectiveInstruction, resolveTopic } from "@/lib/tamar-activation/core";

const baseInput = z.object({
  contact_id: z.string().uuid(),
  topic: z.string().min(2).max(40),
  instruction: z.string().trim().max(1200).optional().default(""),
  offer_id: z.string().uuid().optional().nullable(),
  scheduled_at: z.string().datetime().optional().nullable(),
  template_id: z.string().uuid().optional().nullable(),
  template_params: z.array(z.string().max(400)).max(10).optional().nullable(),
});

export const previewTamarActivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => baseInput.parse(input))
  .handler(async ({ data }) => {
    const { previewActivation } = await import("@/lib/tamar-activation/activation.server");
    return previewActivation({
      contactId: data.contact_id,
      topic: resolveTopic(data.topic),
      instruction: effectiveInstruction(data.topic, data.instruction),
      offerId: data.offer_id ?? null,
      templateId: data.template_id ?? null,
      templateParams: data.template_params ?? null,
    });
  });

/** Templates the admin may pick for this contact + the live 24h window. */
export const listActivationTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        contact_id: z.string().uuid(),
        topic: z.string().min(2).max(40),
        offer_id: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { loadTemplatePicker } = await import("@/lib/whatsapp-templates/picker.server");
    return loadTemplatePicker({
      contactId: data.contact_id,
      topic: resolveTopic(data.topic),
      offerId: data.offer_id ?? null,
    });
  });

/** Admin: refresh the canonical template table from Meta. */
export const syncWhatsAppTemplatesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { syncWhatsAppTemplates } = await import("@/lib/whatsapp-templates/sync.server");
    return syncWhatsAppTemplates({ force: true });
  });

/** Admin: purpose/topics/offer requirements and variable mapping. */
export const updateWhatsAppTemplateMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        purpose: z.string().max(60).nullable().optional(),
        topics: z.array(z.string().max(40)).max(20).optional(),
        is_default: z.boolean().optional(),
        requires_active_offer: z.boolean().optional(),
        allowed_offer_categories: z.array(z.string().max(40)).max(20).optional(),
        variable_mappings: z.record(z.string(), z.string().max(40)).optional(),
        variable_defaults: z.record(z.string(), z.string().max(400)).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { updateTemplateMapping } = await import("@/lib/whatsapp-templates/sync.server");
    const { id, ...patch } = data;
    return updateTemplateMapping(id, patch as any);
  });

/** Creates the durable record and, when immediate, executes it at once. */
export const startTamarActivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => baseInput.extend({ preview: z.string().max(4000).optional().nullable() }).parse(input))
  .handler(async ({ data, context }) => {
    const { createActivation, executeActivation } = await import("@/lib/tamar-activation/activation.server");
    const created = await createActivation({
      contactId: data.contact_id,
      topic: resolveTopic(data.topic),
      instruction: effectiveInstruction(data.topic, data.instruction),
      offerId: data.offer_id ?? null,
      scheduledAt: data.scheduled_at ?? null,
      preview: data.preview ?? null,
      createdBy: context.userId ?? null,
      templateId: data.template_id ?? null,
      templateParams: data.template_params ?? null,
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