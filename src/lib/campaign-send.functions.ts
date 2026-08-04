import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const LaunchInput = z.object({
  campaign_name: z.string().trim().min(1).max(200),
  template_name: z.string().trim().min(1).max(120),
  language_code: z.string().trim().min(2).max(10).default("he"),
  lead_ids: z.array(z.string().uuid()).min(1).max(1000),
  batch_size: z.number().int().min(1).max(25).default(10),
  offer_id: z.string().uuid().optional().nullable(),
  dry_run: z.boolean().optional(),
});

/** Validate a template against Meta without launching anything. */
export const checkTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ template_name: z.string().trim().min(1).max(120), language_code: z.string().trim().min(2).max(10) }).parse(input))
  .handler(async ({ data }) => {
    const { validateTemplateForLaunch } = await import("@/lib/whatsapp-templates.server");
    return validateTemplateForLaunch(data.template_name, data.language_code);
  });

/** List every template on the WABA (name/status/language only — never tokens). */
export const listTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { listMetaTemplates } = await import("@/lib/whatsapp-templates.server");
    return listMetaTemplates();
  });

/**
 * Create the campaign + membership rows. Sends nothing.
 * Blocked when the template is not APPROVED for the requested language.
 */
export const launchIntakeCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => LaunchInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { validateTemplateForLaunch } = await import("@/lib/whatsapp-templates.server");
    const { ensureContactsForLeads } = await import("@/lib/lead-contacts.server");

    const dryRun = !!data.dry_run;
    if (!dryRun) {
      const gate = await validateTemplateForLaunch(data.template_name, data.language_code);
      if (!gate.ok) return { ok: false, error: gate.reason, template_status: gate.status };
    }

    const link = await ensureContactsForLeads(data.lead_ids);

    const { data: campaign, error: cErr } = await supabaseAdmin
      .from("intake_campaigns")
      .insert({
        campaign_name: data.campaign_name,
        template_name: data.template_name,
        language_code: data.language_code,
        batch_size: data.batch_size,
        offer_id: data.offer_id ?? null,
        status: "queued",
        control_state: "running",
        total_count: data.lead_ids.length,
      } as any)
      .select("id")
      .single();
    if (cErr || !campaign) return { ok: false, error: cErr?.message ?? "campaign_create_failed" };

    // consent gate at enrolment time; opted-out leads are enrolled as opted_out
    const { data: contacts } = await supabaseAdmin
      .from("contacts")
      .select("id, consent_marketing, opted_out_at")
      .in("id", Object.values(link.byLead));
    const consentById = new Map((contacts ?? []).map((c: any) => [c.id, !!c.consent_marketing && !c.opted_out_at]));

    const members = data.lead_ids
      .filter((leadId) => link.byLead[leadId])
      .map((leadId) => ({
        intake_campaign_id: campaign.id,
        contact_id: link.byLead[leadId]!,
        imported_lead_id: leadId,
        offer_id: data.offer_id ?? null,
        idempotency_key: `${campaign.id}:${leadId}`,
        send_state: consentById.get(link.byLead[leadId]!) ? "queued" : "opted_out",
        first_touch: true,
      }));

    const { error: mErr } = await supabaseAdmin
      .from("campaign_contacts")
      .upsert(members as any, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (mErr) return { ok: false, error: mErr.message, campaign_id: campaign.id };

    await supabaseAdmin
      .from("imported_leads")
      .update({ intake_campaign_id: campaign.id, send_state: "queued" } as any)
      .in("id", data.lead_ids);

    return {
      ok: true,
      campaign_id: campaign.id,
      enrolled: members.length,
      queued: members.filter((m) => m.send_state === "queued").length,
      blocked_no_consent: members.filter((m) => m.send_state === "opted_out").length,
      contacts_created: link.created,
      dry_run: dryRun,
    };
  });

/** Send one batch. The UI calls this repeatedly until remaining === 0. */
export const sendCampaignBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      campaign_id: z.string().uuid(),
      batch_size: z.number().int().min(1).max(25).optional(),
      dry_run: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { runCampaignBatch, DEFAULT_BATCH } = await import("@/lib/campaign-send.server");
    return runCampaignBatch(data.campaign_id, data.batch_size ?? DEFAULT_BATCH, !!data.dry_run);
  });

export const setCampaignControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      campaign_id: z.string().uuid(),
      control: z.enum(["running", "paused", "stopped"]),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("intake_campaigns")
      .update({ control_state: data.control, ...(data.control === "stopped" ? { status: "stopped" } : {}) } as any)
      .eq("id", data.campaign_id);
    return error ? { ok: false, error: error.message } : { ok: true, control: data.control };
  });

export const retryCampaignFailures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ campaign_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { requeueRetryables } = await import("@/lib/campaign-send.server");
    const requeued = await requeueRetryables(data.campaign_id);
    return { ok: true, requeued };
  });

export const getCampaignSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ campaign_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: campaign } = await supabaseAdmin
      .from("intake_campaigns")
      .select("*")
      .eq("id", data.campaign_id)
      .maybeSingle();
    const { data: rows } = await supabaseAdmin
      .from("campaign_contacts")
      .select("send_state")
      .eq("intake_campaign_id", data.campaign_id);
    const counts: Record<string, number> = {};
    for (const r of (rows ?? []) as any[]) counts[r.send_state] = (counts[r.send_state] ?? 0) + 1;
    return { ok: !!campaign, campaign, counts, total: rows?.length ?? 0 };
  });
