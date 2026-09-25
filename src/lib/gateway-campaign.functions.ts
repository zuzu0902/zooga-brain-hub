import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Single canonical Gateway campaign route. No fallbacks, no alternates. */
export const GATEWAY_CAMPAIGN_PATH = "/v1/campaign/trigger";
export const CAMPAIGN_DELAY_SECONDS = 5;
const TIMEOUT_MS = 15000;

export const CampaignInput = z.object({
  template_name: z.string().trim().min(1).max(120),
  contacts: z
    .array(z.object({ phone: z.string().regex(/^972\d{8,12}$/), name: z.string().trim().max(80).nullable().optional() }))
    .min(1)
    .max(500),
  confirmed: z.literal(true),
});

export function buildCampaignPayload(template: string, contacts: { phone: string; name?: string | null }[]) {
  return {
    template_name: template,
    language_code: "he",
    delay_seconds: CAMPAIGN_DELAY_SECONDS,
    contacts: contacts.map((c) => ({ phone: c.phone, name: c.name ?? "" })),
  };
}

/** Maps a Gateway HTTP status to a safe, user-facing error code. */
export function classifyGatewayStatus(status: number): string | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return "gateway_unauthorized";
  if (status === 404) return "gateway_route_not_found";
  if (status === 400 || status === 422) return "gateway_rejected_payload";
  if (status === 429) return "gateway_rate_limited";
  return `gateway_status_${status}`;
}

async function assertAdmin(context: any) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

/**
 * Dispatch exactly ONE campaign request to the Hostinger Gateway, server-side.
 * The Gateway URL and bearer credential come from the server-only control-plane
 * config and are never returned to the browser. Requires an explicit
 * `confirmed: true` from the UI's confirmation dialog.
 */
export const triggerGatewayCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CampaignInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cfg } = await (supabaseAdmin as any).rpc("zooga_control_plane_config");
    const row = Array.isArray(cfg) ? cfg[0] : cfg;
    const baseUrl = typeof row?.gateway_url === "string" ? row.gateway_url.trim().replace(/\/+$/, "") : "";
    const token = typeof row?.bearer_token === "string" ? row.bearer_token.trim() : "";
    if (!baseUrl || !token) return { ok: false as const, error: "gateway_config_missing" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let status = 0;
    let body: any = null;
    try {
      const res = await fetch(baseUrl + GATEWAY_CAMPAIGN_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Accept: "application/json" },
        body: JSON.stringify(buildCampaignPayload(data.template_name, data.contacts)),
        signal: controller.signal,
      });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch (e: any) {
      return { ok: false as const, error: e?.name === "AbortError" ? "gateway_timeout" : "gateway_unreachable" };
    } finally {
      clearTimeout(timer);
    }
    const err = classifyGatewayStatus(status);
    if (err) {
      const detail = typeof body?.error === "string" ? body.error.slice(0, 80).replace(/[^\w.:-]/g, "") : null;
      return { ok: false as const, error: err, status, detail };
    }

    const batch_id = crypto.randomUUID();
    await supabaseAdmin.from("gateway_campaign_dispatches").insert(
      data.contacts.map((c) => ({
        batch_id,
        phone: c.phone,
        name: c.name ?? null,
        template_name: data.template_name,
        gateway_status: status,
        created_by: context.userId,
      })),
    );
    return { ok: true as const, count: data.contacts.length, batch_id, status };
  });

/** Last 50 dispatches with a replied flag (inbound message after the send time). */
export const listRecentDispatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("gateway_campaign_dispatches")
      .select("id, phone, name, template_name, dispatched_at")
      .order("dispatched_at", { ascending: false })
      .limit(50);
    const list = rows ?? [];
    const phones = Array.from(new Set(list.flatMap((r) => [r.phone, "+" + r.phone])));
    const lastInbound = new Map<string, string>();
    if (phones.length) {
      const { data: cs } = await supabaseAdmin
        .from("contacts")
        .select("phone, last_inbound_at")
        .in("phone", phones);
      for (const c of cs ?? []) {
        if (c.phone && c.last_inbound_at) lastInbound.set(c.phone.replace(/^\+/, ""), c.last_inbound_at);
      }
    }
    return list.map((r) => {
      const li = lastInbound.get(r.phone);
      return { ...r, replied: !!li && new Date(li) > new Date(r.dispatched_at) };
    });
  });
