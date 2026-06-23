import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { INTAKE_FLOWS, buildSuggestedOpening, type IntakeFlowType } from "@/lib/intake-flows";
import { buildTamarRuntimeComposition } from "@/lib/tamar-runtime-composition";
import { buildPricingStateBlock } from "@/lib/offer-pricing-block";
import { claimInbound, extractInboundMessageId } from "@/lib/runtime-inbound-dedupe";

function triggerExtraction(request: Request, contactId: string) {
  try {
    const url = new URL("/api/public/intelligence/extract", request.url);
    // Fire-and-forget; do not await body
    void fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: contactId }),
    }).catch(() => {});
  } catch {}
}

function buildCampaignContext(campaign: any, contact: any) {
  const flow = (campaign.intake_flow_type || "generic") as IntakeFlowType;
  const flowDef = INTAKE_FLOWS[flow];
  const firstName = contact?.first_name || (contact?.full_name ? String(contact.full_name).split(" ")[0] : null);
  const suggested_opening = buildSuggestedOpening({
    contactName: firstName, campaignName: campaign.name, flow, emotionalAngle: campaign.emotional_angle,
  });
  const campaign_context = [
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
    `כלל בטיחות: אם יש ספק עובדתי — להעביר למנהל אנושי, לא להמציא.`,
  ].filter(Boolean).join("\n");
  return {
    intake_flow_type: flow,
    suggested_opening,
    campaign_context,
    questions: flowDef.questions,
    should_escalate: false,
  };
}

function buildOfferIntelligenceBlock(offer: any) {
  if (!offer) return null;
  const lines: string[] = [`# אינטליגנציית מוצר: ${offer.title}`];
  const pricing = buildPricingStateBlock(offer);
  if (pricing) lines.push(pricing);
  if (offer.ai_summary) lines.push(`סיכום: ${offer.ai_summary}`);
  if (offer.sales_angle) lines.push(`זווית מכירה: ${offer.sales_angle}`);
  if (offer.offer_url) lines.push(`מקור עובדתי: ${offer.offer_url}`);
  const facts = offer.grounded_facts && typeof offer.grounded_facts === "object" ? offer.grounded_facts : null;
  if (facts && Object.keys(facts).length) {
    lines.push(`עובדות מבוססות (אין לחרוג מהן):\n${JSON.stringify(facts, null, 2)}`);
  }
  const faq = Array.isArray(offer.faq_bundle) ? offer.faq_bundle : [];
  if (faq.length) {
    lines.push(
      `שאלות נפוצות:\n` +
        faq.map((f: any, i: number) => `${i + 1}. ש: ${f.q || f.question}\n   ת: ${f.a || f.answer}`).join("\n"),
    );
  }
  const objs = Array.isArray(offer.objection_notes) ? offer.objection_notes : [];
  if (objs.length) {
    lines.push(
      `התנגדויות ומענה:\n` +
        objs.map((o: any, i: number) => `${i + 1}. ${o.objection || o.q}: ${o.response || o.a}`).join("\n"),
    );
  }
  if (Array.isArray(offer.matching_tags) && offer.matching_tags.length) {
    lines.push(`תגי התאמה: ${offer.matching_tags.join(", ")}`);
  }
  const esc = offer.escalation_boundary && typeof offer.escalation_boundary === "object" ? offer.escalation_boundary : null;
  if (esc) {
    const canAns = Array.isArray(esc.tamar_can_answer) ? esc.tamar_can_answer : [];
    const mustEsc = Array.isArray(esc.must_escalate) ? esc.must_escalate : [];
    if (canAns.length) lines.push(`תמר יכולה לענות על: ${canAns.join(", ")}`);
    if (mustEsc.length) lines.push(`חובה להעביר לאדם בנושאים: ${mustEsc.join(", ")}`);
  }
  lines.push(
    `כלל הזהב: אם המידע לא מופיע למעלה — אל תמציאי. אמרי בכנות שאת מבררת ותעבירי לבן אדם.`,
  );
  return lines.join("\n");
}

export const Route = createFileRoute("/api/public/webhook/tamar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Facebook webhook verification (hub.challenge)
        const url = new URL(request.url);
        const challenge = url.searchParams.get("hub.challenge");
        if (challenge) return new Response(challenge, { status: 200 });
        return new Response("ok", { status: 200 });
      },
      POST: async ({ request }) => {
        let payload: any = null;
        try {
          payload = await request.json().catch(() => null);

          // ---------- STRICT INBOUND IDEMPOTENCY (wamid) ----------
          // Meta retries webhook deliveries when it does not see a fast 200.
          // Before we touch contacts, interactions, runtime traces, or fire
          // off any reply path, claim this inbound message id. If we've
          // already seen it, return 200 immediately so Meta stops retrying
          // and Railway does not regenerate/resend a duplicate Tamar reply.
          const inboundMessageId = extractInboundMessageId(payload);
          if (inboundMessageId) {
            const dedupeClaim = await claimInbound({
              inboundMessageId,
              phone:
                payload?.phone ||
                payload?.whatsapp_number ||
                payload?.from?.phone ||
                null,
              source: "meta_webhook_tamar",
            });
            if (dedupeClaim.duplicate) {
              await supabaseAdmin.from("webhook_logs").insert({
                source: "tamar_bot",
                status: "duplicate_inbound_suppressed",
                payload: {
                  inbound_message_id: inboundMessageId,
                  duplicate_detected: true,
                  reply_sent: false,
                  dedupe_source: dedupeClaim.dedupe_source,
                  hit_count: dedupeClaim.hit_count,
                  first_seen_at: dedupeClaim.first_seen_at,
                },
              });
              return Response.json({
                ok: true,
                inbound_message_id: inboundMessageId,
                duplicate_detected: true,
                reply_sent: false,
                dedupe_source: dedupeClaim.dedupe_source,
                hit_count: dedupeClaim.hit_count,
                first_seen_at: dedupeClaim.first_seen_at,
              });
            }
          }

          // Optional token check from api_settings or query param
          const url = new URL(request.url);
          const providedToken =
            request.headers.get("x-api-token") ||
            url.searchParams.get("token") ||
            payload?.token ||
            null;

          const { data: settings } = await supabaseAdmin
            .from("api_settings")
            .select("webhook_token, default_source")
            .eq("id", 1)
            .maybeSingle();

          // Token mismatch is logged as a warning but NEVER blocks processing.
          // Losing a real conversation is worse than accepting an unauth payload —
          // we'd rather flag the contact for manager attention than drop the message.
          const tokenInvalid =
            !!settings?.webhook_token && settings.webhook_token !== providedToken;

          await supabaseAdmin.from("webhook_logs").insert({
            source: "tamar_bot",
            payload,
            status: tokenInvalid ? "received_unauth" : "received",
            error: tokenInvalid ? "Invalid token (processed anyway)" : null,
          });

          // Normalize fields. Accept multiple shapes.
          const rawPhone =
            payload?.phone ||
            payload?.whatsapp_number ||
            payload?.from?.phone ||
            null;
          const phone = rawPhone ? String(rawPhone).trim() : null;
          const whatsapp_number =
            (payload?.whatsapp_number ? String(payload.whatsapp_number).trim() : null) || phone;
          const facebook_id =
            payload?.facebook_id ||
            payload?.fb_id ||
            payload?.sender?.id ||
            payload?.from?.id ||
            null;
          const email = payload?.email || payload?.from?.email || null;
          const name =
            payload?.name ||
            payload?.full_name ||
            payload?.from?.name ||
            payload?.sender?.name ||
            null;
          const message =
            payload?.message ||
            payload?.text ||
            payload?.content ||
            payload?.message?.text ||
            null;
          const source = (payload?.source || settings?.default_source || "Tamar WhatsApp") as string;
          const intake_status = payload?.intake_status || null;
          const isWhatsApp = /whatsapp/i.test(source);

          // Whitelist of known structured fields Tamar may send (besides routing/identity).
          const KNOWN_KEYS = new Set([
            "phone","whatsapp_number","facebook_id","fb_id","email","name","full_name","first_name","last_name",
            "message","text","content","source","intake_status","preferred_language_style","gender",
            "from","sender","token",
            "ai_summary","ai_profile_notes","ai_recommended_next_action","ai_offer_fit","ai_risk_flags","ai_confidence_score",
            "emotional_profile","communication_style","social_profile","sales_profile","price_sensitivity",
            "likely_needs","decision_triggers","objections","loneliness_signal","openness_score",
            "relationship_readiness","community_fit_score","vip_potential","manager_attention_required",
            "sales_temperature","purchase_intent","activity_score","age","age_range","city","region",
            "birth_date","relationship_status","interests","tags","lifestyle_tags","preferred_events",
            "hobbies","travel_preferences","favorite_activity_types","availability_preferences",
            "personality_tags","emotional_needs","relationship_goals","social_goals",
            "preferred_trip_style","preferred_social_style","budget_sensitivity",
            "last_clicked_offer","last_campaign","campaigns_received","offers_sent",
            "events_interested","events_joined","trips_interested","total_revenue",
            "next_best_offer","recommended_campaign","dynamic_profile_fields",
          ]);

          // Build patch of structured AI / profile fields if Tamar sent them.
          const STRUCTURED_TEXT = [
            "ai_summary","ai_profile_notes","ai_recommended_next_action","ai_offer_fit","ai_risk_flags",
            "emotional_profile","communication_style","social_profile","sales_profile","price_sensitivity",
            "loneliness_signal","relationship_readiness","vip_potential","sales_temperature","purchase_intent",
            "age_range","city","region","relationship_status","preferred_trip_style","preferred_social_style",
            "budget_sensitivity","last_clicked_offer","last_campaign","next_best_offer","recommended_campaign",
          ];
          const STRUCTURED_NUM = [
            "ai_confidence_score","openness_score","community_fit_score","activity_score","age","total_revenue",
          ];
          const STRUCTURED_BOOL = ["manager_attention_required"];
          const STRUCTURED_ARR = [
            "interests","tags","lifestyle_tags","preferred_events","hobbies","travel_preferences",
            "favorite_activity_types","availability_preferences","personality_tags","emotional_needs",
            "relationship_goals","social_goals","likely_needs","decision_triggers","objections",
            "campaigns_received","offers_sent","events_interested","events_joined","trips_interested",
          ];
          const STRUCTURED_DATE = ["birth_date"];

          function buildEnrichment(): Record<string, any> {
            const out: Record<string, any> = {};
            for (const k of STRUCTURED_TEXT)
              if (payload?.[k] !== undefined && payload?.[k] !== null) out[k] = String(payload[k]);
            for (const k of STRUCTURED_NUM)
              if (payload?.[k] !== undefined && payload?.[k] !== null && payload?.[k] !== "")
                out[k] = Number(payload[k]);
            for (const k of STRUCTURED_BOOL)
              if (typeof payload?.[k] === "boolean") out[k] = payload[k];
            for (const k of STRUCTURED_ARR)
              if (Array.isArray(payload?.[k])) out[k] = payload[k];
            for (const k of STRUCTURED_DATE)
              if (payload?.[k]) out[k] = payload[k];
            return out;
          }

          // Collect any unknown keys to merge into dynamic_profile_fields
          function buildDynamic(): Record<string, any> {
            const out: Record<string, any> = {};
            if (payload && typeof payload === "object") {
              for (const k of Object.keys(payload)) {
                if (!KNOWN_KEYS.has(k)) out[k] = payload[k];
              }
            }
            if (payload?.dynamic_profile_fields && typeof payload.dynamic_profile_fields === "object") {
              Object.assign(out, payload.dynamic_profile_fields);
            }
            return out;
          }

          const enrichment = buildEnrichment();
          const dynamicExtras = buildDynamic();

          // === Campaign detection ===
          // Match by explicit id, name, or the WhatsApp number the message came in on.
          let campaign: any = null;
          const campaignIdHint = payload?.campaign_id || payload?.campaignId || null;
          const campaignNameHint = payload?.campaign_name || payload?.campaignName || null;
          const inboundWa = payload?.to || payload?.recipient || payload?.business_phone || null;

          if (campaignIdHint) {
            const { data } = await supabaseAdmin.from("campaigns").select("*").eq("id", campaignIdHint).maybeSingle();
            if (data) campaign = data;
          }
          if (!campaign && campaignNameHint) {
            const { data } = await supabaseAdmin.from("campaigns").select("*").ilike("name", `%${campaignNameHint}%`).limit(1);
            if (data && data[0]) campaign = data[0];
          }
          if (!campaign && inboundWa) {
            const { data } = await supabaseAdmin.from("campaigns").select("*").eq("whatsapp_number", String(inboundWa)).limit(1);
            if (data && data[0]) campaign = data[0];
          }

          // === Offer Intelligence load ===
          // If the matched campaign points at an offer, pull the Tamar-ready
          // intelligence layer so the bot can answer from grounded facts/FAQ
          // and know when to escalate. Also accept an explicit offer_id hint.
          let offer: any = null;
          const offerIdHint =
            payload?.offer_id || payload?.offerId || campaign?.offer_id || null;
          if (offerIdHint) {
            const { data } = await supabaseAdmin
              .from("offers")
              .select(
                "id,title,offer_url,ai_summary,sales_angle,grounded_facts,faq_bundle,objection_notes,matching_tags,escalation_boundary,ingestion_status,last_ingested_at,price,currency,pricing_status,base_price_per_person,single_supplement,couple_price,price_basis,rooming_policy,included,not_included,itinerary_summary,nights,flights_included",
              )
              .eq("id", offerIdHint)
              .maybeSingle();
            if (data) offer = data;
          }
          const offerIntelligenceText = offer ? buildOfferIntelligenceBlock(offer) : null;
          const offerIntelligenceLoaded = !!offer && !!offerIntelligenceText;
          const offerHasGrounding =
            !!offer &&
            ((offer.grounded_facts && Object.keys(offer.grounded_facts).length > 0) ||
              (Array.isArray(offer.faq_bundle) && offer.faq_bundle.length > 0));
          const offerFieldsInjected = offer
            ? Object.entries({
                ai_summary: !!offer.ai_summary,
                sales_angle: !!offer.sales_angle,
                grounded_facts:
                  !!offer.grounded_facts && Object.keys(offer.grounded_facts).length > 0,
                faq_bundle: Array.isArray(offer.faq_bundle) && offer.faq_bundle.length > 0,
                objection_notes:
                  Array.isArray(offer.objection_notes) && offer.objection_notes.length > 0,
                matching_tags:
                  Array.isArray(offer.matching_tags) && offer.matching_tags.length > 0,
                escalation_boundary:
                  !!offer.escalation_boundary &&
                  Object.keys(offer.escalation_boundary).length > 0,
              })
                .filter(([, v]) => v)
                .map(([k]) => k)
            : [];
          const escalationFallback = !!campaign && !!offerIdHint && !offerHasGrounding;

          // === Tamar runtime settings + prompt blocks (live control plane) ===
          const [behaviorRes2, blocksRes2] = await Promise.all([
            supabaseAdmin.from("tamar_behavior_settings" as any).select("*").eq("id", 1).maybeSingle(),
            supabaseAdmin
              .from("tamar_prompt_blocks" as any)
              .select("block_key,title,body,version,updated_at")
              .eq("is_active", true),
          ]);
          const tamarSettings = (behaviorRes2.data ?? null) as any;
          const promptBlocks = ((blocksRes2.data ?? []) as any[]).reduce(
            (acc: Record<string, any>, b: any) => {
              acc[b.block_key] = { title: b.title, body: b.body, version: b.version, updated_at: b.updated_at };
              return acc;
            },
            {},
          );
          const provisionalContact = name
            ? { first_name: String(name).trim().split(/\s+/)[0], full_name: String(name) }
            : null;
          const provisionalCampaignContext = campaign ? buildCampaignContext(campaign, provisionalContact) : null;
          const provisionalComposition = buildTamarRuntimeComposition({
            inboundMessage: message,
            source,
            contact: provisionalContact,
            campaign,
            campaignContextText: provisionalCampaignContext?.campaign_context ?? null,
            offer,
            offerIntelligenceText,
            tamarSettings,
            promptBlocks,
            escalationFallback,
            escalationReason: escalationFallback ? "offer_intelligence_missing_grounded_knowledge" : null,
            offerFieldsInjected,
          });

          // === Runtime observability trace (manager-visible only) ===
          // Captures exactly what context Tamar runtime received for this
          // inbound message, so we can verify control-plane → runtime wiring.
          const promptBlockKeysInjected = Object.entries(promptBlocks).map(
            ([k, v]: [string, any]) => ({ key: k, version: v?.version ?? null, updated_at: v?.updated_at ?? null }),
          );
          const runtimePackSections = [
            "tamar_settings",
            "prompt_blocks",
            campaign ? "campaign_context" : null,
            offerIntelligenceLoaded ? "offer_intelligence" : null,
            "consent_state",
          ].filter(Boolean) as string[];
          const observability = {
            inbound_at: new Date().toISOString(),
            phone_or_id: phone || facebook_id || email || null,
            campaign_injected: !!campaign,
            campaign_id: campaign?.id || null,
            campaign_name: campaign?.name || null,
            offer_intelligence_injected: offerIntelligenceLoaded,
            offer_id: offer?.id || null,
            offer_title: offer?.title || null,
            offer_fields_injected: offerFieldsInjected,
            offer_ingestion_status: offer?.ingestion_status || null,
            tamar_settings_version_at: tamarSettings?.updated_at || null,
            tamar_settings_id: tamarSettings ? 1 : null,
            prompt_blocks_injected: promptBlockKeysInjected,
            prompt_blocks_count: promptBlockKeysInjected.length,
            fallback_default_prompt_behavior: promptBlockKeysInjected.length === 0,
            runtime_pack_sections: runtimePackSections,
            escalation_due_to_grounding: escalationFallback,
            escalation_reason: escalationFallback
              ? "offer_intelligence_missing_grounded_knowledge"
              : null,
            prompt_composition: {
              composed_runtime_prompt_available: true,
              composed_runtime_prompt_returned_to_tamar: true,
              railway_prompt_consumption_confirmed_by_zooga: false,
              zooga_direct_model_call: false,
              model_call_owner: "railway_tamar_runtime",
              fallback_default_prompt_path: provisionalComposition.tracePromptContext.fallback_default_prompt_path,
              injected_sections: provisionalComposition.tracePromptContext.injected_sections,
            },
            composed_runtime_prompt_context: provisionalComposition.tracePromptContext,
          };

          // Phone is the master key. Try to match existing contact by phone first.
          let matched: any = null;
          if (phone) {
            const { data } = await supabaseAdmin
              .from("contacts")
              .select("*")
              .or(`phone.eq.${phone},whatsapp_number.eq.${phone}`)
              .maybeSingle();
            if (data) matched = data;
          }
          if (!matched && facebook_id) {
            const { data } = await supabaseAdmin
              .from("contacts")
              .select("*")
              .eq("facebook_id", facebook_id)
              .maybeSingle();
            if (data) matched = data;
          }
          if (!matched && email) {
            const { data } = await supabaseAdmin
              .from("contacts")
              .select("*")
              .eq("email", email)
              .maybeSingle();
            if (data) matched = data;
          }

          const nowIso = new Date().toISOString();

          if (matched) {
            // Fill missing fields only — don't overwrite existing data.
            const nameParts = name ? String(name).trim().split(/\s+/) : [];
            const patch: any = { last_interaction_at: nowIso };
            if (phone && !matched.phone) patch.phone = phone;
            if (whatsapp_number && !matched.whatsapp_number) patch.whatsapp_number = whatsapp_number;
            if (facebook_id && !matched.facebook_id) patch.facebook_id = facebook_id;
            if (email && !matched.email) patch.email = email;
            if (nameParts[0] && !matched.first_name) patch.first_name = nameParts[0];
            if (nameParts.length > 1 && !matched.last_name) patch.last_name = nameParts.slice(1).join(" ");
            if (intake_status && !matched.intake_status) patch.intake_status = intake_status;
            if (payload?.preferred_language_style && !matched.preferred_language_style)
              patch.preferred_language_style = payload.preferred_language_style;
            if (payload?.gender && !matched.gender) patch.gender = payload.gender;

            // Apply enrichment fields (overwrite when sent — Tamar AI is authoritative)
            for (const [k, v] of Object.entries(enrichment)) patch[k] = v;

            // Merge dynamic profile fields
            if (Object.keys(dynamicExtras).length > 0) {
              patch.dynamic_profile_fields = {
                ...(matched.dynamic_profile_fields || {}),
                ...dynamicExtras,
              };
            }

            // Append to raw_payloads (cap last 50)
            const prevRaw = Array.isArray(matched.raw_payloads) ? matched.raw_payloads : [];
            const nextRaw = [...prevRaw, { at: nowIso, payload }].slice(-50);
            patch.raw_payloads = nextRaw;

            // Campaign linkage on existing contact
            if (campaign) {
              if (!matched.first_touch_campaign_id) patch.first_touch_campaign_id = campaign.id;
              patch.last_touch_campaign_id = campaign.id;
              patch.campaign_source = campaign.name;
              if (!matched.acquisition_source) patch.acquisition_source = campaign.source_platform || campaign.name;
            }

            await supabaseAdmin.from("contacts").update(patch).eq("id", matched.id);

            if (message) {
              await supabaseAdmin.from("interactions").insert({
                contact_id: matched.id,
                type: isWhatsApp ? "whatsapp_message" : "facebook_message",
                source: String(source),
                content: message,
                campaign_id: campaign?.id || null,
              });
            }

            if (campaign) {
              await supabaseAdmin.from("campaign_contacts").upsert({
                campaign_id: campaign.id,
                contact_id: matched.id,
                first_touch: !matched.first_touch_campaign_id,
                last_touch: true,
                last_activity_at: nowIso,
              }, { onConflict: "campaign_id,contact_id" });
            }

            const ctx = campaign ? buildCampaignContext(campaign, matched) : null;
            if (ctx && offerIntelligenceText) {
              ctx.campaign_context = `${ctx.campaign_context}\n\n${offerIntelligenceText}`;
            }

            const finalComposition = buildTamarRuntimeComposition({
              inboundMessage: message,
              source,
              contact: { ...matched, ...patch },
              campaign,
              campaignContextText: ctx?.campaign_context ?? null,
              offer,
              offerIntelligenceText,
              tamarSettings,
              promptBlocks,
              escalationFallback,
              escalationReason: escalationFallback ? "offer_intelligence_missing_grounded_knowledge" : null,
              offerFieldsInjected,
            });
            const finalObservability = {
              ...observability,
              prompt_composition: {
                ...observability.prompt_composition,
                fallback_default_prompt_path: finalComposition.tracePromptContext.fallback_default_prompt_path,
                injected_sections: finalComposition.tracePromptContext.injected_sections,
              },
              composed_runtime_prompt_context: finalComposition.tracePromptContext,
            };
            await supabaseAdmin.from("webhook_logs").insert({
              source: "tamar_bot",
              status: "tamar_runtime_trace",
              payload: finalObservability,
            });

            if (message) triggerExtraction(request, matched.id);

            return Response.json({
              ok: true,
              matched: true,
              contact_id: matched.id,
              updated_fields: Object.keys(patch),
              campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
              ...(ctx || {}),
              offer: offer ? { id: offer.id, title: offer.title } : null,
              offer_intelligence: offer
                ? {
                    ai_summary: offer.ai_summary,
                    sales_angle: offer.sales_angle,
                    grounded_facts: offer.grounded_facts,
                    faq_bundle: offer.faq_bundle,
                    objection_notes: offer.objection_notes,
                    matching_tags: offer.matching_tags,
                    escalation_boundary: offer.escalation_boundary,
                  }
                : null,
              offer_intelligence_context: offerIntelligenceText,
              offer_intelligence_loaded: offerIntelligenceLoaded,
              offer_fields_injected: offerFieldsInjected,
              should_escalate: escalationFallback,
              escalation_reason: escalationFallback
                ? "offer_intelligence_missing_grounded_knowledge"
                : null,
              tamar_settings: tamarSettings,
              prompt_blocks: promptBlocks,
              runtime_prompt_context: finalComposition.runtimePromptContext,
              _observability: finalObservability,
            });
          }

          // No matching contact — create a new one keyed by phone.
          const fallbackName = name || "משתמש WhatsApp";
          const newNameParts = String(fallbackName).trim().split(/\s+/);
          const insertRow: any = {
            first_name: newNameParts[0] || fallbackName,
            last_name: newNameParts.length > 1 ? newNameParts.slice(1).join(" ") : null,
            phone: phone,
            whatsapp_number: whatsapp_number,
            facebook_id: facebook_id,
            email: email,
            source: source as any,
            intake_status: intake_status || "new",
            last_interaction_at: nowIso,
            consent_marketing: false,
            dynamic_profile_fields: dynamicExtras,
            raw_payloads: [{ at: nowIso, payload }],
            ...enrichment,
          };
          if (payload?.preferred_language_style)
            insertRow.preferred_language_style = payload.preferred_language_style;
          if (payload?.gender) insertRow.gender = payload.gender;
          if (campaign) {
            insertRow.first_touch_campaign_id = campaign.id;
            insertRow.last_touch_campaign_id = campaign.id;
            insertRow.campaign_source = campaign.name;
            insertRow.acquisition_source = campaign.source_platform || campaign.name;
          }

          const { data: created, error: createErr } = await supabaseAdmin
            .from("contacts")
            .insert(insertRow)
            .select("id")
            .single();

          if (createErr) throw createErr;

          if (message && created?.id) {
            await supabaseAdmin.from("interactions").insert({
              contact_id: created.id,
              type: isWhatsApp ? "whatsapp_message" : "facebook_message",
              source: String(source),
              content: message,
              campaign_id: campaign?.id || null,
            });
          }

          if (campaign && created?.id) {
            await supabaseAdmin.from("campaign_contacts").upsert({
              campaign_id: campaign.id,
              contact_id: created.id,
              first_touch: true,
              last_touch: true,
              last_activity_at: nowIso,
            }, { onConflict: "campaign_id,contact_id" });
          }

          // Also log to intake_inbox for visibility, marked as processed.
          await supabaseAdmin.from("intake_inbox").insert({
            raw_payload: payload ?? {},
            parsed_name: fallbackName,
            parsed_phone: phone,
            parsed_email: email,
            parsed_facebook_id: facebook_id,
            parsed_message: message,
            source: source as any,
            status: "processed" as any,
            matched_contact_id: created?.id ?? null,
            processed_at: nowIso,
          });

          const ctx = campaign ? buildCampaignContext(campaign, { first_name: insertRow.first_name }) : null;
          if (ctx && offerIntelligenceText) {
            ctx.campaign_context = `${ctx.campaign_context}\n\n${offerIntelligenceText}`;
          }

          const finalComposition = buildTamarRuntimeComposition({
            inboundMessage: message,
            source,
            contact: { ...insertRow, id: created?.id ?? null },
            campaign,
            campaignContextText: ctx?.campaign_context ?? null,
            offer,
            offerIntelligenceText,
            tamarSettings,
            promptBlocks,
            escalationFallback,
            escalationReason: escalationFallback ? "offer_intelligence_missing_grounded_knowledge" : null,
            offerFieldsInjected,
          });
          const finalObservability = {
            ...observability,
            prompt_composition: {
              ...observability.prompt_composition,
              fallback_default_prompt_path: finalComposition.tracePromptContext.fallback_default_prompt_path,
              injected_sections: finalComposition.tracePromptContext.injected_sections,
            },
            composed_runtime_prompt_context: finalComposition.tracePromptContext,
          };
          await supabaseAdmin.from("webhook_logs").insert({
            source: "tamar_bot",
            status: "tamar_runtime_trace",
            payload: finalObservability,
          });

          if (created?.id && message) triggerExtraction(request, created.id);

          return Response.json({
            ok: true, matched: false, created: true, contact_id: created?.id,
            campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
            ...(ctx || {}),
            offer: offer ? { id: offer.id, title: offer.title } : null,
            offer_intelligence: offer
              ? {
                  ai_summary: offer.ai_summary,
                  sales_angle: offer.sales_angle,
                  grounded_facts: offer.grounded_facts,
                  faq_bundle: offer.faq_bundle,
                  objection_notes: offer.objection_notes,
                  matching_tags: offer.matching_tags,
                  escalation_boundary: offer.escalation_boundary,
                }
              : null,
            offer_intelligence_context: offerIntelligenceText,
            offer_intelligence_loaded: offerIntelligenceLoaded,
            offer_fields_injected: offerFieldsInjected,
            should_escalate: escalationFallback,
            escalation_reason: escalationFallback
              ? "offer_intelligence_missing_grounded_knowledge"
              : null,
            tamar_settings: tamarSettings,
            prompt_blocks: promptBlocks,
            runtime_prompt_context: finalComposition.runtimePromptContext,
            _observability: finalObservability,
          });
        } catch (e: any) {
          await supabaseAdmin.from("webhook_logs").insert({
            source: "tamar_bot",
            payload,
            status: "error",
            error: String(e?.message || e),
          });
          return new Response(JSON.stringify({ error: "internal" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});