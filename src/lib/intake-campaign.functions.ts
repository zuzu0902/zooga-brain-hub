import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SendSchema = z.object({
  campaign_name: z.string().trim().min(1).max(200),
  template_name: z.string().trim().min(1).max(100),
  language_code: z.string().trim().min(2).max(10).optional(),
  lead_ids: z.array(z.string().uuid()).min(1).max(1000),
});

/**
 * Intake campaign — sends an APPROVED WhatsApp template directly through the
 * Meta Graph API, one lead at a time, with per-lead status in Supabase.
 * No external brain, no Railway. Safe to re-run: leads already marked as
 * sent/delivered/read/replied are skipped.
 */
export const sendIntakeCampaign = createServerFn({ method: "POST" })
  .inputValidator((input) => SendSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWhatsAppTemplate, recordDelivery, metaConfigPresence } = await import(
      "@/lib/whatsapp-meta.server"
    );

    const presence = metaConfigPresence();
    if (!presence.whatsapp_access_token || !presence.whatsapp_phone_number_id) {
      return { ok: false, error: "WhatsApp sending is not configured" };
    }

    const { data: leads, error: leadsErr } = await supabaseAdmin
      .from("imported_leads")
      .select("id, full_name, phone, whatsapp_template_status")
      .in("id", data.lead_ids);
    if (leadsErr) return { ok: false, error: leadsErr.message };
    if (!leads?.length) return { ok: false, error: "No leads found" };

    const SKIP = new Set(["sent", "delivered", "read", "replied"]);
    const lang = data.language_code ?? "he";

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const results: any[] = [];

    for (const lead of leads) {
      if (SKIP.has(String(lead.whatsapp_template_status))) {
        skipped++;
        results.push({ lead_id: lead.id, skipped: true });
        continue;
      }
      if (!lead.phone) {
        failed++;
        await supabaseAdmin
          .from("imported_leads")
          .update({ whatsapp_template_status: "failed", notes: "missing phone" } as any)
          .eq("id", lead.id);
        results.push({ lead_id: lead.id, ok: false, error: "missing_phone" });
        continue;
      }

      const res = await sendWhatsAppTemplate(lead.phone, data.template_name, lang);
      await recordDelivery({
        contactId: null,
        text: `[template] ${data.template_name}`,
        result: res,
        kind: "intake_template",
      });

      await supabaseAdmin
        .from("imported_leads")
        .update({
          whatsapp_template_status: res.ok ? "sent" : "failed",
          import_status: res.ok ? "sent_to_tamar" : "failed",
          last_message_at: res.ok ? new Date().toISOString() : null,
          ...(res.ok ? {} : { notes: res.error?.slice(0, 300) ?? "send failed" }),
        } as any)
        .eq("id", lead.id);

      if (res.ok) sent++;
      else failed++;
      results.push({ lead_id: lead.id, ok: res.ok, error: res.error });
    }

    const { data: campaign } = await supabaseAdmin
      .from("intake_campaigns")
      .insert({
        campaign_name: data.campaign_name,
        template_name: data.template_name,
        status: failed && !sent ? "failed" : "sent",
        sent_count: sent,
        tamar_response: { transport: "meta_direct", sent, failed, skipped },
      })
      .select("id")
      .single();

    return { ok: sent > 0, campaign_id: campaign?.id, sent_count: sent, failed, skipped, results };
  });
