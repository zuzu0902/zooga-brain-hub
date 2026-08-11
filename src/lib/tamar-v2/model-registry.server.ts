/**
 * TAMAR BRAIN V2 — single source of truth for AI models.
 *
 * No model id is hardcoded in a runtime file: every stage reads its model,
 * temperature, limits, retries and fallback from `tamar_model_registry`
 * (admin-editable, versioned, allowlist-constrained). Each call is logged
 * with latency, tokens and errors.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type ModelStage =
  | "intent_interpreter"
  | "response_writer"
  | "extractor"
  | "fallback"
  | "relationship_insights";

export type StageConfig = {
  stage: ModelStage;
  model_id: string;
  temperature: number;
  max_tokens: number;
  timeout_ms: number;
  retries: number;
  fallback_model: string | null;
  structured_output: boolean;
  reasoning_effort: string | null;
};

const HARD_DEFAULTS: Record<ModelStage, StageConfig> = {
  intent_interpreter: {
    stage: "intent_interpreter",
    model_id: "google/gemini-2.5-pro",
    temperature: 0.1,
    max_tokens: 1200,
    timeout_ms: 20000,
    retries: 1,
    fallback_model: "google/gemini-3.6-flash",
    structured_output: true,
    reasoning_effort: null,
  },
  response_writer: {
    stage: "response_writer",
    model_id: "google/gemini-2.5-pro",
    temperature: 0.4,
    max_tokens: 900,
    timeout_ms: 20000,
    retries: 1,
    fallback_model: "google/gemini-3.6-flash",
    structured_output: false,
    reasoning_effort: null,
  },
  extractor: {
    stage: "extractor",
    model_id: "google/gemini-3.6-flash",
    temperature: 0.1,
    max_tokens: 700,
    timeout_ms: 15000,
    retries: 1,
    fallback_model: null,
    structured_output: true,
    reasoning_effort: null,
  },
  fallback: {
    stage: "fallback",
    model_id: "google/gemini-2.5-pro",
    temperature: 0.3,
    max_tokens: 800,
    timeout_ms: 15000,
    retries: 0,
    fallback_model: null,
    structured_output: false,
    reasoning_effort: null,
  },
  // Internal, admin-only relationship profiling: strongest configured model,
  // strict JSON, one call per changed answer hash.
  relationship_insights: {
    stage: "relationship_insights",
    model_id: "google/gemini-2.5-pro",
    temperature: 0.1,
    max_tokens: 3000,
    timeout_ms: 60000,
    retries: 0,
    fallback_model: "google/gemini-3.6-flash",
    structured_output: true,
    reasoning_effort: null,
  },
};

let cache: { at: number; rows: Record<string, StageConfig> } | null = null;

export async function loadStageConfig(stage: ModelStage): Promise<StageConfig> {
  if (cache && Date.now() - cache.at < 30_000 && cache.rows[stage]) return cache.rows[stage]!;
  const { data } = await supabaseAdmin
    .from("tamar_model_registry" as any)
    .select("*")
    .eq("is_active", true);
  const rows: Record<string, StageConfig> = {};
  for (const r of ((data as any[]) ?? [])) {
    rows[r.stage] = {
      stage: r.stage,
      model_id: r.model_id,
      temperature: Number(r.temperature ?? 0.3),
      max_tokens: Number(r.max_tokens ?? 900),
      timeout_ms: Number(r.timeout_ms ?? 20000),
      retries: Number(r.retries ?? 1),
      fallback_model: r.fallback_model ?? null,
      structured_output: !!r.structured_output,
      reasoning_effort: r.reasoning_effort ?? null,
    };
  }
  cache = { at: Date.now(), rows };
  return rows[stage] ?? HARD_DEFAULTS[stage];
}

export function clearModelCache() {
  cache = null;
}

export type ModelCallResult = {
  ok: boolean;
  content: string | null;
  model_id: string;
  http_status: number;
  latency_ms: number;
  fallback_used: boolean;
  error: string | null;
};

/** OpenAI reasoning models reject `max_tokens` and need the newer field. */
function buildBody(cfg: StageConfig, modelId: string, messages: any[], json: boolean) {
  const isOpenAI = modelId.startsWith("openai/");
  const body: Record<string, unknown> = { model: modelId, messages };
  if (isOpenAI) {
    body["max_completion_tokens"] = cfg.max_tokens;
    if (cfg.reasoning_effort) body["reasoning_effort"] = cfg.reasoning_effort;
  } else {
    body["max_tokens"] = cfg.max_tokens;
    body["temperature"] = cfg.temperature;
  }
  if (json) body["response_format"] = { type: "json_object" };
  return body;
}

async function logCall(row: {
  stage: string;
  model_id: string;
  ok: boolean;
  http_status: number;
  latency_ms: number;
  fallback_used: boolean;
  attempt: number;
  error: string | null;
  context?: string | null;
  usage?: any;
}) {
  try {
    await supabaseAdmin.from("tamar_model_calls" as any).insert({
      stage: row.stage,
      model_id: row.model_id,
      ok: row.ok,
      http_status: row.http_status,
      latency_ms: row.latency_ms,
      fallback_used: row.fallback_used,
      attempt: row.attempt,
      error: row.error,
      context: row.context ?? null,
      prompt_tokens: row.usage?.prompt_tokens ?? null,
      completion_tokens: row.usage?.completion_tokens ?? null,
    } as any);
  } catch {
    /* telemetry must never break a turn */
  }
}

/** Call a stage's model with retries, timeout and fallback model. */
export async function callStage(
  stage: ModelStage,
  messages: Array<{ role: string; content: string }>,
  opts?: { json?: boolean; context?: string },
): Promise<ModelCallResult> {
  const cfg = await loadStageConfig(stage);
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) {
    return { ok: false, content: null, model_id: cfg.model_id, http_status: 0, latency_ms: 0, fallback_used: false, error: "missing_api_key" };
  }
  const json = opts?.json ?? cfg.structured_output;
  const candidates = [cfg.model_id, ...(cfg.fallback_model ? [cfg.fallback_model] : [])];

  let last: ModelCallResult | null = null;
  for (let ci = 0; ci < candidates.length; ci++) {
    const modelId = candidates[ci]!;
    const attempts = ci === 0 ? cfg.retries + 1 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeout_ms);
      try {
        const res = await fetch(GATEWAY, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(buildBody(cfg, modelId, messages, json)),
          signal: controller.signal,
        });
        const payload: any = await res.json().catch(() => ({}));
        const latency = Date.now() - started;
        if (!res.ok) {
          last = {
            ok: false,
            content: null,
            model_id: modelId,
            http_status: res.status,
            latency_ms: latency,
            fallback_used: ci > 0,
            error: String(payload?.error?.message ?? `gateway_${res.status}`).slice(0, 300),
          };
          await logCall({ stage, model_id: modelId, ok: false, http_status: res.status, latency_ms: latency, fallback_used: ci > 0, attempt, error: last.error, context: opts?.context });
          // 4xx other than 429 is terminal for this model — go to fallback.
          if (res.status !== 429 && res.status < 500) break;
          continue;
        }
        const content = payload?.choices?.[0]?.message?.content ?? null;
        await logCall({ stage, model_id: modelId, ok: true, http_status: res.status, latency_ms: latency, fallback_used: ci > 0, attempt, error: null, context: opts?.context, usage: payload?.usage });
        return { ok: true, content, model_id: modelId, http_status: res.status, latency_ms: latency, fallback_used: ci > 0, error: null };
      } catch (e: any) {
        const latency = Date.now() - started;
        const error = e?.name === "AbortError" ? "timeout" : String(e?.message ?? e).slice(0, 300);
        last = { ok: false, content: null, model_id: modelId, http_status: 0, latency_ms: latency, fallback_used: ci > 0, error };
        await logCall({ stage, model_id: modelId, ok: false, http_status: 0, latency_ms: latency, fallback_used: ci > 0, attempt, error, context: opts?.context });
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return last ?? { ok: false, content: null, model_id: cfg.model_id, http_status: 0, latency_ms: 0, fallback_used: false, error: "unknown" };
}

/** Live connection test for the Studio "models" tab. */
export async function testStage(stage: ModelStage): Promise<{ ok: boolean; model_id: string; latency_ms: number; error: string | null }> {
  const res = await callStage(stage, [{ role: "user", content: "Reply with the single word: OK" }], { json: false, context: "studio_test" });
  return { ok: res.ok, model_id: res.model_id, latency_ms: res.latency_ms, error: res.error };
}
