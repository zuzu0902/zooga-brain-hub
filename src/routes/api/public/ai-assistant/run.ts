import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const SYSTEM = `You are Zooga's internal AI assistant for the manager of a Hebrew-speaking CRM (community-building / events / travel for adults).

You operate strictly as a PROPOSAL ENGINE. You never perform writes, sends, or campaign launches. You never claim that any action was executed. You only suggest.

You are grounded in Zooga as the SOURCE OF TRUTH. The SYSTEM_CONTEXT block below is the only authoritative data you have. Do not invent facts beyond it. If the context is empty or insufficient, say so explicitly in the RATIONALE and propose what to gather.

Output language: Hebrew by default (the manager speaks Hebrew). Mirror English if the user writes in English.

Output format — always use these three Markdown sections, in this order:

## הצעה (PROPOSAL)
The concrete suggestion. Be specific and actionable.

## נימוק (RATIONALE)
Short reasoning, including any signals from data you were given.

## הצעדים הבאים (SUGGESTED_NEXT_STEPS)
1-5 numbered steps that the manager can take. Each step must be an action the manager can perform manually in Zooga (create task, send offer, review handoff, etc.).

Hard rules:
- Never invent contacts, phone numbers, or fabricated stats. If you don't have data, say so and propose how to gather it.
- Never claim to have written to the database.
- Keep responses under ~400 words unless the user explicitly asked for a draft.
- For "draft_campaign" / "campaign_draft", produce a draft message + targeting criteria + objections handling — but it is still a proposal, not a launch.
- For "suggest_segment" / "segmentation", propose filter criteria the manager can apply in the contacts screen.
- For "suggest_triage" / "triage", recommend which contacts/insights to review first and why, referencing the pending_insights and flagged_contacts in SYSTEM_CONTEXT.
- For "summarize_contact", produce a short executive summary of the contact in SYSTEM_CONTEXT (profile, memories, recent interactions) — never invent details.
- For "summarize_hot_leads_week", summarize the leads list in SYSTEM_CONTEXT only.
- For "summary" / generic, give an executive summary in bullets.`;

const KIND_HINTS: Record<string, string> = {
  summary: "Kind: SUMMARY. Produce a concise executive summary.",
  segmentation: "Kind: SEGMENTATION. Propose audience segments with filter criteria.",
  suggest_segment: "Kind: SUGGEST_SEGMENT. Propose audience segments with filter criteria.",
  campaign_draft: "Kind: CAMPAIGN_DRAFT. Produce a draft message + target audience + tone.",
  draft_campaign: "Kind: DRAFT_CAMPAIGN. Produce a draft message + target audience + tone.",
  triage: "Kind: TRIAGE. Recommend which contacts/insights to review first.",
  suggest_triage: "Kind: SUGGEST_TRIAGE. Recommend which contacts/insights to review first.",
  summarize_contact: "Kind: SUMMARIZE_CONTACT. Summarize the single contact in SYSTEM_CONTEXT.",
  summarize_hot_leads_week: "Kind: SUMMARIZE_HOT_LEADS_WEEK. Summarize the hot leads slice in SYSTEM_CONTEXT.",
  free_form: "Kind: FREE_FORM.",
};

export const Route = createFileRoute("/api/public/ai-assistant/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const kind = String(body?.kind || "free_form");
          const prompt = String(body?.prompt || "").trim();
          const contactId = body?.contact_id ? String(body.contact_id) : null;
          if (!prompt) {
            return new Response(JSON.stringify({ error: "prompt required" }), {
              status: 400, headers: { "Content-Type": "application/json" },
            });
          }
          if (prompt.length > 4000) {
            return new Response(JSON.stringify({ error: "prompt too long (max 4000 chars)" }), {
              status: 400, headers: { "Content-Type": "application/json" },
            });
          }

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
              status: 500, headers: { "Content-Type": "application/json" },
            });
          }

          // Persist run as pending immediately (server-side history of internal proposals).
          const { data: runRow } = await supabaseAdmin
            .from("ai_assistant_runs" as any)
            .insert({ request_type: kind, prompt, status: "pending", model: MODEL })
            .select("id")
            .maybeSingle();
          const runId = (runRow as any)?.id ?? null;

          // Build grounded SYSTEM_CONTEXT bundle from Zooga (source of truth).
          const [contacts, pending, flagged, openTasks] = await Promise.all([
            supabaseAdmin.from("contacts").select("*", { count: "exact", head: true }),
            supabaseAdmin.from("pending_ai_insights").select("*", { count: "exact", head: true }).eq("status","pending"),
            supabaseAdmin.from("contacts").select("*", { count: "exact", head: true }).eq("manager_attention_required", true),
            supabaseAdmin.from("tasks").select("*", { count: "exact", head: true }).eq("status", "open"),
          ]);
          const stats = {
            total_contacts: contacts.count ?? null,
            pending_insights: pending.count ?? null,
            flagged_for_manager: flagged.count ?? null,
            open_tasks: openTasks.count ?? null,
          };

          const sources: string[] = ["contacts.count", "pending_ai_insights.count", "tasks.count"];
          const contextBlocks: Record<string, unknown> = { stats };

          if ((kind === "summarize_contact" || contactId) && contactId) {
            const [{ data: c }, { data: mems }, { data: ints }] = await Promise.all([
              supabaseAdmin.from("contacts").select("id, full_name, status, sales_temperature, ai_summary, ai_recommended_next_action, ai_confidence_score, manager_attention_required, last_interaction_at, interests, tags, region, age_range").eq("id", contactId).maybeSingle(),
              supabaseAdmin.from("contact_memories").select("memory_type, memory_key, memory_value, confidence_score").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(40),
              supabaseAdmin.from("interactions").select("type, source, content, timestamp").eq("contact_id", contactId).order("timestamp", { ascending: false }).limit(20),
            ]);
            contextBlocks.contact = c ?? null;
            contextBlocks.memories = mems ?? [];
            contextBlocks.recent_interactions = (ints ?? []).map((i: any) => ({
              ...i,
              content: typeof i.content === "string" ? i.content.slice(0, 400) : i.content,
            }));
            sources.push("contacts", "contact_memories", "interactions");
          }

          if (kind === "summarize_hot_leads_week") {
            const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const { data: leads } = await supabaseAdmin
              .from("contacts")
              .select("id, full_name, sales_temperature, status, ai_recommended_next_action, last_interaction_at, ai_confidence_score, manager_attention_required")
              .gte("last_interaction_at", sinceIso)
              .in("sales_temperature", ["hot", "warm"])
              .order("last_interaction_at", { ascending: false })
              .limit(50);
            contextBlocks.hot_leads_week = leads ?? [];
            sources.push("contacts(hot,warm,last_7d)");
          }

          if (kind === "suggest_triage") {
            const [{ data: pendingRows }, { data: flaggedRows }] = await Promise.all([
              supabaseAdmin.from("pending_ai_insights").select("id, contact_id, field_name, category, confidence_score, reasoning, resolution_state").eq("status", "pending").order("confidence_score", { ascending: false }).limit(30),
              supabaseAdmin.from("contacts").select("id, full_name, sales_temperature, ai_recommended_next_action, ai_risk_flags").eq("manager_attention_required", true).limit(30),
            ]);
            contextBlocks.pending_insights_sample = pendingRows ?? [];
            contextBlocks.flagged_contacts_sample = flaggedRows ?? [];
            sources.push("pending_ai_insights", "contacts(flagged)");
          }

          if (kind === "suggest_segment" || kind === "segmentation" || kind === "draft_campaign" || kind === "campaign_draft") {
            const { data: tagSample } = await supabaseAdmin
              .from("contacts")
              .select("interests, lifestyle_tags, region, age_range, sales_temperature")
              .limit(200);
            contextBlocks.contacts_sample = tagSample ?? [];
            sources.push("contacts(tags_sample)");
          }

          const userMessage = [
            KIND_HINTS[kind] ?? KIND_HINTS.free_form,
            "",
            "SYSTEM_CONTEXT (Zooga source-of-truth, no raw PII identifiers):",
            JSON.stringify(contextBlocks, null, 2),
            "",
            "Manager request:",
            prompt,
          ].join("\n");

          const aiResp = await fetch(AI_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: MODEL,
              messages: [
                { role: "system", content: SYSTEM },
                { role: "user", content: userMessage },
              ],
            }),
          });

          if (!aiResp.ok) {
            const t = await aiResp.text();
            await supabaseAdmin
              .from("ai_assistant_runs" as any)
              .update({ status: "error", error: `gateway_${aiResp.status}: ${t.slice(0,200)}`, completed_at: new Date().toISOString() })
              .eq("id", runId);
            if (aiResp.status === 429) {
              return new Response(JSON.stringify({ error: "AI rate limit — try again shortly" }), { status: 429, headers: { "Content-Type": "application/json" } });
            }
            if (aiResp.status === 402) {
              return new Response(JSON.stringify({ error: "AI credits exhausted — add credits in workspace settings" }), { status: 402, headers: { "Content-Type": "application/json" } });
            }
            return new Response(JSON.stringify({ error: `AI gateway ${aiResp.status}: ${t.slice(0,200)}` }), { status: 500, headers: { "Content-Type": "application/json" } });
          }

          const aiJson = await aiResp.json();
          const text = aiJson?.choices?.[0]?.message?.content ?? "";
          const counts: Record<string, number> = {};
          if (Array.isArray((contextBlocks as any).memories)) counts.memories = (contextBlocks as any).memories.length;
          if (Array.isArray((contextBlocks as any).recent_interactions)) counts.recent_interactions = (contextBlocks as any).recent_interactions.length;
          if (Array.isArray((contextBlocks as any).hot_leads_week)) counts.hot_leads_week = (contextBlocks as any).hot_leads_week.length;
          if (Array.isArray((contextBlocks as any).pending_insights_sample)) counts.pending_insights = (contextBlocks as any).pending_insights_sample.length;
          if (Array.isArray((contextBlocks as any).flagged_contacts_sample)) counts.flagged_contacts = (contextBlocks as any).flagged_contacts_sample.length;
          if (Array.isArray((contextBlocks as any).contacts_sample)) counts.contacts_sample = (contextBlocks as any).contacts_sample.length;
          const contextUsed = { sources, counts, contact_id: contactId, kind };

          await supabaseAdmin
            .from("ai_assistant_runs" as any)
            .update({
              status: "completed",
              response: text,
              context_used: contextUsed,
              completed_at: new Date().toISOString(),
            })
            .eq("id", runId);

          return Response.json({
            run_id: runId,
            response: text,
            stats,
            model: MODEL,
            context_used: contextUsed,
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: String(e?.message || e) }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});