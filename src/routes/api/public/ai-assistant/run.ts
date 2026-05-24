import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const SYSTEM = `You are Zooga's internal AI assistant for the manager of a Hebrew-speaking CRM (community-building / events / travel for adults).

You operate strictly as a PROPOSAL ENGINE. You never perform writes, sends, or campaign launches. You never claim that any action was executed. You only suggest.

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
- For "campaign_draft", produce a draft message + targeting criteria + objections handling — but it is still a proposal, not a launch.
- For "segmentation", propose filter criteria the manager can apply in the contacts screen.
- For "triage", recommend which contacts/insights to review first and why.
- For "summary", give an executive summary in bullets.`;

const KIND_HINTS: Record<string, string> = {
  summary: "Kind: SUMMARY. Produce a concise executive summary.",
  segmentation: "Kind: SEGMENTATION. Propose audience segments with filter criteria.",
  campaign_draft: "Kind: CAMPAIGN_DRAFT. Produce a draft message + target audience + tone.",
  triage: "Kind: TRIAGE. Recommend which contacts/insights to review first.",
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

          // Lightweight system stats so summary/triage/segmentation aren't blind.
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

          const userMessage = [
            KIND_HINTS[kind] ?? KIND_HINTS.free_form,
            "",
            "Current system stats (no PII):",
            JSON.stringify(stats, null, 2),
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
          return Response.json({ response: text, stats, model: MODEL });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: String(e?.message || e) }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});