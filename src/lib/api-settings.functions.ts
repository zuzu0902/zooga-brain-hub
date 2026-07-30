import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UpdateSchema = z.object({
  facebook_page_id: z.string().trim().max(200).nullable().optional(),
  default_source: z.string().trim().max(100).optional(),
  // Tokens are write-only from the client. Empty string = leave unchanged.
  webhook_token: z.string().max(500).optional(),
});

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) {
    throw new Response("Forbidden", { status: 403 });
  }
}

/**
 * Returns non-secret api_settings columns plus booleans indicating whether
 * each secret token is currently set. Secret values are never returned to
 * the client.
 */
export const getApiSettingsSafe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("api_settings")
      .select("id, facebook_page_id, default_source, webhook_token")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Response(error.message, { status: 500 });
    return {
      id: 1,
      facebook_page_id: data?.facebook_page_id ?? null,
      default_source: data?.default_source ?? "Tamar Bot",
      has_webhook_token: !!data?.webhook_token,
    };
  });

export const updateApiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, any> = { id: 1 };
    if (data.facebook_page_id !== undefined) patch.facebook_page_id = data.facebook_page_id || null;
    if (data.default_source !== undefined) patch.default_source = data.default_source;
    // Only update tokens when a non-empty value is supplied; empty string leaves current value untouched.
    if (data.webhook_token && data.webhook_token.trim().length > 0) {
      patch.webhook_token = data.webhook_token.trim();
    }
    const { error } = await supabaseAdmin.from("api_settings").upsert(patch);
    if (error) throw new Response(error.message, { status: 500 });
    return { ok: true as const };
  });