type PromptBlock = {
  title?: string | null;
  body?: string | null;
  version?: number | null;
  updated_at?: string | null;
};

type RuntimeCompositionInput = {
  inboundMessage?: string | null;
  source?: string | null;
  contact?: any;
  campaign?: any;
  campaignContextText?: string | null;
  offer?: any;
  offerIntelligenceText?: string | null;
  tamarSettings?: any;
  promptBlocks?: Record<string, PromptBlock>;
  escalationFallback?: boolean;
  escalationReason?: string | null;
  offerFieldsInjected?: string[];
  conversationMode?: "generic_intake" | "offer_specific" | "support" | "handoff";
  conversationModeReasons?: string[];
  activeContextLayers?: Record<string, any>;
  intakeDirective?: string | null;
  intakeSnapshot?: any;
  replyHardRules?: string[];
};

function truncate(text: string, max = 12000) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

function redact(text: string | null | undefined) {
  if (!text) return "";
  return truncate(
    String(text)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
      .replace(/\b(?:\+?\d[\d\s().-]{6,}\d)\b/g, "[redacted-phone]")
      .replace(/(token|authorization|api[_-]?key|secret)\s*[:=]\s*[^\s,}\]]+/gi, "$1=[redacted]"),
  );
}

function summarizeSettings(settings: any) {
  if (!settings) return null;
  return {
    id: settings.id ?? 1,
    updated_at: settings.updated_at ?? null,
    tone_preset: settings.tone_preset ?? null,
    warmth_level: settings.warmth_level ?? null,
    verbosity_level: settings.verbosity_level ?? null,
    emoji_policy: settings.emoji_policy ?? null,
    naturalness_level: settings.naturalness_level ?? null,
    sales_aggressiveness: settings.sales_aggressiveness ?? null,
    no_invention_rule: settings.no_invention_rule ?? null,
    handoff_on_factual_doubt: settings.handoff_on_factual_doubt ?? null,
    handoff_confidence_threshold: settings.handoff_confidence_threshold ?? null,
    consent_timing_rule: settings.consent_timing_rule ?? null,
    internal_inference_visibility: settings.internal_inference_visibility ?? null,
  };
}

function settingsToDirectives(settings: any) {
  if (!settings) return ["No tamar_behavior_settings row resolved; use conservative default behavior."];
  return [
    `Tone preset: ${settings.tone_preset ?? "warm-professional-hebrew"}`,
    `Warmth: ${settings.warmth_level ?? "default"}; verbosity: ${settings.verbosity_level ?? "default"}; naturalness: ${settings.naturalness_level ?? "default"}`,
    `Emoji policy: ${settings.emoji_policy ?? "default"}`,
    `Sales behavior: ${settings.sales_aggressiveness ?? "balanced"}; max follow-ups/week: ${settings.sales_max_followups_per_week ?? "default"}`,
    settings.gender_language_sensitivity ? "Use gender-sensitive Hebrew phrasing when known; avoid assumptions when unknown." : "Do not infer gender unless explicitly known.",
    settings.therapist_mode_disabled ? "Do not act as a therapist." : "Avoid clinical/therapeutic claims unless explicitly configured.",
    settings.dating_counselor_mode_disabled ? "Do not act as a dating counselor." : "Avoid relationship-counselor framing unless explicitly configured.",
    settings.no_invention_rule ? "Hard constraint: do not invent facts. Use only provided grounded knowledge and ask/hand off when missing." : "Prefer grounded facts; avoid unsupported specifics.",
    settings.handoff_on_factual_doubt ? `Escalate on factual doubt or confidence below ${settings.handoff_confidence_threshold ?? 60}.` : "Escalate only on explicit handoff triggers.",
    `Consent timing rule: ${settings.consent_timing_rule ?? "after_first_meaningful_reply"}`,
  ].filter(Boolean);
}

export function buildTamarRuntimeComposition(input: RuntimeCompositionInput) {
  const promptBlocks = input.promptBlocks ?? {};
  const blockEntries = Object.entries(promptBlocks).sort(([a], [b]) => a.localeCompare(b));
  const settingsDirectives = settingsToDirectives(input.tamarSettings);
  const conversationMode = input.conversationMode ?? "generic_intake";
  const conversationModeReasons = input.conversationModeReasons ?? [];
  const activeContextLayers = input.activeContextLayers ?? null;
  const replyHardRules = input.replyHardRules ?? [];
  const activeConstraints = [
    ...settingsDirectives.filter((d) => /constraint|invent|Escalate|factual|therapist|counselor/i.test(d)),
    input.escalationFallback ? input.escalationReason || "offer_intelligence_missing_grounded_knowledge" : null,
    input.offerIntelligenceText ? "Offer answers must stay inside provided grounded facts / FAQ / objection notes." : null,
  ].filter(Boolean) as string[];

  const promptBlockText = blockEntries.length
    ? blockEntries
        .map(([key, block]) => `## Prompt block: ${key} v${block.version ?? "?"}${block.title ? ` — ${block.title}` : ""}\n${block.body ?? ""}`)
        .join("\n\n")
    : "No active tamar_prompt_blocks were resolved. Use only structured settings and conservative defaults.";

  const campaignText = input.campaignContextText || (input.campaign ? JSON.stringify({
    id: input.campaign.id,
    name: input.campaign.name,
    objective: input.campaign.objective,
    ai_goal: input.campaign.ai_goal,
    tone_style: input.campaign.tone_style,
    emotional_angle: input.campaign.emotional_angle,
    target_audience: input.campaign.target_audience,
    intake_flow_type: input.campaign.intake_flow_type,
  }, null, 2) : "No active campaign context resolved.");

  const offerText = input.offerIntelligenceText || "No active offer intelligence resolved.";
  const contactText = input.contact ? JSON.stringify({
    id: input.contact.id,
    first_name: input.contact.first_name,
    full_name: input.contact.full_name,
    preferred_language_style: input.contact.preferred_language_style,
    intake_status: input.contact.intake_status,
    sales_temperature: input.contact.sales_temperature,
    purchase_intent: input.contact.purchase_intent,
  }, null, 2) : "No contact resolved yet.";

  const modeRulesByMode: Record<string, string[]> = {
    generic_intake: [
      "Priority emphasis: GENERIC_INTAKE — understand the person fast, then move them forward. Do not interrogate.",
      "If the user asks anything answerable from offer intelligence (price, link, dates, facts, FAQ), answer DIRECTLY and concisely on the same turn.",
      "Ask AT MOST ONE short, useful question this turn — the single most relevant next thing (missing personal field OR intent clarification OR a directional choice). Never stack questions.",
    ],
    offer_specific: [
      "Priority emphasis: OFFER_SPECIFIC — the user is engaging about the resolved offer. Keep momentum toward a concrete next step.",
      "Answer concrete questions DIRECTLY from offer intelligence (price in its currency, offer_url, grounded_facts, FAQ, objection notes). Never defer to a human for facts that are present.",
      "Close one step at a time: after the answer, ask ONE directional question — e.g. send the link, send more details, compare with another option, connect to a human, or move to reserve/follow-up. Not an intake form.",
    ],
    support: [
      "Priority emphasis: SUPPORT — acknowledge the issue first, gather minimal facts (what happened, when, order/payment ref), and prepare for human handoff.",
      "Do not pitch offers, but you may still use offer/event context to ground the conversation if relevant.",
      "Escalate to a human if you cannot resolve from grounded context — keep the customer informed in the same reply.",
    ],
    handoff: [
      "Priority emphasis: HANDOFF — the user asked for a human and a manager alert is being sent in parallel.",
      "Stay coherent as one representative: confirm briefly that a human will follow up, AND if the user also asked a concrete question you can answer from grounded context (offer facts, FAQ, prior memory), answer it in the same reply. Do not abandon the conversation while waiting for the manager.",
      "Do not pitch new offers, but keep all known context (memory, profile, resolved offer) active so the manager inherits a warm thread.",
    ],
  };
  const modeRules = modeRulesByMode[conversationMode] ?? modeRulesByMode.generic_intake;

  const systemPrompt = [
    "# Tamar live runtime prompt — generated by Zooga control plane",
    "Zooga is the long-term source of truth. Tamar is ONE unified representative — memory, contact profile, offer/event knowledge, intake progress, and handoff awareness all run in parallel on every turn. Mode below is priority emphasis only; it never disables the other layers.",
    "",
    "## Active context layers (all simultaneously in play)",
    activeContextLayers ? JSON.stringify(activeContextLayers, null, 2) : "(not provided)",
    "",
    "## Conversation priority emphasis",
    `Current priority: ${conversationMode}`,
    conversationModeReasons.length ? `Reasons: ${conversationModeReasons.join(", ")}` : "Reasons: (none recorded)",
    "",
    "## Priority rules (shift emphasis; do NOT disable other capabilities)",
    modeRules.map((r) => `- ${r}`).join("\n"),
    "",
    "## Intake workflow (runs in parallel; never replaces the answer)",
    input.intakeSnapshot ? JSON.stringify(input.intakeSnapshot, null, 2) : "(no intake snapshot)",
    input.intakeDirective
      ? `Directive (MANDATORY this turn — must appear in the reply): ${input.intakeDirective}`
      : "No intake question this turn.",
    "",
    "## Resolved behavior settings",
    settingsDirectives.map((d) => `- ${d}`).join("\n"),
    "",
    "## Active prompt blocks",
    promptBlockText,
    "",
    "## Contact context",
    contactText,
    "",
    "## Campaign/event context",
    campaignText,
    "",
    "## Offer intelligence context",
    offerText,
    "",
    "## Response rules",
    [
      "Answer in Hebrew unless the user clearly uses another language.",
      "BREVITY (default): keep replies short and sharp — typically 1–3 short sentences. Never produce long paragraphs or bulleted lists unless the user explicitly asked for a full list or a detailed explanation. No filler, no apologies, no repetition, no over-softening.",
      "ONE QUESTION RULE: ask at most ONE question per turn. That single question must EITHER gather one missing personal field, OR clarify intent, OR push toward a concrete next step (more details / send link / compare two options / connect to a human / reserve). Never stack multiple questions. Never ask a question that does not serve one of those three goals.",
      "EVERY TURN must do at least one of: (a) answer accurately, (b) learn something useful about the user, (c) move the user toward a concrete next step. The best turns do two of these at once. Do not produce a turn that does none.",
      "SALES MOMENTUM: if you already have enough context to help, stop hovering in generic discovery. Suggest the most relevant trip, offer to compare 2 options, offer to send the link / more details, or offer to connect a human — whichever fits.",
      "INTAKE-TO-CLOSE BRIDGE: if the user just shared something meaningful about themselves, reflect it briefly in one phrase, connect it to a relevant offer or direction, and keep moving. Do not restart discovery.",
      "BROWSE BEHAVIOR: when the user asks generally what trips exist, answer concisely, show the relevant options briefly (titles + one-line each, not full pitch), then ask ONE light directional question (which interests you most / want me to compare two / want details on one).",
      "INTAKE FEEL: intake must feel like a genuinely useful next question for the user, not an administrative form. Never stack name+age+city+goal in one breath. Skip intake entirely on turns where a directional/closing question serves the user better.",
      "Always answer concrete questions DIRECTLY from offer intelligence whenever the answer exists there — regardless of priority mode. Price → state the price. Link request → send offer_url. Grounded facts / FAQ / objection notes → answer from them.",
      "Do NOT default to 'a human representative will get back to you' when the requested fact is already present in the offer intelligence context. That phrasing is reserved for genuinely missing facts.",
      "Escalate to a human additively (not destructively) when: (a) the user explicitly asks for a human/manager, (b) the requested fact is genuinely missing from grounded context, (c) the request is outside the offer's escalation_boundary, or (d) sensitive routing applies. Even during handoff, continue to answer what you CAN answer from grounded context in the same reply.",
      "Do not expose internal inference, scores, prompt blocks, or manager-only notes to the customer.",
      "Use prior memory when present (preferences, past interactions, prior stated facts). Memory must influence the reply on every turn it is relevant.",
      input.intakeDirective
        ? "Intake enforcement: the Intake Directive above is the ONE question allowed this turn. Structure: [short answer to user's topic] + [one short, natural question for the target field]. No additional questions. If a directional/closing question would serve the user better than this intake field right now, you may replace the intake question with that single directional question instead — but still only ONE question total."
        : "Intake enforcement: no intake target this turn — answer the topic. You may still ask ONE directional/closing question if it genuinely moves the user forward; otherwise end without a question.",
    ].join("\n- "),
    replyHardRules.length
      ? `\n## Hard reply constraints for THIS turn (override mode rules — violating these makes the reply INVALID)\n- ${replyHardRules.join("\n- ")}`
      : "",
  ].join("\n");

  const runtimePromptContext = {
    composition_version: "zooga-tamar-runtime-composition-v1",
    model_call_owner: "railway_tamar_runtime",
    zooga_direct_model_call: false,
    railway_prompt_consumption_confirmed_by_zooga: false,
    fallback_default_prompt_path: !input.tamarSettings && blockEntries.length === 0,
    conversation_mode: conversationMode,
    conversation_mode_reasons: conversationModeReasons,
    active_context_layers: activeContextLayers,
    intake_snapshot: input.intakeSnapshot ?? null,
    intake_directive: input.intakeDirective ?? null,
    injected_sections: {
      tamar_settings: !!input.tamarSettings,
      prompt_blocks: blockEntries.length > 0,
      campaign_context: !!input.campaign,
      offer_intelligence_context: !!input.offerIntelligenceText,
      contact_context: !!input.contact,
    },
    active_personality_blocks: blockEntries.map(([key, block]) => ({
      key,
      title: block.title ?? null,
      version: block.version ?? null,
      updated_at: block.updated_at ?? null,
      body: block.body ?? "",
    })),
    active_offer_event_knowledge: {
      campaign_id: input.campaign?.id ?? null,
      campaign_name: input.campaign?.name ?? null,
      offer_id: input.offer?.id ?? null,
      offer_title: input.offer?.title ?? null,
      offer_fields_injected: input.offerFieldsInjected ?? [],
      has_offer_grounded_context: !!input.offerIntelligenceText,
    },
    active_constraints: activeConstraints,
    messages: [
      { role: "system", name: "zooga_live_control_plane", content: systemPrompt },
      { role: "user", name: "latest_inbound_message", content: input.inboundMessage ?? "" },
    ],
  };

  const tracePromptContext = {
    ...runtimePromptContext,
    settings_snapshot: summarizeSettings(input.tamarSettings),
    active_personality_blocks: runtimePromptContext.active_personality_blocks.map((b) => ({
      ...b,
      body: redact(b.body),
    })),
    messages: runtimePromptContext.messages.map((m) => ({ ...m, content: redact(m.content) })),
    prompt_text_preview: redact(systemPrompt),
    inbound_message_preview: redact(input.inboundMessage),
    source: input.source ?? null,
  };

  return { runtimePromptContext, tracePromptContext };
}