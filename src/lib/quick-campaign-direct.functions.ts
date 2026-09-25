import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  template_name: z.string().trim().min(1).max(120),
  batch_id: z.string().uuid(),
  phone: z.string().regex(/^972\d{8,12}$/),
  name: z.string().trim().max(80).nullable().optional(),
});

/**
 * Send ONE first-opening template directly via Meta for the Quick Campaign.
 * Admin-authorised import list = operational eligibility for a single first
 * opening. Opted-out numbers and numbers that already received this template
 * are skipped. Consent is NOT granted here — it is recorded only when the
 * customer answers the consent button.
 */
export const sendQuickCampaignOne = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => Input.parse(i))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { ok: false as const, result: "forbidden" as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { validateTemplateForLaunch } = await import("@/lib/whatsapp-templates.server");
    const { sendWhatsAppTemplate, recordDelivery } = await import("@/lib/whatsapp-meta.server");
    const { splitName } = await import("@/lib/phone");

    const gate = await validateTemplateForLaunch(data.template_name, "he");
    if (!gate.ok) return { ok: false as const, result: "template_blocked" as const };

    const e164 = "+" + data.phone;

    // Already sent this template to this number? Never send a second opening.
    const { data: prior } = await supabaseAdmin
      .from("gateway_campaign_dispatches")
      .select("id")
      .eq("phone", data.phone)
      .eq("template_name", data.template_name)
      .gte("gateway_status", 200)
      .lt("gateway_status", 300)
      .limit(1);
    if (prior?.length) return { ok: true as const, result: "skipped_duplicate" as const };

    let { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, opted_out_at")
      .in("phone", [e164, data.phone])
      .limit(1)
      .maybeSingle();
    if (contact?.opted_out_at) return { ok: true as const, result: "skipped_opted_out" as const };
    if (!contact) {
      const { first, last } = splitName(data.name ?? null);
      const { data: made, error } = await supabaseAdmin
        .from("contacts")
        .insert({
          phone: e164,
          whatsapp_number: e164,
          first_name: first,
          last_name: last,
          source: "Manual",
          status: "new_lead",
          consent_marketing: false,
        } as any)
        .select("id, opted_out_at")
        .single();
      if (error || !made) return { ok: false as const, result: "contact_create_failed" as const };
      contact = made;
    }

    const res = await sendWhatsAppTemplate(e164, data.template_name, "he");
    await recordDelivery({
      contactId: contact.id,
      text: `[template] ${data.template_name}`,
      result: res,
      kind: "quick_campaign_first_opening_admin_import",
    });
    await supabaseAdmin.from("gateway_campaign_dispatches").insert({
      batch_id: data.batch_id,
      phone: data.phone,
      name: data.name ?? null,
      template_name: data.template_name,
      gateway_status: res.status,
      created_by: context.userId,
    });
    return res.ok
      ? { ok: true as const, result: "sent" as const }
      : { ok: false as const, result: "send_failed" as const, status: res.status };
  });
