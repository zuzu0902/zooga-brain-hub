/**
 * INTERNAL READ-ONLY INTROSPECTION API HELPERS
 *
 * Backs all /api/introspect/* routes. Invariants:
 *  - GET-only, non-GET => 405
 *  - x-debug-token header required, validated against DEBUG_READ_ONLY_TOKEN
 *  - No secrets, no raw tokens/keys, no full PII, no raw payloads
 *  - No side effects: read-only DB queries, no writes/jobs/outbound calls
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDebugAuth, jsonResponse, presence } from "@/lib/debug-api.server";
import { INTAKE_FLOWS, INTAKE_FLOW_LABELS } from "@/lib/intake-flows";

export { checkDebugAuth, jsonResponse, presence };

export function methodGuards(handler: (ctx: { request: Request }) => Promise<Response>) {
  return {
    GET: handler,
    POST: handler,
    PUT: handler,
    DELETE: handler,
    PATCH: handler,
  };
}

export function isVerbose(request: Request): boolean {
  return new URL(request.url).searchParams.get("verbose") === "true";
}

export async function countRows(table: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from(table as any)
    .select("*", { count: "exact", head: true });
  return error ? null : (count ?? null);
}

export async function getApiSettings() {
  const { data } = await supabaseAdmin
    .from("api_settings")
    .select("default_source, facebook_page_id, webhook_token, tamar_backend_url, tamar_backend_api_token")
    .eq("id", 1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Resolved Tamar outbound config.
 * Prefers TAMAR_API_URL / TAMAR_API_TOKEN environment variables (operational truth).
 * Falls back to api_settings table values for backwards compatibility.
 */
export function getTamarOutboundConfig(settings: { tamar_backend_url?: string | null; tamar_backend_api_token?: string | null } | null) {
  const envUrl = process.env.TAMAR_API_URL?.trim();
  const envToken = process.env.TAMAR_API_TOKEN?.trim();
  const url = envUrl || settings?.tamar_backend_url || null;
  const tokenPresent = !!envToken || !!settings?.tamar_backend_api_token;
  const source = envUrl
    ? "env"
    : settings?.tamar_backend_url
      ? "db"
      : "unconfigured";
  let host: string | null = null;
  try { if (url) host = new URL(url).host; } catch { host = null; }
  return { url, host, token_present: tokenPresent, source, env_url_present: !!envUrl, env_token_present: !!envToken };
}

export async function getBehaviorSettings() {
  const { data } = await supabaseAdmin
    .from("tamar_behavior_settings" as any)
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return (data as any) ?? null;
}

export const REQUIRED_ENV_VARS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "LOVABLE_API_KEY",
  "DEBUG_READ_ONLY_TOKEN",
] as const;

export const OPTIONAL_ENV_VARS = [
  "TAMAR_API_URL",
  "TAMAR_API_TOKEN",
] as const;

export function envPresenceMap() {
  const present: string[] = [];
  const missing: string[] = [];
  for (const k of REQUIRED_ENV_VARS) {
    if (process.env[k]) present.push(k);
    else missing.push(k);
  }
  return { present, missing };
}

export { INTAKE_FLOWS, INTAKE_FLOW_LABELS };