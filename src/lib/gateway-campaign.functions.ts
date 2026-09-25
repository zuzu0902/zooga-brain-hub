import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const GATEWAY_CAMPAIGN_URL = "https://gateway.zooga-os.segapo.com/v1/campaign/trigger";
export const CAMPAIGN_DELAY_SECONDS = 5;

const Input = z.object({
  template_name: z.string().trim().min(1).max(120),
  contacts: z
    .array(z.object({ phone: z.string().regex(/^972\d{8,12}$/), name: z.string().trim().max(80).nullable().optional() }))
    .min(1)
    .max(500),
});

export function buildCampaignPayload(template: string, contacts: { phone: string; name?: string | null }[]) {
  return {
    template_name: template,
    language_code: "he",
    delay_seconds: CAMPAIGN_DELAY_SECONDS,
    contacts: contacts.map((c) => ({ phone: c.phone, name: c.name ?? "" })),
  };
}

async function assertAdmin(context: any) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

/** Send a bulk template campaign through the Hostinger Gateway. Token never leaves the server. */
export const triggerGatewayCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => Input.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let token = process.env["ZOOGA_CAMPAIGN_TOKEN"] ?? "";
    if (!token) {
      const { data: cfg } = await (supabaseAdmin as any).rpc("zooga_control_plane_config");
      const row = Array.isArray(cfg) ? cfg[0] : cfg;
      token = typeof row?.bearer_token === "string" ? row.bearer_token.trim() : "";
    }
    if (!token) return { ok: false as const, error: "gateway_token_missing" };

    let status = 0;
    try {
      const res = await fetch(GATEWAY_CAMPAIGN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Zooga-Token": token },
        body: JSON.stringify(buildCampaignPayload(data.template_name, data.contacts)),
      });
      status = res.status;
    } catch {
      return { ok: false as const, error: "gateway_unreachable" };
    }
    if (status !== 202) return { ok: false as const, error: `gateway_status_${status}` };

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
    return { ok: true as const, count: data.contacts.length, batch_id };
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
