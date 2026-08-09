import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f-]{36}$/i;

export const getRelationshipIntake = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contactId: string }) => {
    const id = String(input?.contactId ?? "").trim();
    if (!UUID.test(id)) throw new Error("invalid_contact_id");
    return { contactId: id };
  })
  .handler(async ({ data }) => {
    const { getRelationshipIntakeSnapshot } = await import("@/lib/relationship-intake/intake.server");
    return getRelationshipIntakeSnapshot(data.contactId);
  });

export const getRelationshipStudioConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { loadRelationshipQuestions, loadRelationshipConfig } = await import(
      "@/lib/relationship-intake/intake.server"
    );
    const { transcriptionHealth } = await import("@/lib/voice/transcription.server");
    const [questions, config, voice] = await Promise.all([
      loadRelationshipQuestions(),
      loadRelationshipConfig(),
      transcriptionHealth(),
    ]);
    return { questions, config, voice };
  });

export const saveRelationshipQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    question_key: string;
    label?: string;
    question_text?: string;
    order_index?: number;
    active?: boolean;
    skippable?: boolean;
    required?: boolean;
  }) => {
    const key = String(input?.question_key ?? "").trim().slice(0, 60);
    if (!key) throw new Error("missing_question_key");
    return { ...input, question_key: key };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = { question_key: data.question_key };
    for (const k of ["label", "question_text", "order_index", "active", "skippable", "required"] as const) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    const { error } = await (supabaseAdmin as any)
      .from("relationship_intake_questions")
      .upsert(patch, { onConflict: "question_key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveRelationshipConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    intro_text?: string;
    completion_text?: string;
    voice_enabled?: boolean;
    voice_rules?: string;
  }) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = { id: true };
    for (const k of ["intro_text", "completion_text", "voice_enabled", "voice_rules"] as const) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    const { error } = await (supabaseAdmin as any)
      .from("relationship_intake_config")
      .upsert(patch, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });