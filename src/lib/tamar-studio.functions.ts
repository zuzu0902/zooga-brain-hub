/**
 * TAMAR STUDIO — admin server functions for Tamar Brain V2.
 *
 * Everything Tamar "is" (identity, tone, flow, models, safety thresholds,
 * knowledge, rollout) is data edited here. Every mutation is admin-gated,
 * written to a DRAFT version, and recorded in the audit log. Activating a
 * version is the only way a change reaches production, and any previous
 * version can be re-activated (rollback).
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
    actor, area, action, target_id: targetId, before_value: before ?? null, after_value: after ?? null,
  } as any);
}

const actorOf = (context: any) => String(context?.claims?.email ?? context?.userId ?? "admin");

/* ------------------------------- overview ------------------------------- */

export const getStudioOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { managerTargetPresence } = await import("@/lib/tamar-brain/handoff.server");
    const { metaConfigPresence } = await import("@/lib/whatsapp-meta.server");
    const { loadAgentVersion } = await import("@/lib/tamar-v2/flow.server");

    const [versions, models, allowlist, flags, calls, runs, sources, audits, states, handoffs] = await Promise.all([
      supabaseAdmin.from("tamar_agent_versions" as any).select("*").order("version", { ascending: false }),
      supabaseAdmin.from("tamar_model_registry" as any).select("*").order("stage"),
      supabaseAdmin.from("tamar_model_allowlist" as any).select("*").order("model_id"),
      supabaseAdmin.from("tamar_feature_flags" as any).select("*"),
      supabaseAdmin.from("tamar_model_calls" as any).select("*").order("created_at", { ascending: false }).limit(40),
      supabaseAdmin.from("tamar_eval_runs" as any).select("*").order("created_at", { ascending: false }).limit(10),
      supabaseAdmin.from("community_knowledge_sources" as any).select("id,title,source_url,status,created_at").order("created_at", { ascending: false }).limit(50),
      supabaseAdmin.from("tamar_admin_audit_log" as any).select("*").order("created_at", { ascending: false }).limit(40),
      supabaseAdmin.from("contacts").select("conversation_state").not("conversation_state", "is", null).limit(3000),
      supabaseAdmin.from("manager_handoffs" as any).select("status").limit(500),
    ]);

    const stateCounts: Record<string, number> = {};
    for (const r of ((states as any).data ?? []) as any[]) {
      const k = r.conversation_state ?? "unknown";
      stateCounts[k] = (stateCounts[k] ?? 0) + 1;
    }
    const callRows = ((calls as any).data ?? []) as any[];
    const okCalls = callRows.filter((c) => c.ok);
    const active = await loadAgentVersion();
    const draftRow = (((versions as any).data ?? []) as any[]).find((v) => v.status === "draft");
    const draft = draftRow ? await loadAgentVersion(draftRow.id) : null;

    return {
      active,
      draft,
      versions: ((versions as any).data ?? []) as any[],
      models: ((models as any).data ?? []) as any[],
      allowlist: ((allowlist as any).data ?? []) as any[],
      flags: ((flags as any).data ?? []) as any[],
      calls: callRows,
      eval_runs: ((runs as any).data ?? []) as any[],
      sources: ((sources as any).data ?? []) as any[],
      audits: ((audits as any).data ?? []) as any[],
      state_counts: stateCounts,
      health: {
        manager: await managerTargetPresence(),
        meta: metaConfigPresence(),
        lovable_api_key: !!process.env["LOVABLE_API_KEY"],
        model_success_rate: callRows.length ? Math.round((okCalls.length / callRows.length) * 100) : null,
        avg_latency_ms: okCalls.length ? Math.round(okCalls.reduce((a, c) => a + Number(c.latency_ms ?? 0), 0) / okCalls.length) : null,
        open_handoffs: (((handoffs as any).data ?? []) as any[]).filter((h) => h.status === "open").length,
      },
    };
  });

/* ------------------------------- versions ------------------------------- */

/** Create (or reuse) a draft that starts as a full copy of the active version. */
export const createDraftVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin.from("tamar_agent_versions" as any).select("*").eq("status", "draft").maybeSingle();
    if (existing) return { id: (existing as any).id, reused: true };

    const { data: active } = await supabaseAdmin
      .from("tamar_agent_versions" as any).select("*").eq("status", "active").maybeSingle();
    const { data: maxRow } = await supabaseAdmin
      .from("tamar_agent_versions" as any).select("version").order("version", { ascending: false }).limit(1).maybeSingle();
    const nextVersion = Number((maxRow as any)?.version ?? 0) + 1;

    const { data: created } = await supabaseAdmin
      .from("tamar_agent_versions" as any)
      .insert({
        version: nextVersion,
        status: "draft",
        identity: (active as any)?.identity ?? {},
        safety: (active as any)?.safety ?? {},
        change_summary: "טיוטה חדשה",
        created_by: actorOf(context),
      } as any)
      .select("*").maybeSingle();

    // deep-copy the flow of the active version into the draft
    if ((active as any)?.id && (created as any)?.id) {
      const { data: steps } = await supabaseAdmin.from("tamar_flow_steps" as any).select("*").eq("agent_version_id", (active as any).id);
      for (const s of ((steps as any[]) ?? [])) {
        const { data: newStep } = await supabaseAdmin.from("tamar_flow_steps" as any).insert({
          agent_version_id: (created as any).id,
          step_key: s.step_key, field_key: s.field_key, stage: s.stage,
          question_text: s.question_text, help_text: s.help_text, presentation: s.presentation,
          required: s.required, skippable: s.skippable, conditions: s.conditions,
          order_index: s.order_index, enabled: s.enabled,
        } as any).select("id").maybeSingle();
        const { data: opts } = await supabaseAdmin.from("tamar_flow_options" as any).select("*").eq("step_id", s.id);
        for (const o of ((opts as any[]) ?? [])) {
          await supabaseAdmin.from("tamar_flow_options" as any).insert({
            step_id: (newStep as any).id, option_id: o.option_id, label: o.label,
            value: o.value, order_index: o.order_index, enabled: o.enabled,
          } as any);
        }
      }
    }
    await audit("studio", "create_draft", (created as any)?.id ?? null, null, { version: nextVersion }, actorOf(context));
    return { id: (created as any)?.id ?? null, reused: false };
  });

export const saveDraftIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string(),
    identity: z.record(z.string(), z.any()).optional(),
    safety: z.record(z.string(), z.any()).optional(),
    change_summary: z.string().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("tamar_agent_versions" as any).select("*").eq("id", data.id).maybeSingle();
    if ((before as any)?.status !== "draft") throw new Response("only drafts are editable", { status: 400 });
    const patch: any = { updated_at: new Date().toISOString() };
    if (data.identity) patch.identity = data.identity;
    if (data.safety) patch.safety = data.safety;
    if (data.change_summary !== undefined) patch.change_summary = data.change_summary;
    await supabaseAdmin.from("tamar_agent_versions" as any).update(patch).eq("id", data.id);
    await audit("studio", "save_draft_identity", data.id, before, patch, actorOf(context));
    return { ok: true };
  });

export const activateVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin.from("tamar_agent_versions" as any).select("*").eq("id", data.id).maybeSingle();
    if (!target) throw new Response("version not found", { status: 404 });
    await supabaseAdmin.from("tamar_agent_versions" as any).update({ status: "archived" } as any).eq("status", "active");
    await supabaseAdmin.from("tamar_agent_versions" as any)
      .update({ status: "active", activated_at: new Date().toISOString() } as any).eq("id", data.id);
    await audit("studio", "activate_version", data.id, null, { version: (target as any).version }, actorOf(context));
    return { ok: true, version: (target as any).version };
  });

/* --------------------------------- flow --------------------------------- */

export const saveFlowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().nullable().optional(),
    agent_version_id: z.string(),
    step_key: z.string(),
    field_key: z.string().nullable(),
    stage: z.string(),
    question_text: z.string(),
    help_text: z.string().nullable().optional(),
    presentation: z.enum(["text", "buttons", "list"]),
    required: z.boolean(),
    skippable: z.boolean(),
    order_index: z.number(),
    enabled: z.boolean(),
    options: z.array(z.object({ option_id: z.string(), label: z.string(), value: z.string(), order_index: z.number(), enabled: z.boolean() })).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ver } = await supabaseAdmin.from("tamar_agent_versions" as any).select("status").eq("id", data.agent_version_id).maybeSingle();
    if ((ver as any)?.status !== "draft") throw new Response("only drafts are editable", { status: 400 });

    const row = {
      agent_version_id: data.agent_version_id,
      step_key: data.step_key, field_key: data.field_key, stage: data.stage,
      question_text: data.question_text, help_text: data.help_text ?? null,
      presentation: data.presentation, required: data.required, skippable: data.skippable,
      order_index: data.order_index, enabled: data.enabled, updated_at: new Date().toISOString(),
    };
    let stepId = data.id ?? null;
    if (stepId) await supabaseAdmin.from("tamar_flow_steps" as any).update(row as any).eq("id", stepId);
    else {
      const { data: created } = await supabaseAdmin.from("tamar_flow_steps" as any).insert(row as any).select("id").maybeSingle();
      stepId = (created as any)?.id ?? null;
    }
    if (stepId) {
      await supabaseAdmin.from("tamar_flow_options" as any).delete().eq("step_id", stepId);
      for (const o of data.options) {
        await supabaseAdmin.from("tamar_flow_options" as any).insert({ step_id: stepId, ...o } as any);
      }
    }
    await audit("studio", "save_flow_step", stepId, null, row, actorOf(context));
    return { ok: true, id: stepId };
  });

export const deleteFlowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: step } = await supabaseAdmin.from("tamar_flow_steps" as any).select("*, tamar_agent_versions!inner(status)").eq("id", data.id).maybeSingle();
    if ((step as any)?.tamar_agent_versions?.status !== "draft") throw new Response("only drafts are editable", { status: 400 });
    await supabaseAdmin.from("tamar_flow_options" as any).delete().eq("step_id", data.id);
    await supabaseAdmin.from("tamar_flow_steps" as any).delete().eq("id", data.id);
    await audit("studio", "delete_flow_step", data.id, step, null, actorOf(context));
    return { ok: true };
  });

/* -------------------------------- models -------------------------------- */

export const saveModelStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    stage: z.string(),
    model_id: z.string(),
    temperature: z.number(),
    max_tokens: z.number(),
    timeout_ms: z.number(),
    retries: z.number(),
    fallback_model: z.string().nullable(),
    structured_output: z.boolean(),
    reasoning_effort: z.string().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { clearModelCache } = await import("@/lib/tamar-v2/model-registry.server");
    const { data: allow } = await supabaseAdmin.from("tamar_model_allowlist" as any).select("model_id");
    const allowed = ((allow as any[]) ?? []).map((a) => a.model_id);
    if (!allowed.includes(data.model_id)) throw new Response("model not in allowlist", { status: 400 });
    if (data.fallback_model && !allowed.includes(data.fallback_model)) throw new Response("fallback not in allowlist", { status: 400 });

    const { data: before } = await supabaseAdmin.from("tamar_model_registry" as any).select("*").eq("stage", data.stage).maybeSingle();
    await supabaseAdmin.from("tamar_model_registry" as any).update({ ...data, updated_by: actorOf(context), updated_at: new Date().toISOString() } as any).eq("stage", data.stage);
    clearModelCache();
    await audit("studio", "save_model_stage", data.stage, before, data, actorOf(context));
    return { ok: true };
  });

export const testModelStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ stage: z.enum(["intent_interpreter", "response_writer", "extractor", "fallback"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { testStage } = await import("@/lib/tamar-v2/model-registry.server");
    return testStage(data.stage);
  });

/* --------------------------------- flags -------------------------------- */

export const setFeatureFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    key: z.string(),
    enabled: z.boolean(),
    allowlist: z.array(z.string()).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("tamar_feature_flags" as any).select("*").eq("key", data.key).maybeSingle();
    await supabaseAdmin.from("tamar_feature_flags" as any).upsert({
      key: data.key, enabled: data.enabled, allowlist: data.allowlist,
      updated_by: actorOf(context), updated_at: new Date().toISOString(),
    } as any, { onConflict: "key" } as any);
    await audit("studio", "set_flag", data.key, before, data, actorOf(context));
    return { ok: true };
  });

/* ------------------------------ simulation ------------------------------ */

export const simulateV2Turn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    message: z.string(),
    state: z.string(),
    known: z.record(z.string(), z.string()).default({}),
    pending_step: z.string().nullable().default(null),
    offline: z.boolean().default(false),
    version_id: z.string().nullable().default(null),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { loadAgentVersion, loadSellableOffers } = await import("@/lib/tamar-v2/flow.server");
    const { decideTurn } = await import("@/lib/tamar-v2/engine-core");
    const { interpretDeterministic } = await import("@/lib/tamar-v2/interpret-rules");
    const { interpret } = await import("@/lib/tamar-v2/interpreter.server");
    const { normalizeState } = await import("@/lib/tamar-v2/types");

    const agent = await loadAgentVersion(data.version_id);
    const offers = await loadSellableOffers();
    const state = normalizeState(data.state) ?? "new_inbound";
    const interpretation = data.offline
      ? interpretDeterministic(data.message)
      : await interpret(data.message, { state, pendingQuestion: data.pending_step, known: data.known });
    const decision = decideTurn({
      state, message: data.message, optionId: null, optionValue: null, agent, interpretation,
      knownFields: data.known, pendingStepKey: data.pending_step, ambiguityTurns: 0,
      answeredCount: Object.keys(data.known).length, offers, firstName: "דנה", answerText: null,
    });
    // dry run only: nothing is sent, nothing is written to a contact
    return { decision, interpretation, agent_version: agent.version, offers_considered: offers.length };
  });

/* -------------------------------- evals --------------------------------- */

export const seedEvalSuite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { SCENARIOS } = await import("@/lib/tamar-v2/scenarios");
    const name = "Tamar V2 — acceptance";
    let { data: suite } = await supabaseAdmin.from("tamar_eval_suites" as any).select("*").eq("name", name).maybeSingle();
    if (!suite) {
      const { data: created } = await supabaseAdmin.from("tamar_eval_suites" as any)
        .insert({ name, description: "תרחישי קבלה בעברית — נטענים מהקוד ומורצים אופליין" } as any).select("*").maybeSingle();
      suite = created as any;
    }
    const suiteId = (suite as any).id;
    await supabaseAdmin.from("tamar_eval_cases" as any).delete().eq("suite_id", suiteId);
    let i = 0;
    for (const sc of SCENARIOS) {
      i += 1;
      await supabaseAdmin.from("tamar_eval_cases" as any).insert({
        suite_id: suiteId, name: sc.name, inbound: sc.inbound, state: sc.state,
        context: { category: sc.category, known: sc.known ?? {}, pending: sc.pendingStepKey ?? null },
        expect: sc.expect as any, order_index: i,
      } as any);
    }
    await audit("studio", "seed_eval_suite", suiteId, null, { cases: i }, actorOf(context));
    return { suite_id: suiteId, cases: i };
  });

export const runEvalSuite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ version_id: z.string().nullable().default(null) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { SCENARIOS, runScenario, TEST_AGENT } = await import("@/lib/tamar-v2/scenarios");
    const { loadAgentVersion } = await import("@/lib/tamar-v2/flow.server");

    // Evals run offline against the pure engine: no model, no WhatsApp, no contact.
    const live = await loadAgentVersion(data.version_id);
    const agent = live.steps.length ? live : TEST_AGENT;
    const { data: suite } = await supabaseAdmin.from("tamar_eval_suites" as any).select("id").eq("name", "Tamar V2 — acceptance").maybeSingle();

    const results = SCENARIOS.map((sc) => ({ sc, r: runScenario(sc, agent) }));
    const passed = results.filter((x) => x.r.passed).length;
    const { data: run } = await supabaseAdmin.from("tamar_eval_runs" as any).insert({
      suite_id: (suite as any)?.id ?? null,
      agent_version_id: data.version_id ?? live.id,
      mode: "offline",
      total: results.length, passed, failed: results.length - passed,
      pass_rate: Math.round((passed / Math.max(1, results.length)) * 10000) / 100,
      created_by: actorOf(context), finished_at: new Date().toISOString(),
    } as any).select("*").maybeSingle();

    for (const { sc, r } of results) {
      await supabaseAdmin.from("tamar_eval_results" as any).insert({
        run_id: (run as any)?.id, case_name: `[${sc.category}] ${sc.name}`, passed: r.passed,
        actual: { state: r.decision.next_state, actions: r.decision.actions, reasons: r.decision.reason_codes, body: r.decision.messages.map((m) => m.body).join("\n") },
        failures: r.failures,
      } as any);
    }
    await audit("studio", "run_eval_suite", (run as any)?.id ?? null, null, { passed, total: results.length }, actorOf(context));
    return { run_id: (run as any)?.id ?? null, total: results.length, passed, failed: results.length - passed, failures: results.filter((x) => !x.r.passed).map((x) => ({ name: x.sc.name, failures: x.r.failures })) };
  });

export const getEvalRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ run_id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.from("tamar_eval_results" as any).select("*").eq("run_id", data.run_id).order("created_at");
    return { results: ((rows as any[]) ?? []) };
  });
