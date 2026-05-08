import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { INTAKE_FLOWS, buildSuggestedOpening, type IntakeFlowType } from "@/lib/intake-flows";

const ContextInput = z.object({ campaign_id: z.string().uuid(), contact_id: z.string().uuid().optional() });

export const getCampaignContext = createServerFn({ method: "POST" })
  .inputValidator((input) => ContextInput.parse(input))
  .handler(async ({ data }) => {
    const { data: campaign } = await supabaseAdmin
      .from("campaigns").select("*").eq("id", data.campaign_id).maybeSingle();
    if (!campaign) return { ok: false, error: "campaign not found" };

    let contact: any = null;
    if (data.contact_id) {
      const { data: c } = await supabaseAdmin
        .from("contacts").select("first_name, full_name").eq("id", data.contact_id).maybeSingle();
      contact = c;
    }

    const flow = (campaign.intake_flow_type || "generic") as IntakeFlowType;
    const flowDef = INTAKE_FLOWS[flow];

    const suggested_opening = buildSuggestedOpening({
      contactName: contact?.first_name || (contact?.full_name ?? "").split(" ")[0] || null,
      campaignName: campaign.name,
      flow,
      emotionalAngle: campaign.emotional_angle,
    });

    const promptBlock = [
      `# הקשר קמפיין: ${campaign.name}`,
      campaign.objective ? `מטרה: ${campaign.objective}` : "",
      campaign.ai_goal ? `יעד AI: ${campaign.ai_goal}` : "",
      campaign.tone_style ? `סגנון טון: ${campaign.tone_style}` : "",
      campaign.emotional_angle ? `זווית רגשית: ${campaign.emotional_angle}` : "",
      campaign.target_audience ? `קהל יעד: ${campaign.target_audience}` : "",
      campaign.objections?.length ? `התנגדויות נפוצות: ${campaign.objections.join(", ")}` : "",
      campaign.prohibited_promises?.length ? `אסור להבטיח: ${campaign.prohibited_promises.join(", ")}` : "",
      campaign.desired_conversion_action ? `פעולת המרה רצויה: ${campaign.desired_conversion_action}` : "",
      `\nשאלות אינטייק לזרימה (${flow}):\n- ${flowDef.questions.join("\n- ")}`,
      `\nהוראת התנהגות: ${flowDef.system_addendum}`,
      `\nכלל בטיחות: אם את לא בטוחה בפרט עובדתי — אל תמציאי, העבירי למנהל אנושי.`,
    ].filter(Boolean).join("\n");

    return {
      ok: true,
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      intake_flow_type: flow,
      suggested_opening,
      campaign_context: promptBlock,
      questions: flowDef.questions,
      should_escalate: false,
      faq: campaign.faq ?? [],
      ai_behavior_rules: campaign.ai_behavior_rules ?? [],
    };
  });

const ScoreInput = z.object({ campaign_id: z.string().uuid(), contact_id: z.string().uuid() });

export const scoreCampaignFit = createServerFn({ method: "POST" })
  .inputValidator((input) => ScoreInput.parse(input))
  .handler(async ({ data }) => {
    const [{ data: campaign }, { data: contact }] = await Promise.all([
      supabaseAdmin.from("campaigns").select("*").eq("id", data.campaign_id).maybeSingle(),
      supabaseAdmin.from("contacts").select("*").eq("id", data.contact_id).maybeSingle(),
    ]);
    if (!campaign || !contact) return { ok: false, error: "missing entity" };

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { ok: false, error: "LOVABLE_API_KEY not set" };

    const sys = "אתה אנליסט CRM. החזר JSON בלבד עם השדות: fit_score (0-100), intent_level (low|medium|high), emotional_engagement (0-100), conversion_probability (0-100), reasoning (משפט קצר בעברית).";
    const userMsg = JSON.stringify({
      campaign: {
        name: campaign.name, category: campaign.category, target_audience: campaign.target_audience,
        target_age_ranges: campaign.target_age_ranges, target_regions: campaign.target_regions,
        emotional_angle: campaign.emotional_angle, objective: campaign.objective,
      },
      contact: {
        age: contact.age, region: contact.region, interests: contact.interests,
        personality_tags: contact.personality_tags, emotional_profile: contact.emotional_profile,
        sales_temperature: contact.sales_temperature, purchase_intent: contact.purchase_intent,
        engagement_score: contact.engagement_score,
      },
    });

    let result: any = null;
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userMsg },
          ],
          tools: [{
            type: "function",
            function: {
              name: "score_fit",
              description: "Return campaign-contact fit scoring",
              parameters: {
                type: "object",
                properties: {
                  fit_score: { type: "number" },
                  intent_level: { type: "string", enum: ["low", "medium", "high"] },
                  emotional_engagement: { type: "number" },
                  conversion_probability: { type: "number" },
                  reasoning: { type: "string" },
                },
                required: ["fit_score", "intent_level", "emotional_engagement", "conversion_probability", "reasoning"],
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "score_fit" } },
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        return { ok: false, error: `AI error ${res.status}: ${txt.slice(0, 200)}` };
      }
      const json = await res.json();
      const args = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      result = typeof args === "string" ? JSON.parse(args) : args;
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
    if (!result) return { ok: false, error: "no result" };

    await supabaseAdmin.from("campaign_contacts").upsert({
      campaign_id: data.campaign_id,
      contact_id: data.contact_id,
      fit_score: Math.round(result.fit_score),
      intent_level: result.intent_level,
      emotional_engagement: Math.round(result.emotional_engagement),
      conversion_probability: Math.round(result.conversion_probability),
      ai_reasoning: result.reasoning,
      last_activity_at: new Date().toISOString(),
    }, { onConflict: "campaign_id,contact_id" });

    return { ok: true, ...result };
  });

const StatsInput = z.object({ campaign_id: z.string().uuid() });
export const getCampaignStats = createServerFn({ method: "POST" })
  .inputValidator((input) => StatsInput.parse(input))
  .handler(async ({ data }) => {
    const { data: rows } = await supabaseAdmin
      .from("campaign_contacts").select("*").eq("campaign_id", data.campaign_id);
    const list = rows ?? [];
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const active = list.filter((r) => r.last_activity_at && new Date(r.last_activity_at) > sevenDaysAgo).length;
    const hot = list.filter((r) => r.intent_level === "high").length;
    const conversions = list.filter((r) => r.conversion_stage === "converted").length;
    const fitAvg = list.length ? Math.round(list.reduce((s, r) => s + (r.fit_score || 0), 0) / list.length) : 0;
    const engAvg = list.length ? Math.round(list.reduce((s, r) => s + (r.emotional_engagement || 0), 0) / list.length) : 0;

    const contactIds = list.map((r) => r.contact_id);
    let escalations = 0;
    if (contactIds.length) {
      const { count } = await supabaseAdmin.from("contacts")
        .select("id", { count: "exact", head: true })
        .in("id", contactIds).eq("manager_attention_required", true);
      escalations = count || 0;
    }

    return {
      contacts_acquired: list.length,
      active_conversations: active,
      hot_leads: hot,
      conversions,
      escalations,
      fit_avg: fitAvg,
      engagement_avg: engAvg,
    };
  });