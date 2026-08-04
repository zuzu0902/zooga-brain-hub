/**
 * TAMAR BRAIN v1 — admin server functions.
 * Every mutating call is admin-gated and written to the audit log.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Response("Forbidden", { status: 403 });
}

async function audit(area: string, action: string, targetId: string | null, before: any, after: any, actor: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("tamar_admin_audit_log" as any).insert({
    actor,
    area,
    action,
    target_id: targetId,
    before_value: before ?? null,
    after_value: after ?? null,
  } as any);
}

export const getBrainOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { managerTargetPresence } = await import("@/lib/tamar-brain/handoff.server");
    const { metaConfigPresence } = await import("@/lib/whatsapp-meta.server");

    const [policy, copy, sources, chunks, traces, audits, states] = await Promise.all([
      supabaseAdmin.from("tamar_brain_policy" as any).select("*").eq("id", 1).maybeSingle(),
      supabaseAdmin.from("tamar_copy_versions" as any).select("*").order("copy_key").order("version", { ascending: false }),
      supabaseAdmin.from("community_knowledge_sources" as any).select("*").order("created_at", { ascending: false }),
      supabaseAdmin.from("community_knowledge_chunks" as any).select("id,source_id,content,tags,status").limit(200),
      supabaseAdmin.from("tamar_decision_traces" as any).select("*").order("created_at", { ascending: false }).limit(50),
      supabaseAdmin.from("tamar_admin_audit_log" as any).select("*").order("created_at", { ascending: false }).limit(30),
      supabaseAdmin.from("contacts").select("conversation_state").not("conversation_state", "is", null).limit(2000),
    ]);

    const stateCounts: Record<string, number> = {};
    for (const row of ((states as any).data ?? []) as any[]) {
      const key = row.conversation_state ?? "unknown";
      stateCounts[key] = (stateCounts[key] ?? 0) + 1;
    }

    return {
      policy: (policy as any).data ?? null,
      copy: ((copy as any).data ?? []) as any[],
      sources: ((sources as any).data ?? []) as any[],
      chunks: ((chunks as any).data ?? []) as any[],
      traces: ((traces as any).data ?? []) as any[],
      audits: ((audits as any).data ?? []) as any[],
      state_counts: stateCounts,
      manager: await managerTargetPresence(),
      meta: metaConfigPresence(),
    };
  });

const PolicySchema = z.object({
  consent_gate_enabled: z.boolean().optional(),
  max_questions_per_message: z.number().int().min(1).max(3).optional(),
  value_before_question_after_answers: z.number().int().min(1).max(6).optional(),
  handoff_confidence_threshold: z.number().int().min(0).max(100).optional(),
  manager_alert_enabled: z.boolean().optional(),
  manager_alert_template: z.string().trim().max(120).optional(),
  attach_transcript_to_alert: z.boolean().optional(),
  recommendation_max_offers: z.number().int().min(1).max(5).optional(),
  knowledge_grounding_required: z.boolean().optional(),
  ab_testing_enabled: z.boolean().optional(),
  kill_switch_ab: z.boolean().optional(),
});

export const updateBrainPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PolicySchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("tamar_brain_policy" as any).select("*").eq("id", 1).maybeSingle();
    const { error } = await supabaseAdmin
      .from("tamar_brain_policy" as any)
      .update({ ...data, updated_by: context.userId } as any)
      .eq("id", 1);
    if (error) throw new Response(error.message, { status: 500 });
    await audit("policy", "update", "1", before, data, context.userId);
    return { ok: true };
  });

const CopySchema = z.object({
  id: z.string().uuid().optional(),
  copy_key: z.string().trim().min(2).max(80),
  variant: z.string().trim().min(1).max(10).default("A"),
  body: z.string().trim().min(5).max(4000),
  template_name: z.string().trim().max(120).nullable().optional(),
  is_active: z.boolean().default(false),
  kill_switch: z.boolean().default(false),
  notes: z.string().trim().max(500).nullable().optional(),
});

/** Copy is versioned: saving creates a NEW version, never edits history. */
export const saveCopyVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CopySchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: latest } = await supabaseAdmin
      .from("tamar_copy_versions" as any)
      .select("version")
      .eq("copy_key", data.copy_key)
      .eq("variant", data.variant)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((latest as any)?.version ?? 0) + 1;

    if (data.is_active) {
      await supabaseAdmin
        .from("tamar_copy_versions" as any)
        .update({ is_active: false } as any)
        .eq("copy_key", data.copy_key)
        .eq("variant", data.variant);
    }
    const { error } = await supabaseAdmin.from("tamar_copy_versions" as any).insert({
      copy_key: data.copy_key,
      variant: data.variant,
      version: nextVersion,
      body: data.body,
      template_name: data.template_name ?? null,
      is_active: data.is_active,
      kill_switch: data.kill_switch,
      notes: data.notes ?? null,
      updated_by: context.userId,
    } as any);
    if (error) throw new Response(error.message, { status: 500 });
    await audit("copy", "new_version", `${data.copy_key}:${data.variant}:v${nextVersion}`, null, data, context.userId);
    return { ok: true, version: nextVersion };
  });

const SourceSchema = z.object({
  title: z.string().trim().min(2).max(200),
  source_url: z.string().trim().max(500).nullable().optional(),
  source_type: z.string().trim().max(50).default("manual"),
  public_or_authorized: z.string().trim().max(30).default("public"),
  content: z.string().trim().min(10).max(20000),
});

export const addKnowledgeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SourceSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { isAllowedKnowledgeUrl } = await import("@/lib/tamar-brain/knowledge.server");
    if (!isAllowedKnowledgeUrl(data.source_url ?? null)) {
      throw new Response("URL is not in the approved domain allowlist", { status: 400 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: src, error } = await supabaseAdmin
      .from("community_knowledge_sources" as any)
      .insert({
        title: data.title,
        source_url: data.source_url ?? null,
        source_type: data.source_type,
        public_or_authorized: data.public_or_authorized,
        status: "pending",
        fetched_at: new Date().toISOString(),
      } as any)
      .select("id")
      .maybeSingle();
    if (error) throw new Response(error.message, { status: 500 });

    const chunks = data.content
      .split(/\n{2,}/)
      .map((c) => c.trim())
      .filter((c) => c.length > 20);
    if (chunks.length) {
      await supabaseAdmin.from("community_knowledge_chunks" as any).insert(
        chunks.map((content, i) => ({
          source_id: (src as any).id,
          chunk_index: i,
          content,
          status: "approved",
        })) as any,
      );
    }
    await audit("knowledge", "add_source", (src as any)?.id ?? null, null, { title: data.title }, context.userId);
    return { ok: true, chunks: chunks.length };
  });

export const setKnowledgeSourceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), status: z.enum(["approved", "pending", "archived"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("community_knowledge_sources" as any)
      .update({
        status: data.status,
        verified_at: data.status === "approved" ? new Date().toISOString() : null,
        verified_by: data.status === "approved" ? context.userId : null,
      } as any)
      .eq("id", data.id);
    if (error) throw new Response(error.message, { status: 500 });
    await audit("knowledge", `status_${data.status}`, data.id, null, null, context.userId);
    return { ok: true };
  });

/** Dry-run simulation: no WhatsApp send, no contact writes. */
export const simulateBrain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        scenario: z.string().trim().max(80).optional(),
        message: z.string().trim().min(1).max(1000),
        state: z.string().trim().max(40).default("consented"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { simulateTurn } = await import("@/lib/tamar-brain/simulate.server");
    return simulateTurn({ message: data.message, state: data.state as any });
  });

/** Handoff console actions. */
export const setHumanOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ contact_id: z.string().uuid(), action: z.enum(["take", "resume", "close"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.action === "resume") {
      const { resumeTamar } = await import("@/lib/tamar-brain/handoff.server");
      await resumeTamar(data.contact_id, context.userId);
    } else {
      await supabaseAdmin
        .from("contacts")
        .update({
          human_owned: data.action === "take",
          human_owned_by: data.action === "take" ? context.userId : null,
          conversation_state: data.action === "take" ? "human_owned" : "closed",
          conversation_state_at: new Date().toISOString(),
        } as any)
        .eq("id", data.contact_id);
      await supabaseAdmin.from("tamar_state_transitions" as any).insert({
        contact_id: data.contact_id,
        to_state: data.action === "take" ? "human_owned" : "closed",
        trigger: `manual_${data.action}`,
        actor: context.userId,
      } as any);
    }
    await audit("handoff", data.action, data.contact_id, null, null, context.userId);
    return { ok: true };
  });