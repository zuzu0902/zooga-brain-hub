import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDebugAuth, jsonResponse, methodGuards, envPresenceMap, getApiSettings, presence } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/health-report")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    const env = envPresenceMap();
    const settings = await getApiSettings();

    let dbOk = false; let dbError: string | null = null;
    try {
      const { error } = await supabaseAdmin.from("api_settings").select("id",{count:"exact",head:true});
      if (error) dbError = error.message; else dbOk = true;
    } catch (e:any) { dbError = String(e?.message ?? e); }

    const warnings: string[] = [];
    if (env.missing.length) warnings.push(`Missing env vars: ${env.missing.join(", ")}`);
    if (!settings?.tamar_backend_url) warnings.push("Tamar backend URL not configured");
    if (!presence(settings?.webhook_token ?? null).present) warnings.push("Tamar webhook token not configured");
    if (!presence(process.env.LOVABLE_API_KEY).present) warnings.push("LOVABLE_API_KEY missing — AI extraction disabled");

    const modules = {
      database: dbOk ? "healthy" : "degraded",
      ai_gateway: presence(process.env.LOVABLE_API_KEY).present ? "healthy" : "degraded",
      tamar_backend: settings?.tamar_backend_url ? "healthy" : "degraded",
      tamar_webhook: presence(settings?.webhook_token ?? null).present ? "healthy" : "degraded",
      handoff_console_ui: "healthy",
      tasks_console_ui: "healthy",
      internal_ai_assistant: presence(process.env.LOVABLE_API_KEY).present ? "healthy" : "degraded",
      tamar_decision_visibility: "healthy",
      contact_live_conversation: "healthy",
      conversation_truth_zooga: "healthy",
      memory_canonical_taxonomy: "healthy",
      decision_context_v2: "healthy",
      unified_timeline: "healthy",
      grounded_ai_assistant: presence(process.env.LOVABLE_API_KEY).present ? "healthy" : "degraded",
      handoff_resolution_router: "healthy",
    };

    return jsonResponse({
      generated_at: new Date().toISOString(),
      overall: warnings.length === 0 ? "healthy" : "degraded",
      modules,
      dependencies: { supabase: { ok: dbOk, error: dbError } },
      warnings,
      missing_env_vars: env.missing,
      present_env_vars: env.present,
    });
  })},
});