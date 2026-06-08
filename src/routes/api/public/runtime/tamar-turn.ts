/**
 * RUNTIME TURN — single Zooga entrypoint for live Tamar inbound turns.
 *
 * V0 "rescue mode": Zooga owns the full turn — resolve/create contact,
 * load context (interactions, memories, settings, prompt blocks, offer),
 * compose the prompt, call the model directly via Lovable AI Gateway,
 * persist interaction + runtime trace, return the customer-facing reply.
 *
 * Auth: x-api-token must match api_settings.webhook_token.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildTamarRuntimeComposition } from "@/lib/tamar-runtime-composition";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const HANDOFF_PATTERNS = [
  /מעביר(ה)?\s+(אותך\s+)?ל(נציג|אדם|מנהל|צוות)/i,
  /אבדוק\s+(מול|עם)\s+(הצוות|מנהל|נציג|אדם)/i,
  /אחזור\s+אלי(י)?ך\s+(עם\s+תשובה|בהקדם)/i,
  /מעבירה?\s+לטיפול\s+אנושי/i,
  /transferring you to (a|our) (human|agent|representative|manager)/i,
  /escalat(e|ing) to (a|our) (human|agent|team|manager)/i,
  /let me check with (the|our) (team|manager|human)/i,
];

function detectHandoff(reply: string): boolean {
  if (!reply) return false;
  return HANDOFF_PATTERNS.some((re) => re.test(reply));
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const text = value == null ? "" : String(value).trim();
    if (text) return text;
  }
  return null;
}

function inboundName(body: any): string | null {
  return firstNonEmpty(
    body?.name,
    body?.customer_name,
    body?.contact_name,
    body?.profile_name,
    body?.push_name,
    body?.whatsapp_name,
    body?.sender_name,
    body?.from_name,
  );
}

function phoneLookupCandidates(...values: unknown[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const raw = value == null ? "" : String(value).trim();
    if (!raw) continue;
    out.add(raw);
    const compact = raw.replace(/[\s().-]/g, "");
    if (compact) out.add(compact);
    const digits = compact.replace(/^\+/, "");
    if (digits) {
      out.add(digits);
      out.add(`+${digits}`);
    }
  }
  return [...out];
}

function coerceContactSource(source: unknown): string {
  const value = source == null ? "" : String(source).trim();
  const allowed = new Set(["Facebook", "WhatsApp", "Zooga Website", "Event", "Tamar Bot", "Manual", "Tamar WhatsApp"]);
  return allowed.has(value) ? value : "Tamar WhatsApp";
}

function conversationExcerptText(excerpt: Array<{ ts: string; source: string; content: string }>): string {
  return excerpt
    .filter((item) => item.content)
    .map((item) => `[${item.ts}] ${item.source}: ${item.content}`)
    .join("\n");
}

// --- Conversation intent mode ---

type ConversationMode = "generic_intake" | "offer_specific" | "support" | "handoff";

const HUMAN_REQUEST_RE =
  /(נציג|לדבר עם אדם|אדם אמיתי|בן ?אדם|מנהל(ת)?|human|real person|speak to (a |an )?(agent|representative|manager|human))/i;
const SUPPORT_RE =
  /(בעיה|תקלה|לא קיבלתי|החזר|לבטל|ביטול|תשלום נכשל|חיוב כפול|לא עובד|refund|cancel(l(ed|ation))?|problem|issue|not working|broken|charged twice)/i;

function explicitOfferMention(message: string, offer: any): boolean {
  if (!message || !offer) return false;
  return !!keywordMatchOffer(message, [offer]);
}

function decideConversationMode(args: {
  message: string;
  body: any;
  offer: any;
  resolutionTrail: string[];
  interactions: any[];
}): { mode: ConversationMode; reasons: string[] } {
  const reasons: string[] = [];
  const { message, body, offer, resolutionTrail, interactions } = args;

  if (HUMAN_REQUEST_RE.test(message)) {
    reasons.push("explicit_human_request");
    return { mode: "handoff", reasons };
  }
  if (SUPPORT_RE.test(message)) {
    reasons.push("support_keywords");
    return { mode: "support", reasons };
  }

  const signals: string[] = [];
  if (body?.offer_id) signals.push("payload_offer_id");
  if (body?.campaign_id) signals.push("payload_campaign_id");
  if (offer && explicitOfferMention(message, offer)) signals.push("explicit_offer_mention");

  const strongTrail = ["explicit_offer_id", "explicit_campaign_id", "explicit_campaign_offer", "keyword_match"];
  if (resolutionTrail.some((t) => strongTrail.includes(t))) signals.push("strong_attribution");

  // Recent follow-up: previous outbound (within 24h) mentioned this offer title
  if (offer?.title && Array.isArray(interactions) && interactions.length) {
    const lastOutbound = interactions.find((i: any) => i.source === "tamar_outbound");
    if (lastOutbound?.content && lastOutbound?.timestamp) {
      const t = new Date(lastOutbound.timestamp).getTime();
      const fresh = Number.isFinite(t) && Date.now() - t < 24 * 3600 * 1000;
      if (
        fresh &&
        String(lastOutbound.content).toLowerCase().includes(String(offer.title).toLowerCase())
      ) {
        signals.push("recent_offer_followup");
      }
    }
  }

  if (signals.length) return { mode: "offer_specific", reasons: signals };

  reasons.push("no_strong_offer_evidence");
  if (resolutionTrail.length) reasons.push(`weak_resolution:${resolutionTrail.join(",")}`);
  return { mode: "generic_intake", reasons };
}

async function authorize(request: Request, body: any): Promise<Response | null> {
  const provided =
    request.headers.get("x-api-token") ||
    new URL(request.url).searchParams.get("token") ||
    body?.token;
  const { data: settings } = await supabaseAdmin
    .from("api_settings")
    .select("webhook_token")
    .eq("id", 1)
    .maybeSingle();
  if (settings?.webhook_token && settings.webhook_token !== provided) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

async function resolveOrCreateContact(body: any) {
  const phone = body.phone ? String(body.phone).trim() : null;
  const wa = body.whatsapp_number ? String(body.whatsapp_number).trim() : null;
  const candidates = phoneLookupCandidates(phone, wa, body.from, body.sender, body.customer_phone);
  const lookup = candidates[0] ?? null;
  const name = inboundName(body);
  if (!lookup) return null;

  const { data: existingByPhone } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .in("phone", candidates)
    .limit(1)
    .maybeSingle();
  const existing = existingByPhone ?? (await supabaseAdmin
    .from("contacts")
    .select("*")
    .in("whatsapp_number", candidates)
    .limit(1)
    .maybeSingle()).data;
  if (existing) {
    if (name && !(existing as any).full_name) {
      const { data: updated } = await supabaseAdmin
        .from("contacts")
        .update({ full_name: name } as any)
        .eq("id", (existing as any).id)
        .select("*")
        .maybeSingle();
      return updated ?? existing;
    }
    return existing;
  }

  const { data: created, error } = await supabaseAdmin
    .from("contacts")
    .insert({
      full_name: name,
      phone: phone ?? lookup,
      whatsapp_number: wa ?? lookup,
      source: coerceContactSource(body.source),
      status: "new_lead",
    } as any)
    .select("*")
    .maybeSingle();
  if (error) console.error("[tamar-turn] contact_create_failed", error.message);
  return created;
}

async function loadContext(contactId: string | null) {
  const [behaviorRes, blocksRes, interactionsRes, memoriesRes] = await Promise.all([
    supabaseAdmin.from("tamar_behavior_settings" as any).select("*").eq("id", 1).maybeSingle(),
    supabaseAdmin
      .from("tamar_prompt_blocks" as any)
      .select("block_key,title,body,version,is_active,updated_at")
      .eq("is_active", true),
    contactId
      ? supabaseAdmin
          .from("interactions")
          .select("type,source,content,timestamp,campaign_id,related_offer_id")
          .eq("contact_id", contactId)
          .order("timestamp", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as any[] }),
    contactId
      ? supabaseAdmin
          .from("contact_memories")
          .select("memory_type,memory_key,memory_value,confidence_score")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false })
          .limit(40)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  return {
    behavior: (behaviorRes as any).data ?? null,
    blocks: ((blocksRes as any).data ?? []) as any[],
    interactions: (interactionsRes as any).data ?? [],
    memories: (memoriesRes as any).data ?? [],
  };
}

async function loadRecentRuntimeHistoryByPhone(body: any) {
  const candidates = phoneLookupCandidates(body.phone, body.whatsapp_number, body.from, body.sender, body.customer_phone);
  if (!candidates.length) return [] as any[];
  const candidateSet = new Set(candidates);
  const { data } = await supabaseAdmin
    .from("tamar_runtime_executions" as any)
    .select("created_at,inbound_message,outbound_reply,raw_payload,campaign_id,offer_id")
    .order("created_at", { ascending: false })
    .limit(50);

  return ((data as any[]) ?? [])
    .filter((row) => {
      const req = row?.raw_payload?.request ?? {};
      const rowCandidates = phoneLookupCandidates(req.phone, req.whatsapp_number, req.from, req.sender, req.customer_phone);
      return rowCandidates.some((candidate) => candidateSet.has(candidate));
    })
    .flatMap((row) => {
      const ts = row.created_at;
      const common = { timestamp: ts, campaign_id: row.campaign_id ?? null, related_offer_id: row.offer_id ?? null };
      return [
        row.inbound_message ? { ...common, type: "whatsapp_message", source: "customer_inbound", content: row.inbound_message } : null,
        row.outbound_reply ? { ...common, type: "whatsapp_message", source: "tamar_outbound", content: row.outbound_reply } : null,
      ].filter(Boolean);
    });
}

function mergeRecentInteractions(primary: any[], fallback: any[]) {
  const seen = new Set<string>();
  return [...(primary ?? []), ...(fallback ?? [])]
    .filter((item) => {
      const key = `${item.timestamp ?? ""}|${item.source ?? item.type ?? ""}|${item.content ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return !!item.content;
    })
    .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())
    .slice(0, 20);
}

async function loadCampaignOffer(contact: any, body: any) {
  let campaign: any = null;
  const campaignId = body.campaign_id || contact?.last_touch_campaign_id || null;
  if (campaignId) {
    const { data } = await supabaseAdmin.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
    campaign = data;
  }
  let offer: any = null;
  const offerId = body.offer_id || campaign?.offer_id || null;
  if (offerId) {
    const { data } = await supabaseAdmin.from("offers").select("*").eq("id", offerId).maybeSingle();
    offer = data;
  }
  return { campaign, offer };
}

async function fetchCampaign(id: string | null | undefined) {
  if (!id) return null;
  const { data } = await supabaseAdmin.from("campaigns").select("*").eq("id", id).maybeSingle();
  return data;
}

async function fetchOffer(id: string | null | undefined) {
  if (!id) return null;
  const { data } = await supabaseAdmin.from("offers").select("*").eq("id", id).maybeSingle();
  return data;
}

function normalizeHe(s: string): string {
  // Normalize Hebrew destination spellings (double-yud variants, alef variants,
  // final-mem). E.g. "ויאטנם" / "ויטנאם" / "וייטנם" all collapse to a single form.
  return String(s)
    .toLowerCase()
    .replace(/יי/g, "י")
    .replace(/א/g, "")
    .replace(/ם/g, "מ");
}

function keywordMatchOffer(message: string, offers: any[]): any | null {
  if (!message || !offers?.length) return null;
  const msg = message.toLowerCase();
  const msgNorm = normalizeHe(message);
  let best: { offer: any; score: number } | null = null;
  for (const o of offers) {
    const candidates: string[] = [];
    if (o.title) candidates.push(String(o.title));
    if (Array.isArray(o.matching_tags)) candidates.push(...o.matching_tags.map(String));
    let score = 0;
    for (const c of candidates) {
      const token = c.toLowerCase().trim();
      if (!token || token.length < 2) continue;
      if (msg.includes(token)) score += token.length;
      else {
        const tokenNorm = normalizeHe(c);
        if (tokenNorm.length >= 2 && msgNorm.includes(tokenNorm)) score += tokenNorm.length;
      }
    }
    // English aliases for common destinations
    const aliases: Record<string, string[]> = {
      "וייטנאם": ["vietnam", "viet nam"],
      "יפן": ["japan"],
      "מונטנגרו": ["montenegro"],
      "תאילנד": ["thailand"],
      "הודו": ["india"],
    };
    for (const [he, ens] of Object.entries(aliases)) {
      if (candidates.some((c) => c.includes(he)) && ens.some((en) => msg.includes(en))) {
        score += 10;
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { offer: o, score };
  }
  return best?.offer ?? null;
}

/**
 * Resolution order:
 * 1. explicit offer_id from payload
 * 2. explicit campaign_id -> campaign.offer_id
 * 3. contact.last_touch_campaign_id -> campaign.offer_id
 * 4. latest interaction.related_offer_id / campaign_id for this contact
 * 5. campaign_contacts linkage (last_touch first, else most recent)
 * 6. deterministic keyword match against active offers (title + matching_tags + EN aliases)
 * 7. if exactly one active offer exists, use it as safe fallback
 */
async function resolveCampaignAndOffer(contact: any, body: any, message: string) {
  const trail: string[] = [];
  let campaign: any = null;
  let offer: any = null;

  // 1
  if (body.offer_id) {
    offer = await fetchOffer(body.offer_id);
    if (offer) trail.push("explicit_offer_id");
  }
  // 2
  if (body.campaign_id) {
    campaign = await fetchCampaign(body.campaign_id);
    if (campaign) trail.push("explicit_campaign_id");
    if (!offer && campaign?.offer_id) {
      offer = await fetchOffer(campaign.offer_id);
      if (offer) trail.push("explicit_campaign_offer");
    }
  }
  // 3
  if (!campaign && contact?.last_touch_campaign_id) {
    campaign = await fetchCampaign(contact.last_touch_campaign_id);
    if (campaign) trail.push("contact_last_touch_campaign");
    if (!offer && campaign?.offer_id) {
      offer = await fetchOffer(campaign.offer_id);
      if (offer) trail.push("contact_last_touch_offer");
    }
  }
  // 4
  if ((!campaign || !offer) && contact?.id) {
    const { data: latest } = await supabaseAdmin
      .from("interactions")
      .select("campaign_id, related_offer_id, timestamp")
      .eq("contact_id", contact.id)
      .or("campaign_id.not.is.null,related_offer_id.not.is.null")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      if (!campaign && (latest as any).campaign_id) {
        campaign = await fetchCampaign((latest as any).campaign_id);
        if (campaign) trail.push("latest_interaction_campaign");
      }
      if (!offer && (latest as any).related_offer_id) {
        offer = await fetchOffer((latest as any).related_offer_id);
        if (offer) trail.push("latest_interaction_offer");
      }
    }
  }
  // 5
  if (!campaign && contact?.id) {
    const { data: cc } = await supabaseAdmin
      .from("campaign_contacts")
      .select("campaign_id, last_touch, last_activity_at")
      .eq("contact_id", contact.id)
      .order("last_touch", { ascending: false })
      .order("last_activity_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if ((cc as any)?.campaign_id) {
      campaign = await fetchCampaign((cc as any).campaign_id);
      if (campaign) trail.push("campaign_contacts_link");
      if (!offer && campaign?.offer_id) {
        offer = await fetchOffer(campaign.offer_id);
        if (offer) trail.push("campaign_contacts_offer");
      }
    }
  }
  // 6 + 7
  if (!offer) {
    const { data: activeOffers } = await supabaseAdmin
      .from("offers")
      .select("*")
      .eq("status", "active");
    const list = (activeOffers as any[]) ?? [];
    const matched = keywordMatchOffer(message, list);
    if (matched) {
      offer = matched;
      trail.push("keyword_match");
    } else if (list.length === 1) {
      offer = list[0];
      trail.push("single_active_offer_fallback");
    }
  }

  return { campaign, offer, resolutionTrail: trail };
}

async function callModel(messages: Array<{ role: string; content: string }>) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ai_gateway_${res.status}: ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const reply: string = json?.choices?.[0]?.message?.content ?? "";
  return reply.trim();
}

function resolveTamarBackendConfig(api: any): { baseUrl: string | null; bearer: string | null; fallbackBearer: string | null; source: string } {
  const envUrl = process.env.TAMAR_API_URL?.trim();
  const envToken = process.env.TAMAR_API_TOKEN?.trim();
  const dbUrl = api?.tamar_backend_url ? String(api.tamar_backend_url).trim() : "";
  const dbToken = api?.tamar_backend_api_token ? String(api.tamar_backend_api_token).trim() : "";

  const rawUrl = envUrl || dbUrl;
  const bearer = envToken || dbToken || null;
  return {
    baseUrl: rawUrl ? rawUrl.replace(/\/$/, "") : null,
    bearer,
    fallbackBearer: envToken && dbToken && envToken !== dbToken ? dbToken : null,
    source: envUrl ? "env" : dbUrl ? "db" : "missing",
  };
}

export const Route = createFileRoute("/api/public/runtime/tamar-turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const body = await request.json().catch(() => ({} as any));
        const unauthorized = await authorize(request, body);
        if (unauthorized) return unauthorized;

        const message = String(body.message ?? "").trim();
        if (!message) {
          return new Response(JSON.stringify({ ok: false, error: "message_required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const channel = body.source ?? "whatsapp";
        const metaMessageId = body.meta_message_id ? String(body.meta_message_id) : null;

        // Idempotency: if we've already processed this Meta message id, return the prior result.
        if (metaMessageId) {
          const { data: prior } = await supabaseAdmin
            .from("tamar_runtime_executions" as any)
            .select("id, contact_id, outbound_reply, runtime_mode, raw_payload")
            .eq("raw_payload->>meta_message_id", metaMessageId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (prior) {
            return Response.json({
              ok: true,
              duplicate: true,
              reply_text: (prior as any).outbound_reply ?? "",
              contact_id: (prior as any).contact_id ?? null,
              runtime_mode: (prior as any).runtime_mode ?? "zooga_direct",
              trace_id: (prior as any).id,
              handoff_requested: false,
              meta: {
                offer_id: null,
                campaign_id: null,
                idempotent_replay: true,
              },
            });
          }
        }

        const contact = await resolveOrCreateContact(body);
        const contactId = contact?.id ?? null;

        const { behavior, blocks, interactions: contactInteractions, memories } = await loadContext(contactId);
        const runtimeHistoryFallback = await loadRecentRuntimeHistoryByPhone(body);
        const interactions = mergeRecentInteractions(contactInteractions, runtimeHistoryFallback);
        const { campaign, offer, resolutionTrail } = await resolveCampaignAndOffer(contact, body, message);

        const { mode: conversationMode, reasons: conversationModeReasons } = decideConversationMode({
          message,
          body,
          offer,
          resolutionTrail,
          interactions,
        });

        const promptBlocksMap = blocks.reduce((acc: Record<string, any>, b: any) => {
          acc[b.block_key] = { title: b.title, body: b.body, version: b.version, updated_at: b.updated_at };
          return acc;
        }, {});

        const recentText = interactions
          .slice()
          .reverse()
          .map((i: any) => `- [${i.timestamp}] ${i.source ?? i.type}: ${i.content ?? ""}`)
          .join("\n");
        const memoryText = memories
          .map((m: any) => `- (${m.memory_type}/${m.memory_key}, conf ${m.confidence_score ?? "?"}): ${m.memory_value}`)
          .join("\n");

        const offerFieldsInjected: string[] = [];
        let offerIntelligenceText: string | null = null;
        if (offer) {
          const lines: string[] = [];
          lines.push(`Offer: ${offer.title}`);
          offerFieldsInjected.push("title");
          if (offer.price != null && offer.price !== "") {
            const cur = (offer.currency || "ILS").toUpperCase();
            const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : "₪";
            lines.push(`Price (authoritative — answer directly if asked, in this currency): ${sym}${offer.price} (${cur})`);
            offerFieldsInjected.push("price");
            offerFieldsInjected.push("currency");
          }
          if (offer.offer_url) {
            lines.push(`Offer URL (send this link directly when the user asks for a link, sales page, registration, or more info): ${offer.offer_url}`);
            offerFieldsInjected.push("offer_url");
          }
          if (offer.ai_summary) {
            lines.push(`Summary:\n${offer.ai_summary}`);
            offerFieldsInjected.push("ai_summary");
          }
          if (offer.sales_angle) {
            lines.push(`Sales angle:\n${offer.sales_angle}`);
            offerFieldsInjected.push("sales_angle");
          }
          if (offer.description) {
            lines.push(`Description:\n${offer.description}`);
            offerFieldsInjected.push("description");
          }
          if (offer.grounded_facts && Object.keys(offer.grounded_facts).length) {
            lines.push(`Grounded facts (authoritative — answer directly from these):\n${JSON.stringify(offer.grounded_facts, null, 2)}`);
            offerFieldsInjected.push("grounded_facts");
          }
          if (Array.isArray(offer.faq_bundle) && offer.faq_bundle.length) {
            lines.push(`FAQ (answer directly from these when the user asks a matching question):\n${JSON.stringify(offer.faq_bundle, null, 2)}`);
            offerFieldsInjected.push("faq_bundle");
          }
          if (Array.isArray(offer.objection_notes) && offer.objection_notes.length) {
            lines.push(`Objection notes (use these to address concerns directly instead of escalating):\n${JSON.stringify(offer.objection_notes, null, 2)}`);
            offerFieldsInjected.push("objection_notes");
          }
          if (offer.escalation_boundary && Object.keys(offer.escalation_boundary).length) {
            lines.push(`Escalation boundary (escalate ONLY for topics inside this boundary):\n${JSON.stringify(offer.escalation_boundary, null, 2)}`);
            offerFieldsInjected.push("escalation_boundary");
          }
          if (Array.isArray(offer.matching_tags) && offer.matching_tags.length) {
            lines.push(`Matching tags: ${offer.matching_tags.join(", ")}`);
          }
          offerIntelligenceText = lines.join("\n\n");
        }

        // Unified runtime: do NOT gate offer intelligence by mode. If an offer
        // was resolved as relevant, its full intelligence is always available
        // to the reply. Mode only shifts emphasis (see composition mode rules).
        const effectiveOfferIntelligenceText = offerIntelligenceText;

        // Active context layers — visible in Runtime Trace so we can see
        // every capability that ran on this turn (memory, profile, offer,
        // intake, handoff risk) instead of a single mode badge.
        const activeContextLayers = {
          memory: {
            active: (memories?.length ?? 0) > 0,
            count: memories?.length ?? 0,
          },
          contact_profile: {
            active: !!contact,
            known_name: !!(contact?.full_name || contact?.first_name),
            intake_status: contact?.intake_status ?? null,
          },
          offer_event: {
            active: !!offer,
            offer_id: offer?.id ?? null,
            offer_title: offer?.title ?? null,
            campaign_id: campaign?.id ?? null,
            resolution_trail: resolutionTrail,
          },
          intake_progress: {
            active: !contact?.full_name || !contact?.preferred_language_style,
            missing: [
              !contact?.full_name ? "full_name" : null,
              !contact?.preferred_language_style ? "preferred_language_style" : null,
            ].filter(Boolean) as string[],
          },
          handoff_risk: {
            active: conversationMode === "handoff" || HUMAN_REQUEST_RE.test(message),
            triggered_by: conversationMode === "handoff" ? conversationModeReasons : [],
          },
          conversation_priority: conversationMode,
          conversation_priority_reasons: conversationModeReasons,
        };

        const composition = buildTamarRuntimeComposition({
          inboundMessage: message,
          source: "tamar_turn",
          contact,
          campaign,
          offer,
          offerIntelligenceText: effectiveOfferIntelligenceText,
          tamarSettings: behavior,
          promptBlocks: promptBlocksMap,
          offerFieldsInjected,
          conversationMode,
          conversationModeReasons,
          activeContextLayers,
        });

        const systemMsg = composition.runtimePromptContext.messages.find((m: any) => m.role === "system");
        const systemContent = [
          systemMsg?.content ?? "",
          recentText ? `\n## Recent conversation\n${recentText}` : "",
          memoryText ? `\n## Known memories\n${memoryText}` : "",
        ].join("\n");

        let replyText = "";
        let runtimeError: string | null = null;
        try {
          replyText = await callModel([
            { role: "system", content: systemContent },
            { role: "user", content: message },
          ]);
        } catch (e: any) {
          runtimeError = String(e?.message ?? e);
        }

        // Persist inbound interaction
        if (contactId) {
          await supabaseAdmin.from("interactions").insert({
            contact_id: contactId,
            type: "whatsapp_message",
            source: channel,
            content: message,
            campaign_id: campaign?.id ?? null,
            related_offer_id: offer?.id ?? null,
          } as any);
          if (replyText) {
            await supabaseAdmin.from("interactions").insert({
              contact_id: contactId,
              type: "whatsapp_message",
              source: "tamar_outbound",
              content: replyText,
              campaign_id: campaign?.id ?? null,
              related_offer_id: offer?.id ?? null,
            } as any);
          }
        }

        const promptBlocksInjected = Object.entries(promptBlocksMap).map(([k, v]: [string, any]) => ({
          key: k,
          version: v?.version ?? null,
          updated_at: v?.updated_at ?? null,
        }));

        const { data: trace } = await supabaseAdmin
          .from("tamar_runtime_executions" as any)
          .insert({
            contact_id: contactId,
            campaign_id: campaign?.id ?? null,
            offer_id: offer?.id ?? null,
            channel,
            source: "zooga_tamar_turn",
            inbound_message: message,
            outbound_reply: replyText || null,
            runtime_mode: runtimeError ? "failed_before_reply" : "zooga_direct",
            conversation_mode: conversationMode,
            conversation_mode_reasons: conversationModeReasons,
            runtime_pack_fetch_ok: true,
            fallback_reason: runtimeError,
            composition_version: "zooga-tamar-runtime-composition-v1",
            tamar_settings_version_at: behavior?.updated_at ?? null,
            prompt_blocks_injected: promptBlocksInjected,
            offer_intelligence_injected: !!offer,
            campaign_injected: !!campaign,
            latency_ms: Date.now() - startedAt,
            error: runtimeError,
            raw_payload: {
              request: { ...body, message },
              meta_message_id: metaMessageId,
              meta_timestamp: body.meta_timestamp ?? null,
              model: MODEL,
              prompt_preview: composition.tracePromptContext.prompt_text_preview,
              resolution_trail: resolutionTrail,
              resolved_offer_id: offer?.id ?? null,
              resolved_campaign_id: campaign?.id ?? null,
              conversation_mode: conversationMode,
              conversation_mode_reasons: conversationModeReasons,
              offer_intelligence_effective: !!offer,
              active_context_layers: activeContextLayers,
            },
          })
          .select("id")
          .single();

        if (runtimeError) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: runtimeError,
              runtime_mode: "failed_before_reply",
              contact_id: contactId,
              trace_id: (trace as any)?.id ?? null,
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const handoffRequested = detectHandoff(replyText);

        // --- Manager handoff alert (V1) ---
        // Trigger when Tamar decided handoff mode OR the reply text contains
        // a handoff phrase. Zooga owns the decision; Railway only delivers.
        let handoffId: string | null = null;
        let managerNotified = false;
        if (conversationMode === "handoff" || handoffRequested) {
          try {
            const excerpt = interactions
              .slice(0, 10)
              .reverse()
              .map((i: any) => ({
                ts: i.timestamp,
                source: i.source ?? i.type,
                content: i.content ?? "",
              }));
            excerpt.push({ ts: new Date().toISOString(), source: "customer_inbound", content: message });
            if (replyText) {
              excerpt.push({ ts: new Date().toISOString(), source: "tamar_outbound", content: replyText });
            }

            const handoffReason =
              conversationMode === "handoff"
                ? (conversationModeReasons[0] || "conversation_mode_handoff")
                : "tamar_reply_handoff_phrase";

            const customerPhone =
              firstNonEmpty(contact?.phone, contact?.whatsapp_number, body.phone, body.whatsapp_number, body.from, body.sender, body.customer_phone);
            const customerName =
              firstNonEmpty(contact?.full_name, [contact?.first_name, contact?.last_name].filter(Boolean).join(" "), inboundName(body));
            const customerNameForAlert = customerName ?? "Unknown WhatsApp contact";
            const recentConversationExcerpt = conversationExcerptText(excerpt);
            const resolvedOfferTitle = offer?.title ?? null;
            const resolvedCampaignName = campaign?.name ?? null;
            const runtimeTraceId = (trace as any)?.id ?? null;

            const { data: handoffRow } = await supabaseAdmin
              .from("manager_handoffs" as any)
              .insert({
                contact_id: contactId,
                customer_phone: customerPhone,
                customer_name: customerNameForAlert,
                handoff_reason: handoffReason,
                latest_inbound_message: message,
                conversation_excerpt: excerpt,
                resolved_offer_id: offer?.id ?? null,
                resolved_campaign_id: campaign?.id ?? null,
                runtime_trace_id: runtimeTraceId,
                conversation_mode: conversationMode,
                conversation_mode_reasons: conversationModeReasons,
                status: "open",
              } as any)
              .select("id")
              .single();
            handoffId = (handoffRow as any)?.id ?? null;

            // Resolve active manager (V1: first active row, typically Alex)
            const { data: manager } = await supabaseAdmin
              .from("managers" as any)
              .select("id, name, phone")
              .eq("active", true)
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle();

            // Resolve Railway delivery target
            const { data: api } = await supabaseAdmin
              .from("api_settings")
              .select("tamar_backend_url, tamar_backend_api_token")
              .eq("id", 1)
              .maybeSingle();
            const { baseUrl, bearer, fallbackBearer, source: backendConfigSource } = resolveTamarBackendConfig(api);

            const alertPayload = {
              handoff_id: handoffId,
              manager_id: manager ? (manager as any).id : null,
              manager_name: manager ? (manager as any).name : null,
              manager_phone: manager ? (manager as any).phone : null,
              manager: manager
                ? { id: (manager as any).id, name: (manager as any).name, phone: (manager as any).phone }
                : null,
              customer_contact_id: contactId,
              customer_phone: customerPhone,
              customer_name: customerNameForAlert,
              customer_name_known: !!customerName,
              customer: {
                contact_id: contactId,
                phone: customerPhone,
                name: customerNameForAlert,
                name_known: !!customerName,
              },
              handoff_reason: handoffReason,
              conversation_mode: conversationMode,
              conversation_mode_reasons: conversationModeReasons,
              latest_inbound_message: message,
              recent_conversation_excerpt: recentConversationExcerpt,
              conversation_excerpt: excerpt,
              resolved_offer_id: offer?.id ?? null,
              resolved_offer_title: resolvedOfferTitle,
              resolved_campaign_id: campaign?.id ?? null,
              resolved_campaign_name: resolvedCampaignName,
              resolved: {
                offer_id: offer?.id ?? null,
                offer_title: resolvedOfferTitle,
                campaign_id: campaign?.id ?? null,
                campaign_name: resolvedCampaignName,
              },
              runtime_trace_id: runtimeTraceId,
              backend_config_source: backendConfigSource,
              created_at: new Date().toISOString(),
            };

            let alertResponse: any = null;
            let alertError: string | null = null;
            if (baseUrl && manager) {
              try {
                const postAlert = (token: string | null) => fetch(`${baseUrl}/manager-alerts/handoff`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  },
                  body: JSON.stringify(alertPayload),
                });
                let res = await postAlert(bearer);
                let retriedWithDbToken = false;
                if (res.status === 401 && fallbackBearer) {
                  res = await postAlert(fallbackBearer);
                  retriedWithDbToken = true;
                }
                const txt = await res.text().catch(() => "");
                let parsed: any = null;
                try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = { raw: txt }; }
                alertResponse = { status: res.status, body: parsed, retried_with_db_token: retriedWithDbToken };
                if (res.ok) managerNotified = true;
                else alertError = `railway_${res.status}`;
              } catch (e: any) {
                alertError = `delivery_failed: ${String(e?.message ?? e).slice(0, 200)}`;
              }
            } else {
              alertError = !baseUrl ? "tamar_backend_url_missing" : "no_active_manager";
            }

            if (handoffId) {
              await supabaseAdmin
                .from("manager_handoffs" as any)
                .update({
                  alert_payload: alertPayload,
                  alert_response: alertResponse,
                  alert_error: alertError,
                  manager_notified: managerNotified,
                  notified_at: managerNotified ? new Date().toISOString() : null,
                  notified_manager_id: manager ? (manager as any).id : null,
                  status: managerNotified ? "notified" : "open",
                } as any)
                .eq("id", handoffId);
            }

            // Flag the contact for the existing Handoff Console
            if (contactId) {
              await supabaseAdmin
                .from("contacts")
                .update({ manager_attention_required: true } as any)
                .eq("id", contactId);
            }
          } catch (e) {
            // Never block the customer reply on alert failure.
            console.error("[manager-handoff] failed", e);
          }
        }

        return Response.json({
          ok: true,
          reply_text: replyText,
          contact_id: contactId,
          runtime_mode: "zooga_direct",
          trace_id: (trace as any)?.id ?? null,
          handoff_requested: handoffRequested,
          handoff: handoffId
            ? { id: handoffId, manager_notified: managerNotified }
            : null,
          meta: {
            offer_id: offer?.id ?? null,
            campaign_id: campaign?.id ?? null,
            conversation_mode: conversationMode,
            conversation_mode_reasons: conversationModeReasons,
          },
        });
      },
    },
  },
});