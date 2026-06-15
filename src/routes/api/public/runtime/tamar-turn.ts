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
import { buildPricingStateBlock } from "@/lib/offer-pricing-block";
import {
  computeIntakeSnapshot,
  selectNextIntakeField,
  composeIntakeDirective,
  extractIntakeCaptures,
  inboundAnswersField,
  INTAKE_REQUIRED_FIELDS,
} from "@/lib/intake-workflow";
import { fieldValueToColumnUpdates } from "@/lib/intake-workflow";
import { requestRuntimeDecision, type RuntimeDecision } from "@/lib/runtime-decision";
import { decideRecovery, summarizeKnownIntake, type RecoveryDecision } from "@/lib/intake-recovery";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const HANDOFF_PATTERNS = [
  /מעביר(ה)?\s+(אותך\s+)?ל(נציג|אדם|מנהל|צוות)/i,
  /מעביר(ה)?\s+(את\s+)?(הבקשה|הפנייה|הפרטים|הנושא|הפנייה\s+שלך|הבקשה\s+שלך)/i,
  /(אעביר|נעביר|מעבירים)\s+(את\s+)?(זה|הבקשה|הפנייה|הפרטים|הנושא|הפנייה\s+שלך|הבקשה\s+שלך)?\s*(ל)?(צוות|נציג|מנהל|טיפול\s+אנושי|מי\s+שיוכל)?/i,
  /(אעדכן|נעדכן|אעביר\s+עדכון)\s+את\s+(הצוות|הנציג|המנהל)/i,
  /(הצוות|נציג|מנהל)\s+(שלנו\s+)?(יחזור|תחזור|יחזרו|נחזור|יצור\s+קשר|ייצור\s+קשר)\s+אלי(י)?ך/i,
  /נחזור\s+אלי(י)?ך\s+(בהקדם|עם\s+תשובה|בקרוב)/i,
  /(מעביר(ה)?|אעביר)\s+(את\s+)?הפרטים\s+ל(צוות|נציג|מנהל)/i,
  /אבדוק\s+(מול|עם)\s+(הצוות|מנהל|נציג|אדם)/i,
  /אחזור\s+אלי(י)?ך\s+(עם\s+תשובה|בהקדם)/i,
  /מעבירה?\s+לטיפול\s+אנושי/i,
  /transferring you to (a|our) (human|agent|representative|manager)/i,
  /escalat(e|ing) to (a|our) (human|agent|team|manager)/i,
  /let me check with (the|our) (team|manager|human)/i,
  /(i'll|i will|we'll|we will)\s+(forward|pass|escalate|hand)\s+(this|your|the)\s+(request|details|message)\s+to\s+(the\s+)?(team|manager|human|agent)/i,
  /(our|the)\s+(team|manager|agent)\s+(will|'ll)\s+(get back|reach out|contact you)/i,
];

// User explicitly asking for a human (already handled in mode decision, kept
// here so the handoff decision is robust even if mode is wrong).
const USER_HUMAN_REQUEST_RE =
  /(נציג|לדבר עם אדם|אדם אמיתי|בן ?אדם|מנהל(ת)?|העבר(ו|י)?\s+(אותי\s+)?ל(נציג|מנהל|אדם)|תעביר(י|ו)?\s+(אותי\s+)?ל|human|real person|speak to (a |an )?(agent|representative|manager|human))/i;

// Phrasings Tamar uses when she proposes transferring to a human. If a prior
// assistant turn contained one of these and the next user reply is an
// affirmation, that counts as the user confirming a handoff.
const TRANSFER_QUESTION_RE =
  /(להעביר(\s+אותך)?\s+ל(נציג|מנהל|צוות|אדם))|(שאעביר\s+(אותך|את\s+הבקשה|את\s+הפרטים)?\s*ל?(נציג|מנהל|צוות))|(תרצ(ה|י)\s+ש(אעביר|נעביר|אדבר|נדבר|נציג|מישהו))|(want me to (transfer|escalate|connect|forward).+(human|agent|manager|team))/i;

// Affirmative user replies (Hebrew + English, short forms).
const AFFIRMATIVE_RE =
  /^(\s*)(כן|בטח|בהחלט|אוקיי|אוקי|אישור|מאשר(ת)?|סבבה|יאללה|נכון|בסדר|אנא|בבקשה|תעביר(י|ו)?|העבר(ו|י)?|yes|yep|yeah|sure|ok|okay|please\s+do|go\s+ahead|do\s+it)([\s.!?]|$)/i;

// Catalog browse intent — the user is asking what else is on offer rather
// than continuing a thread about one specific trip. When this fires we must
// NOT pin to a sticky prior-interaction offer; we must broaden context and
// inject the full active catalog so Tamar can name new trips.
const CATALOG_BROWSE_RE =
  /(יעדים\s*נוספים|יעדים\s*אחרים|טיולים\s*נוספים|טיולים\s*אחרים|טיולים?\s+ל?(חו["׳״']?ל|חול|חוץ\s+לארץ)|טיולי\s+(חו["׳״']?ל|חול|חוץ\s+לארץ)|יש\s+(לך|לכם)\s+טיולים?|אירועים\s*נוספים|הצעות\s*נוספות|אפשרויות\s*נוספות|אופציות\s*נוספות|משהו\s*אחר|יש\s+עוד|מה\s+(יש|עוד|קיים)\s+(לך|לכם|אצלך|אצלכם)?(\s+(להציע|להראות|בקטלוג|בארגז|במלאי))?|מה\s+(אתה|אתם)\s+מציע(ים)?|מה\s+ההצעות|איזה\s+(טיולים|יעדים|הצעות|אפשרויות|אופציות)(\s+יש|\s+קיימים)?|אילו\s+(טיולים|יעדים|הצעות|אפשרויות|אופציות)(\s+יש|\s+קיימים)?|כל\s+(הטיולים|היעדים|האפשרויות|האופציות)|ת(ראה|ראי|ציג|ציגי)\s+(לי\s+)?(את\s+)?הכל|להציע\s+לי|זה\s+הכל\??|זה\s+כל\s+מה|רק\s+\d+\s*(טיולים|יעדים|אפשרויות|הצעות)\??|other\s+(trips|destinations|offers|options)|trips\s+abroad|show\s+me\s+(everything|all)|list\s+(all\s+)?(trips|offers|options)|what\s+else\s+(do\s+you|you\s+have)|what\s+do\s+you\s+(have|offer))/i;

// Challenge-the-count: the user is doubting the size/completeness of the
// catalog ("רק 3 טיולים?", "זה הכל?", "באמת רק 3?"). Treat as a browse
// trigger so we re-inject the full catalog and correct the record.
const CATALOG_CHALLENGE_RE =
  /(רק\s*\d+\s*(טיולים|יעדים|הצעות|אפשרויות|אופציות)?\s*\??|באמת\s+רק\s*\d+|זה\s+הכל\??|זה\s+כל\s+מה\s+שיש|אין\s+(עוד|יותר)\s*\??|זהו\??)/i;

function isCatalogBrowseIntent(message: string): boolean {
  if (!message) return false;
  return CATALOG_BROWSE_RE.test(message) || CATALOG_CHALLENGE_RE.test(message);
}

function catalogPriceForCustomer(o: any): string {
  const cur = (o?.currency || "ILS").toUpperCase();
  const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : "₪";
  if (o?.pricing_status === "published" && o?.base_price_per_person != null) {
    return ` — ${sym}${o.base_price_per_person} לאדם${o.single_supplement != null ? `, תוספת יחיד ${sym}${o.single_supplement}` : ""}`;
  }
  if (o?.price != null && o.price !== "") return ` — ${sym}${o.price}`;
  return " — מחיר יפורסם בהמשך";
}

function buildHardBrowseCatalogReply(ready: any[], pending: any[]): string {
  const readyLines = ready.map((o, index) => `${index + 1}. ${o.title}${catalogPriceForCustomer(o)}`);
  const pendingLines = pending.map((o, index) => `${ready.length + index + 1}. ${o.title} — פרטים בהכנה`);
  const listed = [...readyLines, ...pendingLines];
  const intro = ready.length
    ? "כן — אלו הטיולים שזמינים אצלנו כרגע:"
    : "כרגע אלה הטיולים שמופיעים אצלנו במערכת:";
  return `${intro}\n${listed.join("\n")}\n\nעל איזה מהם תרצה שאפרט?`;
}

// B1 — opener / re-entry detection. A bare greeting or restart should NEVER
// inherit a pinned intake_last_question_key (especially not budget). When
// this fires we both (a) suppress any intake question this turn and (b)
// clear stale pinned question keys on the contact row.
const OPENER_RE =
  /^\s*(היי(\s+תמר)?|הי(\s+תמר)?|שלום(\s+תמר)?|בוקר\s+טוב|ערב\s+טוב|hi|hey|hello|good\s+(morning|evening))[\s.!?]*$/i;
function isOpenerTurn(message: string): boolean {
  if (!message) return false;
  return OPENER_RE.test(message.trim());
}

function detectHandoff(reply: string): boolean {
  if (!reply) return false;
  return HANDOFF_PATTERNS.some((re) => re.test(reply));
}

/**
 * Robust handoff decision. Does NOT rely only on the reply text — combines:
 *  - conversation mode decision (mode === 'handoff')
 *  - explicit human request in the current user message
 *  - assistant reply text containing a transfer phrase
 *  - prior assistant turn asked "should I transfer?" + current user said yes
 */
function decideHandoff(args: {
  message: string;
  replyText: string;
  conversationMode: ConversationMode;
  conversationModeReasons: string[];
  interactions: any[];
  llmDecision?: RuntimeDecision | null;
  recovery?: RecoveryDecision | null;
}): { handoff: boolean; reason: string; triggers: string[] } {
  const triggers: string[] = [];

  if (args.conversationMode === "handoff") {
    triggers.push("conversation_mode_handoff");
  }
  if (args.message && USER_HUMAN_REQUEST_RE.test(args.message)) {
    triggers.push("explicit_human_request");
  }
  if (args.replyText && HANDOFF_PATTERNS.some((re) => re.test(args.replyText))) {
    triggers.push("assistant_transfer_phrase");
  }

  // Confirmation flow: was the previous assistant turn asking to transfer?
  if (args.message && AFFIRMATIVE_RE.test(args.message.trim())) {
    const lastOutbound = (args.interactions || []).find(
      (i: any) => i?.source === "tamar_outbound" || i?.type === "tamar_outbound",
    );
    const prevText = String(lastOutbound?.content ?? "");
    if (prevText && TRANSFER_QUESTION_RE.test(prevText)) {
      triggers.push("user_confirmed_transfer");
    }
  }

  // LLM decision layer (guard-railed): only honor if model is confident.
  if (args.llmDecision?.handoff_requested && args.llmDecision.handoff_confidence >= 70) {
    triggers.push("llm_decision_handoff");
    for (const r of args.llmDecision.handoff_reasons.slice(0, 4)) {
      triggers.push(`llm_reason:${r}`);
    }
  }

  // Frustration override: repeated distress signals escalate to a human even
  // without an explicit request — the intake loop itself is the problem.
  if (args.recovery?.suggest_handoff) {
    triggers.push(`repeated_frustration_streak_${args.recovery.frustration_streak}`);
  }

  const handoff = triggers.length > 0;
  const reason =
    triggers[0] ||
    args.conversationModeReasons[0] ||
    "no_trigger";
  return { handoff, reason, triggers };
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
      const [firstPart, ...restParts] = name.split(/\s+/);
      const lastPart = restParts.join(" ").trim() || null;
      const { data: updated } = await supabaseAdmin
        .from("contacts")
        .update({
          first_name: firstPart || null,
          last_name: lastPart,
        } as any)
        .eq("id", (existing as any).id)
        .select("*")
        .maybeSingle();
      return updated ?? existing;
    }
    return existing;
  }

  const [firstPart, ...restParts] = (name ?? "").split(/\s+/).filter(Boolean);
  const lastPart = restParts.join(" ").trim() || null;
  const { data: created, error } = await supabaseAdmin
    .from("contacts")
    .insert({
      first_name: firstPart || null,
      last_name: lastPart,
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
const STALE_INTERACTION_SKIP_HOURS = 48;

async function resolveCampaignAndOffer(
  contact: any,
  body: any,
  message: string,
  opts: { browseIntent?: boolean } = {},
) {
  const trail: string[] = [];
  let campaign: any = null;
  let offer: any = null;
  const browseIntent = !!opts.browseIntent;
  let activeOffersAll: any[] | null = null;

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
      const ts = (latest as any).timestamp ? new Date((latest as any).timestamp).getTime() : 0;
      const ageHours = ts ? (Date.now() - ts) / 3600000 : Infinity;
      const stale = ageHours > STALE_INTERACTION_SKIP_HOURS;
      const skipLatch = browseIntent && stale;
      if (skipLatch) {
        trail.push(`stale_interaction_skipped:${Math.round(ageHours)}h`);
      } else {
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
  // Always load the active offer catalog so downstream code can:
  //   (a) keyword-match for fallback resolution (steps 6+7), and
  //   (b) detect destination-mismatch even when a sticky prior offer was
  //       already latched in steps 3–5 (e.g. user asks about Albania but
  //       the latest_interaction_offer is Vietnam).
  if (activeOffersAll === null) {
    const { data: activeOffers } = await supabaseAdmin
      .from("offers")
      .select("*")
      .eq("status", "active")
      .or(`event_date.is.null,event_date.gte.${new Date().toISOString()}`);
    activeOffersAll = (activeOffers as any[]) ?? [];
  }

  const keywordMatched = keywordMatchOffer(message, activeOffersAll);
  let destinationOverride = false;

  // 6 + 7
  if (!offer) {
    if (keywordMatched) {
      offer = keywordMatched;
      trail.push("keyword_match");
    } else if (activeOffersAll.length === 1) {
      offer = activeOffersAll[0];
      trail.push("single_active_offer_fallback");
    }
  } else if (
    keywordMatched &&
    keywordMatched.id !== offer.id &&
    // Only override sticky resolutions; do NOT override explicit_* or
    // campaign-derived resolutions, which the caller asked for by id.
    trail.every(
      (t) =>
        t === "contact_last_touch_campaign" ||
        t === "contact_last_touch_offer" ||
        t === "latest_interaction_campaign" ||
        t === "latest_interaction_offer" ||
        t === "campaign_contacts_link" ||
        t === "campaign_contacts_offer" ||
        t.startsWith("stale_interaction_skipped"),
    )
  ) {
    offer = keywordMatched;
    campaign = null;
    trail.push("destination_keyword_override");
    destinationOverride = true;
  }

  return {
    campaign,
    offer,
    resolutionTrail: trail,
    activeOffersAll,
    keywordMatchedOfferId: keywordMatched?.id ?? null,
    destinationOverride,
  };
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
        const browseIntentDetected = isCatalogBrowseIntent(message);
        const openerTurnDetected = isOpenerTurn(message);
        const {
          campaign,
          offer,
          resolutionTrail,
          activeOffersAll: resolverActiveOffers,
          keywordMatchedOfferId,
          destinationOverride,
        } = await resolveCampaignAndOffer(contact, body, message, {
          browseIntent: browseIntentDetected,
        });

        const { mode: conversationMode, reasons: conversationModeReasons } = decideConversationMode({
          message,
          body,
          offer,
          resolutionTrail,
          interactions,
        });

        // --- Intake Workflow V1 (parallel layer; never suppresses answer) ---
        const lastAskedKey = contact?.intake_last_question_key ?? null;
        const lastAnswered = inboundAnswersField(message, lastAskedKey);

        // --- Pre-reply capture projection (state sync fix) ---
        // Reply layer and intake state layer must NOT diverge. The LLM can
        // see the inbound message and use facts from it (e.g. address the
        // user by the name they just gave). If we compute the snapshot from
        // the pre-turn contact only, the directive can still target a field
        // that's effectively already known on this turn — producing a trace
        // where reply uses the name but `next_target_field = first_name`.
        // Fix: run the deterministic regex/bare-name extractors NOW, project
        // those high-confidence captures onto the contact, and compute the
        // snapshot from the projected contact. The actual persistence step
        // below reuses the same captures so there is one source of truth.
        const preCaptures = extractIntakeCaptures(message, contact, { lastAskedKey });
        const preHighConf = preCaptures.filter((c) => c.confidence >= 75);
        const projectedContact: any = contact ? { ...contact } : contact;
        if (projectedContact) {
          const projectedCompleted = new Set<string>(
            Array.isArray(projectedContact.intake_completed_fields)
              ? (projectedContact.intake_completed_fields as string[])
              : [],
          );
          for (const cap of preHighConf) {
            Object.assign(projectedContact, cap.columnUpdates);
            projectedCompleted.add(cap.field);
          }
          projectedContact.intake_completed_fields = [...projectedCompleted];
        }
        const intakeSnapshot = computeIntakeSnapshot(projectedContact ?? contact);
        const intakeSnapshotPreProjection = computeIntakeSnapshot(contact);

        // --- Recovery safeguards: repetition guard / frustration override /
        // capture recovery. Evaluated BEFORE normal intake progression.
        const recovery = decideRecovery({
          message,
          interactions,
          lastAskedKey,
          snapshot: intakeSnapshot,
          knownSummary: summarizeKnownIntake(projectedContact ?? contact),
        });

        const nextIntakeField = recovery.suppress_intake_question
          ? null
          : selectNextIntakeField(intakeSnapshot, {
              lastAskedKey,
              lastAskedAt: contact?.intake_last_question_at ?? null,
              lastInboundLooksLikeAnswer: lastAnswered,
              mode: conversationMode,
            });
        // Price-question guard. If the user is asking about price and the
        // resolved offer has an authoritative price, do NOT layer a budget
        // intake question on top of the answer — it reads as evasive. Tamar
        // must state the price directly first; budget can come later.
        const PRICE_QUERY_RE =
          /(כמה\s+(זה|עולה|המחיר)|מה\s+המחיר|המחיר\??|מחיר\??|עלות|how\s+much|price|cost)/i;
        const offerHasPrice = !!offer && offer.price != null && offer.price !== "";
        const priceQueryThisTurn = PRICE_QUERY_RE.test(message ?? "");
        // Special / non-standard request signals: group bookings, couples-
        // together, private group, accessibility, kosher level, custom dates,
        // bringing kids/parents, corporate, etc. These are exactly the asks
        // where Tamar should NOT bluff with generic answers or pile on more
        // intake — she should answer honestly within grounded knowledge and
        // offer a human handoff if precision is missing.
        const SPECIAL_REQUEST_RE =
          /(קבוצה|קבוצתי|לקבוצה|מפגש\s+קבוצתי|זוגות|כזוג|לזוגות|ביחד\s+כזוג|פרטי|פרטית|מותאם|התאמה\s+אישית|תאריכים\s+אחרים|לבד\s+אבל|נגישות|נגיש|כושר\s+פיזי|רפואי|כשרות|מהדרין|חרדי|דתי|ילדים|הורים|חברה|חברת|תאגיד|ארגוני|בלעדי|custom|group|private|couples|corporate|accessib|kosher)/i;
        const specialRequestThisTurn = SPECIAL_REQUEST_RE.test(message ?? "");
        // "Enough context already captured" — once a few core preference/
        // identity fields are in, additional weak-intake questions become
        // lower priority than clarifying, matching, suggesting or handing off.
        const completedCount = (intakeSnapshot?.completed?.length ?? 0) as number;
        const enoughContextCaptured = completedCount >= 3;
        const suppressBudgetForPriceQuery =
          priceQueryThisTurn &&
          offerHasPrice &&
          nextIntakeField === "budget_sensitivity_or_range";
        // Suppress further intake on this turn when a higher-priority action
        // path exists: a special/non-standard request, a price question, or
        // when we already have enough context to be useful and the user is
        // asking something concrete.
        const suppressIntakeForHigherPriority =
          specialRequestThisTurn ||
          (enoughContextCaptured && (priceQueryThisTurn || specialRequestThisTurn));
        // B1 hard guard — opener / browse / generic_intake re-entry turns
        // must never ask about budget, affordability or investment, and must
        // not surface any intake question. This is what prevents the
        // resumed-thread "what's your budget?" leak.
        const suppressIntakeForOpenerOrBrowse =
          openerTurnDetected || browseIntentDetected;
        const effectiveNextIntakeField =
          suppressBudgetForPriceQuery ||
          suppressIntakeForHigherPriority ||
          suppressIntakeForOpenerOrBrowse
            ? null
            : nextIntakeField;
        // In recovery mode the recovery directive REPLACES the intake directive.
        const intakeDirective =
          recovery.directive ?? composeIntakeDirective(effectiveNextIntakeField);

        // Hard reply constraints that override the LLM's tendency to keep asking
        // qualification questions even when intake state says "no question".
        // L0 of the consolidated policy hierarchy: these are THIS-TURN-ONLY
        // facts (price values, link URLs, "no price yet", "no intake this
        // turn"). General style / one-question / no-invention / cross-offer
        // framing now lives in tamar-runtime-composition L1–L4 and must NOT
        // be re-stated here.
        const replyHardRules: string[] = [];
        if (suppressIntakeForOpenerOrBrowse) {
          replyHardRules.push(
            browseIntentDetected
              ? "HARD BROWSE RULE: the user is asking what trips exist / what we have. In this same turn, answer with the actual catalog-ready offers by title. Do NOT ask a preference question first, do NOT say you can tell them about some options, do NOT soft-deflect, and do NOT hand off unless the user explicitly asked for a human. Only after listing may you ask which trip to expand on."
              : "Opener / re-entry turn. ABSOLUTELY DO NOT ask about budget, price range, affordability, investment, השקעה, תקציב, or any qualification field. Greet briefly and invite them to share what they're looking for.",
          );
        }
        if (suppressBudgetForPriceQuery) {
          const cur = (offer?.currency || "ILS").toUpperCase();
          const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : "₪";
          replyHardRules.push(
            `Price-question fact: state the exact price ${sym}${offer?.price} (${cur}) for "${offer?.title ?? ""}" plainly and first. Do NOT ask any budget / price-range / affordability question this turn.`,
          );
        }
        // Cross-offer price-confusion guard. Whenever the user asks a price
        // question and the asked offer has no authoritative price, surface
        // that fact. (General cross-offer framing lives in L1.)
        if (priceQueryThisTurn) {
          const askedTitle = offer?.title ? `"${offer.title}"` : "the asked trip";
          if (!offerHasPrice) {
            replyHardRules.push(
              `Price fact: ${askedTitle} has NO final price in the system yet. Say so plainly in Hebrew (e.g. "המחיר הסופי ל${offer?.title ?? "טיול הזה"} עדיין לא סגור"), offer to update once set or connect a human. Do NOT invent or estimate a price, and do NOT quote another trip's price as this one's.`,
            );
          }
        }
        if (effectiveNextIntakeField === null && !intakeDirective) {
          replyHardRules.push(
            "No intake question this turn. Answer the topic; at most ONE directional question if it clearly advances.",
          );
        }

        // Special / non-standard request signal — narrow this-turn fact.
        if (specialRequestThisTurn) {
          replyHardRules.push(
            "Special/non-standard request on this turn (group, couples, private, custom dates, accessibility, kosher, kids/parents, corporate). Answer only from grounded FAQ/offer intelligence; if the precise answer is missing, say so plainly and offer a human handoff. Any single question this turn must directly resolve THIS request (e.g. group size, which dates) — not birth date or style preference.",
          );
        }

        // (Bias-toward-advance when enough context is captured is enforced
        // upstream by suppressing nextIntakeField, and globally by L2/L4.)

        // --- Sales momentum guards (offer_specific) ---
        // Count prior Tamar outbound messages with this contact to estimate
        // where we are in the sales conversation. Message 2-3+ on the
        // offer-specific track is when the link + emotional/social angle
        // should start appearing — not on the very first reply.
        const priorTamarOutbounds = (interactions || []).filter(
          (i: any) => i.source === "tamar_outbound",
        ).length;
        const isOfferSpecific = conversationMode === "offer_specific";
        const hasOfferUrl = !!offer?.offer_url;
        const userRequestedLink =
          /(לינק|קישור|link|url|דף\s+ה?טיול|דף\s+המכירה|להירשם|הרשמה|register|sign\s*up)/i.test(message ?? "");
        // Hesitation / solo-traveler / loneliness / social-trip signals.
        const soloOrHesitationSignal =
          /(לבד|לבדי|בלי\s+בן\s+זוג|בלי\s+חבר|אין\s+לי\s+עם\s+מי|מתלבט|מתלבטת|חוששת|חושש|פוחד|פוחדת|בודד|בדידות|מפחיד|לא\s+בטוח|לא\s+בטוחה|חברתי|להכיר\s+אנשים|alone|by\s+myself|hesit|nervous|social\s+trip)/i.test(
            message ?? "",
          );

        if (isOfferSpecific && hasOfferUrl && !priceQueryThisTurn) {
          const linkOnThisTurn = userRequestedLink || priorTamarOutbounds >= 1;
          if (linkOnThisTurn) {
            replyHardRules.push(
              `Include the offer page link this turn, framed naturally as the full info page (not a bare URL). Send exactly this URL once: ${offer.offer_url}. Do not invent any other URL.`,
            );
          } else {
            replyHardRules.push(
              "Opening reply on this offer track — do NOT paste offer_url yet; link comes next turn.",
            );
          }
        }

        if (isOfferSpecific && soloOrHesitationSignal) {
          replyHardRules.push(
            "Solo / hesitation signal detected. Weave in ONE short, warm reassurance that registering alone is completely fine, many do it, and the Zooga team helps match partners. Do not repeat if it already appeared in the recent thread.",
          );
        }

        // --- B4 — Handoff delivery pre-check (BEFORE composing the reply) ---
        // Tamar must never claim a present-tense live transfer ("מעבירה אותך
        // עכשיו") unless the manager-alert pipeline can actually dispatch
        // right now. We compute deliverability here and inject a hard tense
        // rule into the prompt.
        const handoffLikelyThisTurn =
          conversationMode === "handoff" ||
          USER_HUMAN_REQUEST_RE.test(message) ||
          !!recovery.suggest_handoff;
        let handoffPreCheck: {
          base_url_present: boolean;
          manager_available: boolean;
          delivery_promise: "live" | "queued";
        } = { base_url_present: false, manager_available: false, delivery_promise: "queued" };
        if (handoffLikelyThisTurn) {
          const [{ data: apiPre }, { data: managerPre }] = await Promise.all([
            supabaseAdmin
              .from("api_settings")
              .select("tamar_backend_url, tamar_backend_api_token")
              .eq("id", 1)
              .maybeSingle(),
            supabaseAdmin
              .from("managers" as any)
              .select("id")
              .eq("active", true)
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle(),
          ]);
          const { baseUrl } = resolveTamarBackendConfig(apiPre);
          handoffPreCheck = {
            base_url_present: !!baseUrl,
            manager_available: !!managerPre,
            delivery_promise: baseUrl && managerPre ? "live" : "queued",
          };
          if (handoffPreCheck.delivery_promise === "live") {
            replyHardRules.push(
              "Handoff delivery IS available this turn. You MAY use present-tense transfer wording (e.g. 'מעבירה אותך עכשיו לנציג'). Keep it ONE short sentence.",
            );
          } else {
            replyHardRules.push(
              "Handoff delivery is NOT available right now. You MUST NOT say 'מעבירה אותך עכשיו' / 'I'm transferring you now' / any present-tense live-transfer phrasing. Use FUTURE/QUEUED tense ONLY: 'אעביר את הפרטים לצוות וייצרו איתך קשר בהקדם' or equivalent. Never imply a live transfer.",
            );
          }
        }

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
          // B2 — first-class pricing state. This block reflects the
          // typed pricing columns (pricing_status / base_price_per_person /
          // single_supplement / couple_price / included / not_included /
          // nights / flights_included). When pricing_status='published'
          // Tamar is authorized to quote the structured price directly.
          const pricingBlock = buildPricingStateBlock(offer);
          if (pricingBlock) {
            lines.push(pricingBlock);
            offerFieldsInjected.push("pricing_state");
          }
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
        let effectiveOfferIntelligenceText = offerIntelligenceText;

        // --- Catalog awareness (multi-offer browse) ---
        // When the user is browsing ("יש יעדים נוספים?"), or when the resolver
        // itself flagged weak evidence for the picked offer, inject the full
        // active offer catalog so Tamar names every available trip — including
        // newly added ones — instead of speaking as if only the sticky offer
        // exists. Additive: the deep pack for the resolved offer (above) still
        // wins on offer-specific turns.
        const weakResolution =
          !offer || resolutionTrail.some((t) => t.startsWith("stale_interaction_skipped"));
        // Destination mismatch: the user's message keyword-matches an offer
        // in the active catalog that is DIFFERENT from the one we latched
        // onto via sticky priors. Even if we overrode the sticky offer
        // above, still inject the catalog so Tamar can name siblings.
        const destinationMismatch =
          destinationOverride ||
          (!!keywordMatchedOfferId && !!offer && keywordMatchedOfferId !== offer.id);
        const shouldInjectCatalog =
          browseIntentDetected || weakResolution || destinationMismatch;
        let catalogInjected = false;
        let catalogOfferIds: string[] = [];
        let hardBrowseCatalogReply: string | null = null;
        let catalogMeta: {
          total_active: number;
          listed: number;
          dropped_ingestion: number;
          dropped_event_date: number;
          ready_ids: string[];
          pending_ids: string[];
        } = { total_active: 0, listed: 0, dropped_ingestion: 0, dropped_event_date: 0, ready_ids: [], pending_ids: [] };
        if (shouldInjectCatalog) {
          let catalog = resolverActiveOffers;
          if (!catalog) {
            const { data } = await supabaseAdmin
              .from("offers")
              .select("id,title,price,currency,offer_url,ai_summary,matching_tags,target_min_age,target_max_age,ingestion_status,status,event_date,pricing_status,base_price_per_person,single_supplement")
              .eq("status", "active")
              .or(`event_date.is.null,event_date.gte.${new Date().toISOString()}`);
            catalog = (data as any[]) ?? [];
          }
          // B3 — catalog completeness. Do NOT silently drop non-ready offers
          // and do NOT exclude the sticky/current resolved offer from the
          // listing. Split into ready vs pending so Tamar can label pending
          // ones honestly ("בהכנה"). Every active row is accounted for.
          const active = (catalog ?? []) as any[];
          const ready = active.filter(
            (o: any) => !o.ingestion_status || o.ingestion_status === "ready",
          );
          const pending = active.filter(
            (o: any) => o.ingestion_status && o.ingestion_status !== "ready",
          );
          const renderOne = (o: any) => {
            const cur = (o.currency || "ILS").toUpperCase();
            const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : "₪";
            let price: string;
            if (o.pricing_status === "published" && o.base_price_per_person != null) {
              price = `${sym}${o.base_price_per_person} (${cur}) לאדם${o.single_supplement != null ? ` • תוספת ליחיד ${sym}${o.single_supplement}` : ""}`;
            } else if (o.price != null && o.price !== "") {
              price = `${sym}${o.price} (${cur})`;
            } else {
              price = "price n/a";
            }
            const tags = Array.isArray(o.matching_tags) && o.matching_tags.length
              ? ` | tags: ${o.matching_tags.join(", ")}`
              : "";
            const url = o.offer_url ? ` | link: ${o.offer_url}` : "";
            const summary = o.ai_summary ? `\n    summary: ${String(o.ai_summary).slice(0, 200)}` : "";
            return `- ${o.title} — ${price}${tags}${url}${summary}`;
          };
          const readyLines = ready.map(renderOne);
          const pendingLines = pending.map(
            (o: any) => `- ${o.title} — (פרטים בהכנה, ניתן לציין שעדיין בעיבוד)${o.offer_url ? ` | link: ${o.offer_url}` : ""}`,
          );
          if (browseIntentDetected && ready.length) {
            hardBrowseCatalogReply = buildHardBrowseCatalogReply(ready, []);
          }
          catalogMeta = {
            total_active: active.length,
            listed: readyLines.length + pendingLines.length,
            dropped_ingestion: 0,
            dropped_event_date: 0,
            ready_ids: ready.map((o: any) => o.id),
            pending_ids: pending.map((o: any) => o.id),
          };
          if (readyLines.length || pendingLines.length) {
            const header = offer
              ? `Active offers catalog (ALL active trips, including the one above — do NOT collapse to "a few options". When the user asks "what trips do you have / איזה טיולים יש", you MUST name every trip here by title):`
              : `Active offers catalog (use these — the user is browsing; name every trip by title):`;
            const pendingHeader = pendingLines.length
              ? `\nPending (ingestion not finished — mention by title only, do not invent details):\n${pendingLines.join("\n")}`
              : "";
            const catalogText = `${header}\n${readyLines.join("\n")}${pendingHeader}`;
            effectiveOfferIntelligenceText = effectiveOfferIntelligenceText
              ? `${effectiveOfferIntelligenceText}\n\n${catalogText}`
              : catalogText;
            catalogInjected = true;
            catalogOfferIds = active.map((o: any) => o.id);
            offerFieldsInjected.push("active_catalog");
            replyHardRules.push(
              `Browse-intent listing rule: list ALL ${active.length} active trips by title. Do not say "יש לנו כמה אפשרויות" or "a few options" — enumerate every title.`,
            );
          }
        }

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
            known_name: !!(
              projectedContact?.full_name ||
              projectedContact?.first_name ||
              contact?.full_name ||
              contact?.first_name
            ),
            intake_status: contact?.intake_status ?? null,
          },
          offer_event: {
            active: !!offer,
            offer_id: offer?.id ?? null,
            offer_title: offer?.title ?? null,
            campaign_id: campaign?.id ?? null,
            resolution_trail: resolutionTrail,
            browse_intent_detected: browseIntentDetected,
            catalog_injected: catalogInjected,
            catalog_offer_ids: catalogOfferIds,
            keyword_matched_offer_id: keywordMatchedOfferId,
            destination_mismatch: destinationMismatch,
            destination_override: destinationOverride,
            catalog_meta: catalogMeta,
          },
          intake_progress: {
            active: intakeSnapshot.state !== "completed",
            state: intakeSnapshot.state,
            stage: intakeSnapshot.stage,
            completion_score: intakeSnapshot.completion_score,
            completed: intakeSnapshot.completed,
            missing: intakeSnapshot.missing,
            next_target_field: effectiveNextIntakeField,
            last_asked_key: lastAskedKey,
            last_inbound_answered: lastAnswered,
            projected_capture_fields: preHighConf.map((c) => c.field),
            snapshot_pre_projection: {
              completed: intakeSnapshotPreProjection.completed,
              missing: intakeSnapshotPreProjection.missing,
              completion_score: intakeSnapshotPreProjection.completion_score,
            },
          },
          handoff_risk: {
            active: conversationMode === "handoff" || HUMAN_REQUEST_RE.test(message),
            triggered_by: conversationMode === "handoff" ? conversationModeReasons : [],
          },
          recovery: {
            active: recovery.mode !== "none",
            mode: recovery.mode,
            reasons: recovery.reasons,
            repetition_signal: recovery.repetition_signal,
            frustration_signal: recovery.frustration_signal,
            frustration_streak: recovery.frustration_streak,
            recovery_target_field: recovery.recovery_target_field,
            suppress_intake_question: recovery.suppress_intake_question,
            suggest_handoff: recovery.suggest_handoff,
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
          intakeDirective,
          intakeSnapshot,
          replyHardRules,
        });

        const systemMsg = composition.runtimePromptContext.messages.find((m: any) => m.role === "system");
        const systemContent = [
          systemMsg?.content ?? "",
          recentText ? `\n## Recent conversation\n${recentText}` : "",
          memoryText ? `\n## Known memories\n${memoryText}` : "",
        ].join("\n");

        let replyText = "";
        let runtimeError: string | null = null;
        let outboundInteractionId: string | null = null;
        try {
          if (hardBrowseCatalogReply) {
            replyText = hardBrowseCatalogReply;
          } else {
            replyText = await callModel([
              { role: "system", content: systemContent },
              { role: "user", content: message },
            ]);
          }
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
            const { data: outboundRow } = await supabaseAdmin.from("interactions").insert({
              contact_id: contactId,
              type: "whatsapp_message",
              source: "tamar_outbound",
              content: replyText,
              campaign_id: campaign?.id ?? null,
              related_offer_id: offer?.id ?? null,
            } as any).select("id").single();
            outboundInteractionId = (outboundRow as any)?.id ?? null;
          }
        }

        const promptBlocksInjected = Object.entries(promptBlocksMap).map(([k, v]: [string, any]) => ({
          key: k,
          version: v?.version ?? null,
          updated_at: v?.updated_at ?? null,
        }));

        const traceRawPayload: any = {
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
          hard_browse_catalog_reply: !!hardBrowseCatalogReply,
          offer_intelligence_effective: !!offer,
          active_context_layers: activeContextLayers,
          intake_snapshot_before: intakeSnapshot,
          intake_next_target_field: effectiveNextIntakeField,
          intake_directive: intakeDirective,
          recovery: {
            mode: recovery.mode,
            reasons: recovery.reasons,
            frustration_streak: recovery.frustration_streak,
            recovery_target_field: recovery.recovery_target_field,
            suppress_intake_question: recovery.suppress_intake_question,
            suggest_handoff: recovery.suggest_handoff,
          },
        };

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
            raw_payload: traceRawPayload,
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

        // --- Hybrid LLM decision layer ---
        // Ask the model for STRUCTURED runtime signals. Deterministic runtime
        // below decides what to actually do with them.
        const lastAssistantTurn = (() => {
          const lo = (interactions || []).find(
            (i: any) => i?.source === "tamar_outbound" || i?.type === "tamar_outbound",
          );
          return lo?.content ? String(lo.content) : null;
        })();
        const llmDecision: RuntimeDecision = await requestRuntimeDecision({
          inboundMessage: message,
          assistantReply: replyText,
          lastAssistantTurn,
          lastAskedKey,
          intakeSnapshot,
          conversationMode,
          offer: offer ? { id: offer.id, title: offer.title ?? null } : null,
        });

        const handoffDecision = decideHandoff({
          message,
          replyText,
          conversationMode,
          conversationModeReasons,
          interactions,
          llmDecision: browseIntentDetected && !USER_HUMAN_REQUEST_RE.test(message) ? null : llmDecision,
          recovery: browseIntentDetected && !USER_HUMAN_REQUEST_RE.test(message) ? null : recovery,
        });
        const handoffRequested = handoffDecision.handoff;

        // --- Intake capture + state persistence (parallel to handoff) ---
        let capturedFieldsThisTurn: string[] = [];
        const captureSources: Record<string, string[]> = {};
        let intakeCompletionAfter = intakeSnapshot.completion_score;
        let intakeStateAfter = intakeSnapshot.state;
        let intakeStageAfter = intakeSnapshot.stage;
        if (contactId) {
          try {
            // Reuse the pre-reply projected captures — same source of truth
            // as the snapshot/directive sent to the LLM. This guarantees the
            // trace, reply, and CRM writes agree on what was captured.
            const regexCaptures = preCaptures;
            // Merge regex captures with LLM-proposed captures. For duplicates
            // by field, keep the higher-confidence one and union sources.
            type MergedCapture = {
              field: string;
              value: string;
              confidence: number;
              columnUpdates: Record<string, any>;
              sources: string[];
            };
            const mergedMap = new Map<string, MergedCapture>();
            for (const c of regexCaptures) {
              mergedMap.set(c.field, {
                field: c.field,
                value: c.value,
                confidence: c.confidence,
                columnUpdates: c.columnUpdates,
                sources: ["regex"],
              });
            }
            for (const lc of llmDecision.captured_fields) {
              const existing = mergedMap.get(lc.field);
              if (existing) {
                existing.sources.push("llm");
                // small bonus when both agree
                existing.confidence = Math.min(100, Math.max(existing.confidence, lc.confidence) + 5);
              } else {
                mergedMap.set(lc.field, {
                  field: lc.field,
                  value: lc.value,
                  confidence: lc.confidence,
                  columnUpdates: fieldValueToColumnUpdates(lc.field as any, lc.value),
                  sources: ["llm"],
                });
              }
            }
            const captures = [...mergedMap.values()];
            const highConf = captures.filter((c) => c.confidence >= 75);
            const lowConf = captures.filter((c) => c.confidence < 75);

            // High-confidence: update contact columns + intake state
            const completedSet = new Set<string>(
              Array.isArray(contact?.intake_completed_fields)
                ? (contact!.intake_completed_fields as string[])
                : intakeSnapshot.completed,
            );
            const columnUpdates: Record<string, any> = {};
            for (const cap of highConf) {
              Object.assign(columnUpdates, cap.columnUpdates);
              completedSet.add(cap.field);
              capturedFieldsThisTurn.push(cap.field);
              captureSources[cap.field] = cap.sources;
              await supabaseAdmin.from("intake_field_captures" as any).insert({
                contact_id: contactId,
                field_key: cap.field,
                value_text: cap.value,
                confidence: cap.confidence,
                source: cap.sources.join("+"),
                runtime_execution_id: (trace as any)?.id ?? null,
              } as any);
            }

            // Auto-credit source_attribution silently if contact has any source signal.
            if (
              !completedSet.has("source_attribution") &&
              (contact?.source || contact?.acquisition_source || contact?.campaign_source || contact?.first_touch_campaign_id || body?.source)
            ) {
              completedSet.add("source_attribution");
            }

            const missingAfter = INTAKE_REQUIRED_FIELDS.filter((k) => !completedSet.has(k));
            const completedAfter = INTAKE_REQUIRED_FIELDS.filter((k) => completedSet.has(k));
            intakeCompletionAfter = Math.round(
              (completedAfter.length / INTAKE_REQUIRED_FIELDS.length) * 100,
            );
            intakeStateAfter = missingAfter.length === 0 ? "completed" : "active";
            // Honor LLM-proposed next_target_field if it's a valid missing field;
            // otherwise fall back to deterministic first-missing.
            const llmNext = llmDecision.next_target_field;
            const nextMissing =
              llmNext && missingAfter.includes(llmNext as any) ? (llmNext as any) : missingAfter[0];
            intakeStageAfter = nextMissing
              ? ((await import("@/lib/intake-workflow")).INTAKE_FIELD_STAGE as any)[nextMissing]
              : "completed";

            const contactPatch: Record<string, any> = {
              ...columnUpdates,
              intake_state: intakeStateAfter,
              intake_stage: intakeStageAfter,
              intake_completed_fields: completedAfter,
              intake_missing_fields: missingAfter,
              intake_required_fields: INTAKE_REQUIRED_FIELDS,
              intake_completion_score: intakeCompletionAfter,
            };
            if (highConf.length > 0) {
              contactPatch.intake_last_captured_field = highConf[highConf.length - 1].field;
              contactPatch.intake_last_captured_at = new Date().toISOString();
            }
            // Capture recovery: during recovery, PIN intake_last_question_key to
            // the asked-but-unsaved field so next turn's context-aware extractors
            // (e.g. bare-name fallback) capture the re-stated answer. Outside
            // recovery, only update the key when an intake question was actually
            // issued this turn — never silently rotate it.
            const effectiveNextAsked =
              recovery.mode !== "none"
                ? (recovery.recovery_target_field ?? lastAskedKey ?? null)
                : effectiveNextIntakeField
                ? (nextMissing ?? effectiveNextIntakeField)
                : null;
            if (effectiveNextAsked) {
              contactPatch.intake_last_question_key = effectiveNextAsked;
              contactPatch.intake_last_question_at = new Date().toISOString();
            }
            // B1 — opener / browse re-entry must CLEAR any stale pinned
            // budget question, otherwise the next turn keeps reading the old
            // intake_last_question_key=budget_sensitivity_or_range and the
            // leak resurfaces.
            if (
              suppressIntakeForOpenerOrBrowse &&
              (lastAskedKey === "budget_sensitivity_or_range" || !effectiveNextAsked)
            ) {
              contactPatch.intake_last_question_key = null;
            }
            await supabaseAdmin.from("contacts").update(contactPatch as any).eq("id", contactId);

            // Low-confidence -> pending_ai_insights for human review
            for (const cap of lowConf) {
              await supabaseAdmin.from("pending_ai_insights").insert({
                contact_id: contactId,
                insight_type: "intake_field_candidate",
                insight_key: cap.field,
                insight_value: cap.value,
                confidence_score: cap.confidence,
                status: "pending",
                source: `intake_${cap.sources.join("+")}`,
              } as any);
            }

            // Enrich trace row with post-turn intake snapshot for Runtime Trace UI
            if ((trace as any)?.id) {
              await supabaseAdmin
                .from("tamar_runtime_executions" as any)
                .update({
                  raw_payload: {
                    ...traceRawPayload,
                    intake_snapshot_before: intakeSnapshot,
                    intake_next_target_field: effectiveNextIntakeField,
                    intake_captured_this_turn: capturedFieldsThisTurn,
                    intake_capture_sources: captureSources,
                    intake_completion_score_after: intakeCompletionAfter,
                    intake_state_after: intakeStateAfter,
                    intake_stage_after: intakeStageAfter,
                    llm_decision: llmDecision,
                    handoff_decision: handoffDecision,
                    active_context_layers: {
                      ...activeContextLayers,
                      intake_progress: {
                        ...activeContextLayers.intake_progress,
                        completion_score_after: intakeCompletionAfter,
                        state_after: intakeStateAfter,
                        stage_after: intakeStageAfter,
                        captured_this_turn: capturedFieldsThisTurn,
                        llm_proposed_next: llmDecision.next_target_field,
                        prior_question_answered_llm: llmDecision.prior_question_answered,
                      },
                      offer_event: {
                        ...activeContextLayers.offer_event,
                        llm_offer_relevance: llmDecision.offer_relevance,
                      },
                      handoff_risk: {
                        ...activeContextLayers.handoff_risk,
                        llm_handoff_requested: llmDecision.handoff_requested,
                        llm_handoff_confidence: llmDecision.handoff_confidence,
                        llm_handoff_reasons: llmDecision.handoff_reasons,
                        triggers: handoffDecision.triggers,
                      },
                    },
                  },
                } as any)
                .eq("id", (trace as any).id);
            }
          } catch (e) {
            console.error("[intake-workflow] failed", e);
          }
        }

        // --- Manager handoff alert (V1) ---
        // Trigger when Tamar decided handoff mode OR the reply text contains
        // a handoff phrase. Zooga owns the decision; Railway only delivers.
        let handoffId: string | null = null;
        let managerNotified = false;
        if (handoffRequested) {
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

            const handoffReason = handoffDecision.reason;

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
                conversation_mode_reasons: [
                  ...conversationModeReasons,
                  ...handoffDecision.triggers.map((t) => `handoff_trigger:${t}`),
                ],
                status: "open",
                delivery_promise: handoffPreCheck.delivery_promise,
                delivery_attempts: 0,
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
              intake_stage: intakeStageAfter,
              intake_state: intakeStateAfter,
              intake_completion_score: intakeCompletionAfter,
              intake_missing_fields: INTAKE_REQUIRED_FIELDS.filter(
                (k) =>
                  !(Array.isArray(contact?.intake_completed_fields)
                    ? (contact!.intake_completed_fields as string[])
                    : intakeSnapshot.completed
                  ).includes(k) && !capturedFieldsThisTurn.includes(k),
              ),
              intake_captured_this_turn: capturedFieldsThisTurn,
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
                  delivery_attempts: 1,
                } as any)
                .eq("id", handoffId);
            }

            // B4 — if delivery failed (no base_url, no active manager, or
            // Railway returned non-2xx), create an ops task + flag a stronger
            // attention requirement on the contact so a human can pick it up.
            if (!managerNotified) {
              try {
                await supabaseAdmin.from("tasks").insert({
                  contact_id: contactId,
                  title: `Handoff delivery FAILED — ${customerNameForAlert}`,
                  description: `reason: ${alertError ?? "unknown"} • backend_config: ${backendConfigSource} • promise: ${handoffPreCheck.delivery_promise}\n\nLatest inbound: ${message}`,
                  status: "open",
                  priority: "high",
                  resolution_state: "pending",
                } as any);
              } catch (e) {
                console.error("[manager-handoff] task_create_failed", e);
              }
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

        // B4 — customer-facing handoff receipt. When the manager alert was
        // actually delivered, append a short confirmation so the customer
        // sees the handoff in the conversation (not only in backend state).
        if (handoffRequested && handoffId && managerNotified) {
          const receiptLine =
            "\n\nעדכון: שלחתי עכשיו התראה לנציג אנושי מהצוות שלנו, והפנייה שלך מסומנת לטיפול. יחזרו אליך כאן בוואטסאפ. 🙌";
          if (!replyText || !replyText.includes("הפנייה שלך מסומנת לטיפול")) {
            replyText = `${replyText ?? ""}${receiptLine}`.trim();
            if (outboundInteractionId) {
              try {
                await supabaseAdmin
                  .from("interactions")
                  .update({ content: replyText } as any)
                  .eq("id", outboundInteractionId);
              } catch (e) {
                console.error("[handoff-receipt] update_failed", e);
              }
            }
            if ((trace as any)?.id) {
              try {
                await supabaseAdmin
                  .from("tamar_runtime_executions" as any)
                  .update({ outbound_reply: replyText } as any)
                  .eq("id", (trace as any).id);
              } catch (e) {
                console.error("[handoff-receipt] trace_update_failed", e);
              }
            }
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
            ? {
                id: handoffId,
                manager_notified: managerNotified,
                delivery_promise: handoffPreCheck.delivery_promise,
              }
            : null,
          meta: {
            offer_id: offer?.id ?? null,
            campaign_id: campaign?.id ?? null,
            conversation_mode: conversationMode,
            conversation_mode_reasons: conversationModeReasons,
            intake: {
              state: intakeStateAfter,
              stage: intakeStageAfter,
              completion_score: intakeCompletionAfter,
              next_target_field: effectiveNextIntakeField,
              captured_this_turn: capturedFieldsThisTurn,
            },
            llm_decision: {
              prior_question_answered: llmDecision.prior_question_answered,
              captured_fields: llmDecision.captured_fields,
              handoff_requested: llmDecision.handoff_requested,
              handoff_confidence: llmDecision.handoff_confidence,
              handoff_reasons: llmDecision.handoff_reasons,
              offer_relevance: llmDecision.offer_relevance,
              next_target_field: llmDecision.next_target_field,
              error: llmDecision.error ?? null,
            },
            handoff_triggers: handoffDecision.triggers,
          },
        });
      },
    },
  },
});