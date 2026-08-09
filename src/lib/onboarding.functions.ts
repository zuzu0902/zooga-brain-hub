import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getContactOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contactId: string }) => {
    const id = String(input?.contactId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid_contact_id");
    return { contactId: id };
  })
  .handler(async ({ data }) => {
    const { getOnboardingSnapshot } = await import("@/lib/onboarding/onboarding.server");
    return getOnboardingSnapshot(data.contactId);
  });

/** Manual staff correction — always stored as an explicit fact with audit. */
export const correctContactFact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contactId: string; fieldKey: string; value: string }) => ({
    contactId: String(input?.contactId ?? "").trim(),
    fieldKey: String(input?.fieldKey ?? "").trim().slice(0, 60),
    value: String(input?.value ?? "").trim().slice(0, 300),
  }))
  .handler(async ({ data, context }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.contactId)) throw new Error("invalid_contact_id");
    if (!data.fieldKey || !data.value) throw new Error("missing_field_or_value");
    const { recordFacts } = await import("@/lib/onboarding/onboarding.server");
    return recordFacts(data.contactId, [
      {
        field_key: data.fieldKey,
        value: data.value,
        kind: "explicit",
        confidence: 100,
        source: `admin:${context.userId}`,
        evidence: "תיקון ידני במסך איש קשר",
      },
    ]);
  });

export const previewCampaignRouting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phones: string[]; optInEvidence?: boolean }) => ({
    phones: (input?.phones ?? []).map((p) => String(p)).slice(0, 500),
    optInEvidence: !!input?.optInEvidence,
  }))
  .handler(async ({ data }) => {
    const { previewSendDecisions } = await import("@/lib/onboarding/onboarding.server");
    return previewSendDecisions(data.phones, { optInEvidence: data.optInEvidence });
  });

export const getIntakeStudioConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { loadIntakeDefs, openingTemplateState } = await import("@/lib/onboarding/onboarding.server");
    const [defs, template] = await Promise.all([loadIntakeDefs(1), openingTemplateState()]);
    return { defs, template };
  });

export const saveIntakeFieldDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    field_key: string;
    label?: string;
    question_text?: string;
    purpose_text?: string | null;
    presentation?: "text" | "menu" | "multi";
    required?: boolean;
    skippable?: boolean;
    order_index?: number;
    enabled?: boolean;
    intake_version?: number;
  }) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const version = Number(data.intake_version ?? 1);
    const patch: Record<string, unknown> = { intake_version: version, field_key: data.field_key };
    for (const k of ["label", "question_text", "purpose_text", "presentation", "required", "skippable", "order_index", "enabled"] as const) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    const { error } = await (supabaseAdmin as any)
      .from("intake_field_definitions")
      .upsert(patch, { onConflict: "intake_version,field_key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });