/**
 * INTAKE CAMPAIGN SEND ENGINE (server-only).
 *
 * State machine per campaign_contact:
 *   queued -> sending -> sent -> delivered -> read -> replied
 *                     \-> failed_retryable (429/5xx, attempts < MAX)
 *                     \-> failed_permanent (4xx other, or attempts exhausted)
 *                     \-> opted_out (consent revoked / no consent)
 *
 * Guarantees:
 *  - idempotency_key = `${campaign_id}:${lead_id}` with a UNIQUE index, so a
 *    double click or a retry can never create or send a second message.
 *  - only rows in `queued` are claimed, via a conditional UPDATE (compare-and-set).
 *  - the campaign control_state is re-read BETWEEN every single item.
 *  - consent_marketing must be true at send time, re-checked per item.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppTemplate, recordDelivery } from "@/lib/whatsapp-meta.server";

export const MAX_BATCH = 25;
export const DEFAULT_BATCH = 10;
export const MAX_ATTEMPTS = 3;
const THROTTLE_MS = 1100;

export type BatchResult = {
  ok: boolean;
  error?: string;
  campaign_id: string;
  control_state: string;
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  opted_out: number;
  remaining: number;
  dry_run: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function classify(status: number): "retryable" | "permanent" {
  if (status === 429 || status >= 500 || status === 0) return "retryable";
  return "permanent";
}

async function readControl(campaignId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("intake_campaigns")
    .select("control_state")
    .eq("id", campaignId)
    .maybeSingle();
  return (data as any)?.control_state ?? "stopped";
}

async function refreshCounters(campaignId: string) {
  const { data: rows } = await supabaseAdmin
    .from("campaign_contacts")
    .select("send_state")
    .eq("intake_campaign_id", campaignId);
  const all = (rows ?? []) as any[];
  const sent = all.filter((r) => ["sent", "delivered", "read", "replied"].includes(r.send_state)).length;
  const failed = all.filter((r) => String(r.send_state).startsWith("failed")).length;
  const skipped = all.filter((r) => r.send_state === "opted_out").length;
  const done = all.every((r) => r.send_state !== "queued" && r.send_state !== "sending");
  await supabaseAdmin
    .from("intake_campaigns")
    .update({
      sent_count: sent,
      failed_count: failed,
      skipped_count: skipped,
      total_count: all.length,
      status: done ? (sent ? "sent" : "failed") : "sending",
    } as any)
    .eq("id", campaignId);
  return { sent, failed, skipped };
}

/** Process at most `limit` queued members. Safe to call repeatedly. */
export async function runCampaignBatch(
  campaignId: string,
  limit: number,
  dryRun: boolean,
): Promise<BatchResult> {
  const size = Math.max(1, Math.min(limit || DEFAULT_BATCH, MAX_BATCH));
  const base: BatchResult = {
    ok: true,
    campaign_id: campaignId,
    control_state: "running",
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    opted_out: 0,
    remaining: 0,
    dry_run: dryRun,
  };

  const { data: campaign } = await supabaseAdmin
    .from("intake_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return { ...base, ok: false, error: "campaign_not_found" };

  const templateName = (campaign as any).template_name as string;
  const language = ((campaign as any).language_code as string) || "he";

  const { data: queued } = await supabaseAdmin
    .from("campaign_contacts")
    .select("id, contact_id, imported_lead_id, attempts, send_state")
    .eq("intake_campaign_id", campaignId)
    .eq("send_state", "queued")
    .order("joined_at", { ascending: true })
    .limit(size);

  for (const member of (queued ?? []) as any[]) {
    // control is re-read between every item
    const control = await readControl(campaignId);
    base.control_state = control;
    if (control !== "running") break;

    // claim (compare-and-set) — two concurrent runs cannot both take this row
    const { data: claimed } = await supabaseAdmin
      .from("campaign_contacts")
      .update({ send_state: "sending" } as any)
      .eq("id", member.id)
      .eq("send_state", "queued")
      .select("id");
    if (!claimed?.length) continue;

    base.processed++;

    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, phone, whatsapp_number, first_name, full_name, consent_marketing, opted_out_at")
      .eq("id", member.contact_id)
      .maybeSingle();

    const to = (contact as any)?.whatsapp_number || (contact as any)?.phone || null;
    const consentOk = !!(contact as any)?.consent_marketing && !(contact as any)?.opted_out_at;

    if (!to || !consentOk) {
      const state = !to ? "failed_permanent" : "opted_out";
      const err = !to ? "missing_phone" : "no_marketing_consent";
      await supabaseAdmin
        .from("campaign_contacts")
        .update({ send_state: state, last_error: err, opted_out_at: state === "opted_out" ? new Date().toISOString() : null } as any)
        .eq("id", member.id);
      if (member.imported_lead_id) {
        await supabaseAdmin
          .from("imported_leads")
          .update({
            send_state: state,
            last_error: err,
            ...(state === "opted_out"
              ? { import_status: "opted_out", opted_out_at: new Date().toISOString() }
              : { whatsapp_template_status: "failed", import_status: "failed" }),
          } as any)
          .eq("id", member.imported_lead_id);
      }
      if (state === "opted_out") base.opted_out++;
      else base.failed++;
      continue;
    }

    const firstName = (contact as any)?.first_name || String((contact as any)?.full_name ?? "").split(" ")[0] || "חבר";
    const components = [{ type: "body", parameters: [{ type: "text", text: firstName }] }];

    const res = dryRun
      ? { ok: true, provider_message_id: `dryrun-${member.id}`, status: 200, error: null }
      : await sendWhatsAppTemplate(to, templateName, language, components);

    const attempts = (member.attempts ?? 0) + 1;
    const nowIso = new Date().toISOString();

    if (res.ok) {
      await supabaseAdmin
        .from("campaign_contacts")
        .update({
          send_state: "sent",
          attempts,
          sent_at: nowIso,
          provider_message_id: res.provider_message_id,
          last_error: null,
          last_activity_at: nowIso,
        } as any)
        .eq("id", member.id);
      if (member.imported_lead_id) {
        await supabaseAdmin
          .from("imported_leads")
          .update({
            send_state: "sent",
            attempts,
            whatsapp_template_status: "sent",
            import_status: "sent_to_tamar",
            sent_at: nowIso,
            last_message_at: nowIso,
            provider_message_id: res.provider_message_id,
            last_error: null,
            intake_campaign_id: campaignId,
          } as any)
          .eq("id", member.imported_lead_id);
      }
      base.sent++;
    } else {
      const kind = classify(res.status);
      const exhausted = attempts >= MAX_ATTEMPTS;
      const state = kind === "retryable" && !exhausted ? "failed_retryable" : "failed_permanent";
      const safeError = String(res.error ?? "send_failed").slice(0, 300);
      await supabaseAdmin
        .from("campaign_contacts")
        .update({ send_state: state, attempts, last_error: safeError, last_activity_at: nowIso } as any)
        .eq("id", member.id);
      if (member.imported_lead_id) {
        await supabaseAdmin
          .from("imported_leads")
          .update({
            send_state: state,
            attempts,
            last_error: safeError,
            whatsapp_template_status: "failed",
            import_status: "failed",
          } as any)
          .eq("id", member.imported_lead_id);
      }
      base.failed++;
    }

    if (!dryRun) {
      await recordDelivery({
        contactId: member.contact_id,
        text: `[template] ${templateName}`,
        result: res as any,
        kind: "intake_template",
      });
      // exponential backoff only for retryable failures, plain throttle otherwise
      const backoff = !res.ok && classify(res.status) === "retryable" ? THROTTLE_MS * 2 ** attempts : THROTTLE_MS;
      await sleep(Math.min(backoff, 15000));
    }
  }

  const { count } = await supabaseAdmin
    .from("campaign_contacts")
    .select("id", { count: "exact", head: true })
    .eq("intake_campaign_id", campaignId)
    .eq("send_state", "queued");
  base.remaining = count ?? 0;

  await refreshCounters(campaignId);
  base.control_state = await readControl(campaignId);
  return base;
}

/** Reset retryable failures back to queued (bounded by MAX_ATTEMPTS). */
export async function requeueRetryables(campaignId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("campaign_contacts")
    .update({ send_state: "queued" } as any)
    .eq("intake_campaign_id", campaignId)
    .eq("send_state", "failed_retryable")
    .lt("attempts", MAX_ATTEMPTS)
    .select("id, imported_lead_id");
  const ids = ((data ?? []) as any[]).map((r) => r.imported_lead_id).filter(Boolean);
  if (ids.length) {
    await supabaseAdmin.from("imported_leads").update({ send_state: "queued" } as any).in("id", ids);
  }
  return data?.length ?? 0;
}
