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
import { buildTamarRuntimeComposition } from "@/lib/tamar-runtime-composition";

function buildOfferIntelligenceBlock(offer: any) {
  if (!offer) return null;
  const lines: string[] = [`# אינטליגנציית מוצר: ${offer.title}`];
  if (offer.ai_summary) lines.push(`סיכום: ${offer.ai_summary}`);
  if (offer.sales_angle) lines.push(`זווית מכירה: ${offer.sales_angle}`);
  if (offer.offer_url) lines.push(`מקור עובדתי: ${offer.offer_url}`);
  if (offer.grounded_facts && typeof offer.grounded_facts === "object" && Object.keys(offer.grounded_facts).length) {
    lines.push(`עובדות מבוססות (אין לחרוג מהן):\n${JSON.stringify(offer.grounded_facts, null, 2)}`);
  }
  const faq = Array.isArray(offer.faq_bundle) ? offer.faq_bundle : [];
  if (faq.length) lines.push(`שאלות נפוצות:\n${faq.map((f: any, i: number) => `${i + 1}. ש: ${f.q || f.question}\n   ת: ${f.a || f.answer}`).join("\n")}`);
  const objections = Array.isArray(offer.objection_notes) ? offer.objection_notes : [];
  if (objections.length) lines.push(`התנגדויות ומענה:\n${objections.map((o: any, i: number) => `${i + 1}. ${o.objection || o.q}: ${o.response || o.a}`).join("\n")}`);
  if (Array.isArray(offer.matching_tags) && offer.matching_tags.length) lines.push(`תגי התאמה: ${offer.matching_tags.join(", ")}`);
  if (offer.escalation_boundary && typeof offer.escalation_boundary === "object") {
    const canAns = Array.isArray(offer.escalation_boundary.tamar_can_answer) ? offer.escalation_boundary.tamar_can_answer : [];
    const mustEsc = Array.isArray(offer.escalation_boundary.must_escalate) ? offer.escalation_boundary.must_escalate : [];
    if (canAns.length) lines.push(`תמר יכולה לענות על: ${canAns.join(", ")}`);
    if (mustEsc.length) lines.push(`חובה להעביר לאדם בנושאים: ${mustEsc.join(", ")}`);
  }
  lines.push("כלל הזהב: אם המידע לא מופיע למעלה — אל תמציאי. אמרי בכנות שאת מבררת ותעבירי לבן אדם.");
  return lines.join("\n");
}

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

  const promptBlocksMap = (blocks ?? []).reduce((acc: Record<string, any>, b: any) => {
    acc[b.block_key] = { title: b.title, body: b.body, version: b.version, updated_at: b.updated_at };
    return acc;
  }, {});

  const campaignContextText = campaign
    ? [
        `# הקשר קמפיין: ${campaign.name}`,
        campaign.objective ? `מטרה: ${campaign.objective}` : "",
        campaign.ai_goal ? `יעד AI: ${campaign.ai_goal}` : "",
        campaign.tone_style ? `טון: ${campaign.tone_style}` : "",
        campaign.emotional_angle ? `זווית רגשית: ${campaign.emotional_angle}` : "",
        campaign.target_audience ? `קהל יעד: ${campaign.target_audience}` : "",
        campaign.objections?.length ? `התנגדויות: ${campaign.objections.join(", ")}` : "",
        campaign.prohibited_promises?.length ? `אסור להבטיח: ${campaign.prohibited_promises.join(", ")}` : "",
        `שאלות אינטייק:\n- ${flowDef.questions.join("\n- ")}`,
        `הוראת התנהגות: ${flowDef.system_addendum}`,
      ].filter(Boolean).join("\n")
    : null;
  const offerIntelligenceText = buildOfferIntelligenceBlock(offer);
  const offerHasGrounding = !!offer && ((offer.grounded_facts && Object.keys(offer.grounded_facts).length > 0) || (Array.isArray(offer.faq_bundle) && offer.faq_bundle.length > 0));
  const offerFieldsInjected = offer
    ? Object.entries({
        ai_summary: !!offer.ai_summary,
        sales_angle: !!offer.sales_angle,
        grounded_facts: !!offer.grounded_facts && Object.keys(offer.grounded_facts).length > 0,
        faq_bundle: Array.isArray(offer.faq_bundle) && offer.faq_bundle.length > 0,
        objection_notes: Array.isArray(offer.objection_notes) && offer.objection_notes.length > 0,
        matching_tags: Array.isArray(offer.matching_tags) && offer.matching_tags.length > 0,
        escalation_boundary: !!offer.escalation_boundary && Object.keys(offer.escalation_boundary).length > 0,
      }).filter(([, v]) => v).map(([k]) => k)
    : [];
  const escalationFallback = !!offer && !offerHasGrounding;
  const runtimeComposition = buildTamarRuntimeComposition({
    inboundMessage: params.message || params.text || null,
    source: "runtime_pack",
    contact,
    campaign,
    campaignContextText,
    offer,
    offerIntelligenceText,
    tamarSettings: behavior,
    promptBlocks: promptBlocksMap,
    escalationFallback,
    escalationReason: escalationFallback ? "offer_intelligence_missing_grounded_knowledge" : null,
    offerFieldsInjected,
  });

  const observability = {
    generated_at: new Date().toISOString(),
    contact_id: contact?.id || null,
    campaign_injected: !!campaign,
    campaign_id: campaign?.id || null,
    offer_intelligence_injected: !!offer,
    offer_id: offer?.id || null,
    offer_fields_injected: offerFieldsInjected,
    tamar_settings_version_at: behavior?.updated_at || null,
    prompt_blocks_injected: Object.entries(promptBlocksMap).map(([k, v]: [string, any]) => ({
      key: k,
      version: v?.version ?? null,
      updated_at: v?.updated_at ?? null,
    })),
    fallback_default_prompt_behavior: Object.keys(promptBlocksMap).length === 0,
    prompt_composition: {
      composed_runtime_prompt_available: true,
      composed_runtime_prompt_injected_for_tamar: true,
      zooga_direct_model_call: false,
      model_call_owner: "railway_tamar_runtime",
      fallback_default_prompt_path: runtimeComposition.tracePromptContext.fallback_default_prompt_path,
      injected_sections: runtimeComposition.tracePromptContext.injected_sections,
    },
    composed_runtime_prompt_context: runtimeComposition.tracePromptContext,
    runtime_pack_sections: [
      "tamar_settings",
      "prompt_blocks",
      contact ? "contact" : null,
      contact ? "recent_interactions" : null,
      contact ? "relevant_memories" : null,
      "internal_inference_pack",
      campaign ? "active_campaign" : null,
      offer ? "active_offer" : null,
      "consent_state",
      "workflow_state",
    ].filter(Boolean) as string[],
    lookup_params: {
      contact_id: params.contact_id || null,
      phone: params.phone || null,
      whatsapp_number: params.whatsapp_number || null,
      facebook_id: params.facebook_id || null,
      email: params.email || null,
      campaign_id: params.campaign_id || null,
      offer_id: params.offer_id || null,
    },
  };

  // Fire-and-forget trace insert; never blocks the pack response.
  void supabaseAdmin
    .from("webhook_logs")
    .insert({ source: "tamar_runtime_pack", status: "tamar_runtime_trace", payload: observability })
    .then(() => {});

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
    offer_intelligence_context: offerIntelligenceText,
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
    prompt_blocks: promptBlocksMap,
    runtime_prompt_context: runtimeComposition.runtimePromptContext,
    workflow_state: {
      open_handoffs: openHandoff,
      open_tasks: openTasks,
    },
    _observability: observability,
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