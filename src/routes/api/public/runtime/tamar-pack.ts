/**
 * RUNTIME PACK — Zooga → Railway/Tamar
 *
 * Resolves a single, ready-to-consume context pack for Tamar runtime.
 * Zooga remains the source of truth: structured behavior settings,
 * versioned prompt/policy blocks, contact snapshot, recent interactions,
 * consent state, memories, internal inference pack, active offer/campaign
 * intelligence, and workflow/handoff state.
 *
 * Auth: x-api-token / ?token= must match api_settings.webhook_token
 * (mismatches are rejected here — unlike the inbound webhook, this is a
 *  pure server-to-server read).
 *
 * Query/body params (any of):
 *   contact_id, phone, whatsapp_number, facebook_id, email,
 *   campaign_id, offer_id
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { INTAKE_FLOWS, type IntakeFlowType } from "@/lib/intake-flows";

async function resolve(params: Record<string, any>) {
  const [{ data: settings }, behaviorRes, blocksRes] = await Promise.all([
    supabaseAdmin.from("api_settings").select("default_source, webhook_token").eq("id", 1).maybeSingle(),
    supabaseAdmin.from("tamar_behavior_settings" as any).select("*").eq("id", 1).maybeSingle(),
    supabaseAdmin.from("tamar_prompt_blocks" as any).select("block_key,title,body,version,is_active,updated_at").eq("is_active", true).order("block_key", { ascending: true }),
  ]);
  const behavior = (behaviorRes.data ?? null) as any;
  const blocks = (blocksRes.data ?? null) as any[] | null;
  void settings;

  // Contact lookup
  let contact: any = null;
  if (params.contact_id) {
    const { data } = await supabaseAdmin.from("contacts").select("*").eq("id", params.contact_id).maybeSingle();
    contact = data;
  }
  if (!contact && params.phone) {
    const p = String(params.phone).trim();
    const { data } = await supabaseAdmin.from("contacts").select("*").or(`phone.eq.${p},whatsapp_number.eq.${p}`).maybeSingle();
    contact = data;
  }
  if (!contact && params.whatsapp_number) {
    const { data } = await supabaseAdmin.from("contacts").select("*").eq("whatsapp_number", String(params.whatsapp_number).trim()).maybeSingle();
    contact = data;
  }
  if (!contact && params.facebook_id) {
    const { data } = await supabaseAdmin.from("contacts").select("*").eq("facebook_id", String(params.facebook_id)).maybeSingle();
    contact = data;
  }
  if (!contact && params.email) {
    const { data } = await supabaseAdmin.from("contacts").select("*").eq("email", String(params.email)).maybeSingle();
    contact = data;
  }

  // Per-contact data
  let interactions: any[] = [];
  let memories: any[] = [];
  let openHandoff: any = null;
  let openTasks: any[] = [];
  if (contact?.id) {
    const [a, b, c, d] = await Promise.all([
      supabaseAdmin.from("interactions").select("id,type,source,content,timestamp,campaign_id,related_offer_id").eq("contact_id", contact.id).order("timestamp", { ascending: false }).limit(20),
      supabaseAdmin.from("contact_memories").select("memory_type,memory_key,memory_value,confidence_score,source_message,created_at").eq("contact_id", contact.id).order("created_at", { ascending: false }).limit(50),
      supabaseAdmin.from("pending_ai_insights").select("id,category,field_name,proposed_value,confidence_score,reasoning,resolution_state,status,created_at").eq("contact_id", contact.id).in("resolution_state", ["pending", "under_human"]).order("created_at", { ascending: false }).limit(10),
      supabaseAdmin.from("tasks").select("id,title,description,status,priority,resolution_state,due_date").eq("contact_id", contact.id).neq("status", "done").limit(10),
    ]);
    interactions = a.data ?? [];
    memories = b.data ?? [];
    openHandoff = c.data ?? [];
    openTasks = d.data ?? [];
  }

  // Campaign + offer
  let campaign: any = null;
  if (params.campaign_id) {
    const { data } = await supabaseAdmin.from("campaigns").select("*").eq("id", params.campaign_id).maybeSingle();
    campaign = data;
  } else if (contact?.last_touch_campaign_id) {
    const { data } = await supabaseAdmin.from("campaigns").select("*").eq("id", contact.last_touch_campaign_id).maybeSingle();
    campaign = data;
  }

  let offer: any = null;
  const offerId = params.offer_id || campaign?.offer_id || null;
  if (offerId) {
    const { data } = await supabaseAdmin
      .from("offers")
      .select("id,title,offer_url,ai_summary,sales_angle,grounded_facts,faq_bundle,objection_notes,matching_tags,escalation_boundary,ingestion_status,last_ingested_at,price,category,description")
      .eq("id", offerId)
      .maybeSingle();
    offer = data;
  }

  // Internal inference pack — manager-only fields surfaced from contact row
  const internal_inference = contact
    ? {
        ai_summary: contact.ai_summary,
        ai_profile_notes: contact.ai_profile_notes,
        ai_recommended_next_action: contact.ai_recommended_next_action,
        ai_offer_fit: contact.ai_offer_fit,
        ai_risk_flags: contact.ai_risk_flags,
        ai_confidence_score: contact.ai_confidence_score,
        sales_temperature: contact.sales_temperature,
        purchase_intent: contact.purchase_intent,
        loneliness_signal: contact.loneliness_signal,
        manager_attention_required: contact.manager_attention_required,
        likely_needs: contact.likely_needs,
        objections: contact.objections,
        decision_triggers: contact.decision_triggers,
        emotional_profile: contact.emotional_profile,
        communication_style: contact.communication_style,
      }
    : null;

  const consent_state = contact
    ? {
        marketing: !!contact.consent_marketing,
        consent_date: contact.consent_date,
        timing_rule: behavior?.consent_timing_rule ?? "after_first_meaningful_reply",
      }
    : { marketing: false, consent_date: null, timing_rule: behavior?.consent_timing_rule ?? "after_first_meaningful_reply" };

  const flow = (campaign?.intake_flow_type || "generic") as IntakeFlowType;
  const flowDef = INTAKE_FLOWS[flow];

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source_of_truth: "zooga",
    contact: contact
      ? {
          id: contact.id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          full_name: contact.full_name,
          phone: contact.phone,
          whatsapp_number: contact.whatsapp_number,
          gender: contact.gender,
          city: contact.city,
          region: contact.region,
          age: contact.age,
          intake_status: contact.intake_status,
          status: contact.status,
          last_interaction_at: contact.last_interaction_at,
          preferred_language_style: contact.preferred_language_style,
        }
      : null,
    recent_interactions: interactions,
    consent_state,
    relevant_memories: memories,
    internal_inference_pack: {
      visibility: behavior?.internal_inference_visibility ?? "manager_only",
      data: internal_inference,
    },
    active_campaign: campaign
      ? {
          id: campaign.id,
          name: campaign.name,
          objective: campaign.objective,
          ai_goal: campaign.ai_goal,
          tone_style: campaign.tone_style,
          emotional_angle: campaign.emotional_angle,
          target_audience: campaign.target_audience,
          objections: campaign.objections,
          prohibited_promises: campaign.prohibited_promises,
          intake_flow_type: flow,
          intake_questions: flowDef.questions,
          intake_system_addendum: flowDef.system_addendum,
        }
      : null,
    active_offer: offer,
    tamar_settings: behavior
      ? {
          tone_preset: behavior.tone_preset,
          warmth_level: behavior.warmth_level,
          verbosity_level: behavior.verbosity_level,
          emoji_policy: behavior.emoji_policy,
          naturalness_level: behavior.naturalness_level,
          gender_language_sensitivity: behavior.gender_language_sensitivity,
          therapist_mode_disabled: behavior.therapist_mode_disabled,
          dating_counselor_mode_disabled: behavior.dating_counselor_mode_disabled,
          consent_timing_rule: behavior.consent_timing_rule,
          create_contact_on_first_unknown_phone: behavior.create_contact_on_first_unknown_phone,
          service_inquiry_is_lead: behavior.service_inquiry_is_lead,
          internal_inference_visibility: behavior.internal_inference_visibility,
          no_invention_rule: behavior.no_invention_rule,
          sales_aggressiveness: behavior.sales_aggressiveness,
          sales_max_followups_per_week: behavior.sales_max_followups_per_week,
          memory_write_policy: behavior.memory_write_policy,
          memory_kinds_enabled: behavior.memory_kinds_enabled,
          handoff_on_factual_doubt: behavior.handoff_on_factual_doubt,
          handoff_confidence_threshold: behavior.handoff_confidence_threshold,
          handoff_keywords: behavior.handoff_keywords,
          routing_mode: behavior.routing_mode,
          routing_allow_autonomous_offers: behavior.routing_allow_autonomous_offers,
          routing_allow_autonomous_campaigns: behavior.routing_allow_autonomous_campaigns,
          confidence_auto_apply_min: behavior.confidence_auto_apply_min,
          confidence_pending_max: behavior.confidence_pending_max,
          confidence_high_min: behavior.confidence_high_min,
          confidence_medium_min: behavior.confidence_medium_min,
          updated_at: behavior.updated_at,
        }
      : null,
    prompt_blocks: (blocks ?? []).reduce((acc: Record<string, any>, b: any) => {
      acc[b.block_key] = { title: b.title, body: b.body, version: b.version, updated_at: b.updated_at };
      return acc;
    }, {}),
    workflow_state: {
      open_handoffs: openHandoff,
      open_tasks: openTasks,
    },
  };
}

export const Route = createFileRoute("/api/public/runtime/tamar-pack")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const provided = request.headers.get("x-api-token") || url.searchParams.get("token");
        const { data: settings } = await supabaseAdmin.from("api_settings").select("webhook_token").eq("id", 1).maybeSingle();
        if (settings?.webhook_token && settings.webhook_token !== provided) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        const params: Record<string, any> = {};
        for (const [k, v] of url.searchParams.entries()) params[k] = v;
        const pack = await resolve(params);
        return Response.json(pack);
      },
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({} as any));
        const provided = request.headers.get("x-api-token") || body?.token;
        const { data: settings } = await supabaseAdmin.from("api_settings").select("webhook_token").eq("id", 1).maybeSingle();
        if (settings?.webhook_token && settings.webhook_token !== provided) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        const pack = await resolve(body || {});
        return Response.json(pack);
      },
    },
  },
});