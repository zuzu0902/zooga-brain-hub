import "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { consumeLastCapturedError } from "./lib/error-capture";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as any).default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;
  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }
  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

type _Unused = {
  title?: string | null;
  body?: string | null;
  version?: number | null;
  updated_at?: string | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function getSettingsAndBlocks() {
  const [settingsRes, blocksRes] = await Promise.all([
    supabaseAdmin.from("api_settings").select("webhook_token, default_source").eq("id", 1).maybeSingle(),
    supabaseAdmin.from("tamar_behavior_settings" as any).select("*").eq("id", 1).maybeSingle(),
    supabaseAdmin
      .from("tamar_prompt_blocks" as any)
      .select("block_key,title,body,version,updated_at,is_active")
      .eq("is_active", true)
      .order("block_key", { ascending: true }),
  ]);

  const promptBlocks = ((blocksRes.data ?? []) as any[]).reduce(
    (acc: Record<string, PromptBlock>, row: any) => {
      acc[row.block_key] = {
        title: row.title ?? null,
        body: row.body ?? "",
        version: row.version ?? null,
        updated_at: row.updated_at ?? null,
      };
      return acc;
    },
    {},
  );

  return {
    apiSettings: settingsRes.data ?? null,
    tamarSettings: settingsRes.error ? null : (settingsRes.data, (await supabaseAdmin.from("tamar_behavior_settings" as any).select("*").eq("id", 1).maybeSingle()).data ?? null),
    // overwritten below for clarity
    promptBlocks,
    behaviorRow: blocksRes.error ? null : null,
  };
}

async function resolveBehaviorAndBlocks() {
  const [behaviorRes, blocksRes] = await Promise.all([
    supabaseAdmin.from("tamar_behavior_settings" as any).select("*").eq("id", 1).maybeSingle(),
    supabaseAdmin
      .from("tamar_prompt_blocks" as any)
      .select("block_key,title,body,version,updated_at,is_active")
      .eq("is_active", true)
      .order("block_key", { ascending: true }),
  ]);

  const promptBlocks = ((blocksRes.data ?? []) as any[]).reduce(
    (acc: Record<string, PromptBlock>, row: any) => {
      acc[row.block_key] = {
        title: row.title ?? null,
        body: row.body ?? "",
        version: row.version ?? null,
        updated_at: row.updated_at ?? null,
      };
      return acc;
    },
    {},
  );

  return {
    tamarSettings: behaviorRes.data ?? null,
    promptBlocks,
  };
}

async function resolveOrCreateContact(params: {
  phone: string;
  whatsapp_number: string;
  source: string;
}) {
  const phone = String(params.phone || "").trim();
  const whatsapp_number = String(params.whatsapp_number || phone).trim();

  let contact: any = null;

  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .or(`phone.eq.${phone},whatsapp_number.eq.${whatsapp_number}`)
    .maybeSingle();

  contact = existing;

  if (!contact) {
    const { data: created, error } = await supabaseAdmin
      .from("contacts")
      .insert({
        phone,
        whatsapp_number,
        source: params.source,
        status: "new",
      })
      .select("*")
      .single();

    if (error) throw error;
    contact = created;
  }

  return contact;
}

async function loadContactContext(contactId: string) {
  const [interactionsRes, memoriesRes] = await Promise.all([
    supabaseAdmin
      .from("interactions")
      .select("id,type,source,content,timestamp,campaign_id,related_offer_id")
      .eq("contact_id", contactId)
      .order("timestamp", { ascending: false })
      .limit(12),
    supabaseAdmin
      .from("contact_memories")
      .select("memory_type,memory_key,memory_value,confidence_score,source_message,created_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return {
    recentInteractions: interactionsRes.data ?? [],
    relevantMemories: memoriesRes.data ?? [],
  };
}

async function resolveCampaignAndOffer(campaignId?: string | null, offerId?: string | null) {
  let campaign: any = null;
  let offer: any = null;

  if (campaignId) {
    const { data } = await supabaseAdmin.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
    campaign = data;
  }

  const resolvedOfferId = offerId || campaign?.offer_id || null;
  if (resolvedOfferId) {
    const { data } = await supabaseAdmin
      .from("offers")
      .select("id,title,offer_url,ai_summary,sales_angle,grounded_facts,faq_bundle,objection_notes,matching_tags,escalation_boundary,ingestion_status,last_ingested_at,price,category,description")
      .eq("id", resolvedOfferId)
      .maybeSingle();
    offer = data;
  }

  return { campaign, offer };
}

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
  if (faq.length) {
    lines.push(`שאלות נפוצות:\n${faq.map((f: any, i: number) => `${i + 1}. ש: ${f.q || f.question}\n   ת: ${f.a || f.answer}`).join("\n")}`);
  }
  const objections = Array.isArray(offer.objection_notes) ? offer.objection_notes : [];
  if (objections.length) {
    lines.push(`התנגדויות ומענה:\n${objections.map((o: any, i: number) => `${i + 1}. ${o.objection || o.q}: ${o.response || o.a}`).join("\n")}`);
  }
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

async function callModel(messages: Array<{ role: string; content: string; name?: string }>) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is missing");

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0.4,
      messages,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Lovable AI Gateway error: ${response.status} ${JSON.stringify(data)}`);
  }

  const reply = data?.choices?.[0]?.message?.content;
  if (!reply || typeof reply !== "string") {
    throw new Error("Model reply_text missing");
  }

  return reply.trim();
}

async function writeTrace(input: {
  contactId: string | null;
  phone: string;
  inboundMessage: string;
  outboundReply: string | null;
  runtimeMode: string;
  latencyMs: number;
  campaignId?: string | null;
  offerId?: string | null;
  promptBlocks: Record<string, PromptBlock>;
  rawPayload: any;
}) {
  const promptBlockVersions = Object.entries(input.promptBlocks).map(([key, value]) => ({
    key,
    version: value?.version ?? null,
    updated_at: value?.updated_at ?? null,
  }));

  const { data } = await supabaseAdmin
    .from("tamar_runtime_executions")
    .insert({
      contact_id: input.contactId,
      phone: input.phone,
      inbound_message: input.inboundMessage,
      outbound_reply: input.outboundReply,
      runtime_mode: input.runtimeMode,
      runtime_pack_fetch_ok: true,
      latency_ms: input.latencyMs,
      campaign_id: input.campaignId ?? null,
      offer_id: input.offerId ?? null,
      prompt_block_versions: promptBlockVersions,
      raw_payload: input.rawPayload,
    } as any)
    .select("id")
    .maybeSingle();

  return data?.id ?? null;
}

export const Route = createFileRoute("/api/public/runtime/tamar-turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const url = new URL(request.url);
        const providedToken = request.headers.get("x-api-token") || url.searchParams.get("token") || null;
        const payload = await request.json().catch(() => null);

        const { data: apiSettings } = await supabaseAdmin
          .from("api_settings")
          .select("webhook_token, default_source")
          .eq("id", 1)
          .maybeSingle();

        if (!apiSettings?.webhook_token || providedToken !== apiSettings.webhook_token) {
          return json({ ok: false, error: "unauthorized" }, 401);
        }

        const phone = String(payload?.phone || payload?.whatsapp_number || "").trim();
        const whatsapp_number = String(payload?.whatsapp_number || phone || "").trim();
        const message = String(payload?.message || "").trim();
        const source = String(payload?.source || apiSettings?.default_source || "Tamar WhatsApp").trim();
        const campaign_id = payload?.campaign_id || null;
        const offer_id = payload?.offer_id || null;

        if (!phone || !whatsapp_number || !message || !source) {
          return json({ ok: false, error: "missing_required_fields" }, 400);
        }

        const { tamarSettings, promptBlocks } = await resolveBehaviorAndBlocks();
        const contact = await resolveOrCreateContact({ phone, whatsapp_number, source });
        const { recentInteractions, relevantMemories } = await loadContactContext(contact.id);
        const { campaign, offer } = await resolveCampaignAndOffer(campaign_id, offer_id);

        const campaignContextText = campaign
          ? [
              `# הקשר קמפיין: ${campaign.name}`,
              campaign.objective ? `מטרה: ${campaign.objective}` : "",
              campaign.ai_goal ? `יעד AI: ${campaign.ai_goal}` : "",
              campaign.tone_style ? `טון: ${campaign.tone_style}` : "",
              campaign.emotional_angle ? `זווית רגשית: ${campaign.emotional_angle}` : "",
              campaign.target_audience ? `קהל יעד: ${campaign.target_audience}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          : null;

        const offerIntelligenceText = buildOfferIntelligenceBlock(offer);
        const offerFieldsInjected = offer
          ? Object.entries({
              ai_summary: !!offer.ai_summary,
              sales_angle: !!offer.sales_angle,
              grounded_facts: !!offer.grounded_facts && Object.keys(offer.grounded_facts).length > 0,
              faq_bundle: Array.isArray(offer.faq_bundle) && offer.faq_bundle.length > 0,
              objection_notes: Array.isArray(offer.objection_notes) && offer.objection_notes.length > 0,
              matching_tags: Array.isArray(offer.matching_tags) && offer.matching_tags.length > 0,
              escalation_boundary: !!offer.escalation_boundary && Object.keys(offer.escalation_boundary).length > 0,
            })
              .filter(([, v]) => v)
              .map(([k]) => k)
          : [];

        const composition = buildTamarRuntimeComposition({
          inboundMessage: message,
          source: "zooga_direct_turn",
          contact,
          campaign,
          campaignContextText,
          offer,
          offerIntelligenceText,
          tamarSettings,
          promptBlocks,
          escalationFallback: false,
          escalationReason: null,
          offerFieldsInjected,
        });

        const memoryMessages = relevantMemories.slice(0, 8).map((m: any) => ({
          role: "system",
          name: "relevant_memory",
          content: `Memory: ${m.memory_key || m.memory_type || "memory"} = ${typeof m.memory_value === "string" ? m.memory_value : JSON.stringify(m.memory_value)}`,
        }));

        const historyMessages = [...recentInteractions]
          .reverse()
          .flatMap((row: any) => {
            const role = row.type === "inbound" ? "user" : "assistant";
            if (!row.content) return [];
            return [{ role, content: String(row.content) }];
          });

        const finalMessages = [
          ...(composition.runtimePromptContext.messages || []),
          ...memoryMessages,
          ...historyMessages,
          { role: "user", content: message },
        ];

        try {
          const reply_text = await callModel(finalMessages as any);
          const latencyMs = Date.now() - startedAt;

          await supabaseAdmin.from("interactions").insert([
            {
              contact_id: contact.id,
              type: "inbound",
              source,
              content: message,
              campaign_id: campaign?.id ?? null,
              related_offer_id: offer?.id ?? null,
            },
            {
              contact_id: contact.id,
              type: "outbound",
              source: "Tamar AI",
              content: reply_text,
              campaign_id: campaign?.id ?? null,
              related_offer_id: offer?.id ?? null,
            },
          ]);

          const trace_id = await writeTrace({
            contactId: contact.id,
            phone,
            inboundMessage: message,
            outboundReply: reply_text,
            runtimeMode: "zooga_direct",
            latencyMs,
            campaignId: campaign?.id ?? null,
            offerId: offer?.id ?? null,
            promptBlocks,
            rawPayload: {
              request: payload,
              prompt_preview: composition.tracePromptContext,
            },
          });

          return json({
            ok: true,
            reply_text,
            contact_id: contact.id,
            runtime_mode: "zooga_direct",
            trace_id,
            handoff_requested: false,
            meta: {
              offer_id: offer?.id ?? null,
              campaign_id: campaign?.id ?? null,
            },
          });
        } catch (error: any) {
          const latencyMs = Date.now() - startedAt;

          await writeTrace({
            contactId: contact.id,
            phone,
            inboundMessage: message,
            outboundReply: null,
            runtimeMode: "failed_before_reply",
            latencyMs,
            campaignId: campaign?.id ?? null,
            offerId: offer?.id ?? null,
            promptBlocks,
            rawPayload: {
              request: payload,
              prompt_preview: composition.tracePromptContext,
              error: error?.message || String(error),
            },
          });

          return json({
            ok: false,
            error: "model_call_failed",
            details: error?.message || String(error),
          }, 500);
        }
      },
    },
  },
});
