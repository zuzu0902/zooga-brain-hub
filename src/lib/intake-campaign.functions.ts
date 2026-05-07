import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SendSchema = z.object({
  campaign_name: z.string().trim().min(1).max(200),
  template_name: z.string().trim().min(1).max(100),
  lead_ids: z.array(z.string().uuid()).min(1).max(1000),
});

export const sendIntakeCampaign = createServerFn({ method: "POST" })
  .inputValidator((input) => SendSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: settings } = await supabaseAdmin
      .from("api_settings")
      .select("tamar_backend_url, tamar_backend_api_token")
      .eq("id", 1)
      .maybeSingle();

    if (!settings?.tamar_backend_url) {
      return { ok: false, error: "Tamar backend URL is not configured" };
    }

    const { data: leads, error: leadsErr } = await supabaseAdmin
      .from("imported_leads")
      .select("id, full_name, phone")
      .in("id", data.lead_ids);
    if (leadsErr) return { ok: false, error: leadsErr.message };
    if (!leads || leads.length === 0) return { ok: false, error: "No leads found" };

    const payload = {
      campaign_name: data.campaign_name,
      template_name: data.template_name,
      leads: leads.map((l) => ({
        lead_id: l.id,
        full_name: l.full_name,
        phone: l.phone,
      })),
    };

    const url = settings.tamar_backend_url.replace(/\/$/, "") + "/campaigns/intake";
    let tamarResponse: any = null;
    let httpStatus = 0;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(settings.tamar_backend_api_token
            ? { Authorization: `Bearer ${settings.tamar_backend_api_token}` }
            : {}),
        },
        body: JSON.stringify(payload),
      });
      httpStatus = res.status;
      tamarResponse = await res.json().catch(() => ({ raw: "non-json response" }));
      if (!res.ok) {
        await supabaseAdmin.from("intake_campaigns").insert({
          campaign_name: data.campaign_name,
          template_name: data.template_name,
          status: "failed",
          sent_count: 0,
          tamar_response: { http_status: httpStatus, body: tamarResponse },
        });
        return { ok: false, error: `Tamar backend returned ${httpStatus}`, response: tamarResponse };
      }
    } catch (e: any) {
      await supabaseAdmin.from("intake_campaigns").insert({
        campaign_name: data.campaign_name,
        template_name: data.template_name,
        status: "failed",
        sent_count: 0,
        tamar_response: { error: String(e?.message || e) },
      });
      return { ok: false, error: "Network error: " + (e?.message || String(e)) };
    }

    await supabaseAdmin
      .from("imported_leads")
      .update({
        import_status: "sent_to_tamar",
        whatsapp_template_status: "sent",
        last_message_at: new Date().toISOString(),
      })
      .in("id", data.lead_ids);

    const { data: campaign } = await supabaseAdmin
      .from("intake_campaigns")
      .insert({
        campaign_name: data.campaign_name,
        template_name: data.template_name,
        status: "sent",
        sent_count: leads.length,
        tamar_response: { http_status: httpStatus, body: tamarResponse },
      })
      .select("id")
      .single();

    return { ok: true, campaign_id: campaign?.id, sent_count: leads.length };
  });