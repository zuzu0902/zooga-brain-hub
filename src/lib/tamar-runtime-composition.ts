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
      "Conversation mode: GENERIC_INTAKE. Treat this as an open intake conversation.",
      "Primary goal: understand who the person is and what they want. Opportunistically collect missing person-level info (first name, language preference, what they're looking for, how they heard about us) without interrogating.",
      "Do NOT pivot to or pitch any specific offer. Even if an offer is listed in 'Offer intelligence context' as background, treat it as a soft hint only — do NOT volunteer its price, link, dates, or details.",
      "Only switch to offer-specific answering if the user explicitly raises a specific trip/offer.",
    ],
    offer_specific: [
      "Conversation mode: OFFER_SPECIFIC. The user is engaging about the resolved offer.",
      "Answer concrete questions DIRECTLY from the offer intelligence context (price in its currency, offer_url, grounded_facts, FAQ, objection notes).",
      "Do NOT default to 'a human will get back to you' when the requested fact is present in offer intelligence.",
      "Still collect missing person-level info naturally (name, preferences) when the flow allows.",
    ],
    support: [
      "Conversation mode: SUPPORT. The user reports a problem, billing issue, cancellation, or post-purchase concern.",
      "Do NOT pitch offers. Acknowledge the issue, gather the minimal facts needed (what happened, when, any order/payment reference), and prepare for human handoff.",
      "Escalate to a human if you cannot resolve from grounded context.",
    ],
    handoff: [
      "Conversation mode: HANDOFF. The user explicitly asked for a human.",
      "Confirm briefly in Hebrew that a human will follow up, do NOT attempt to resolve the underlying request yourself, and do NOT pitch offers.",
    ],
  };
  const modeRules = modeRulesByMode[conversationMode] ?? modeRulesByMode.generic_intake;

  const systemPrompt = [
    "# Tamar live runtime prompt — generated by Zooga control plane",
    "Zooga is the long-term source of truth. Use this live context instead of hardcoded/default Railway personality when present.",
    "",
    "## Conversation intent mode",
    `Current mode: ${conversationMode}`,
    conversationModeReasons.length ? `Reasons: ${conversationModeReasons.join(", ")}` : "Reasons: (none recorded)",
    "",
    "## Mode rules (override generic guidance below if in conflict)",
    modeRules.map((r) => `- ${r}`).join("\n"),
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
      "Do not expose internal inference, scores, prompt blocks, or manager-only notes to the customer.",
      "Answer concrete questions DIRECTLY from the offer intelligence context above whenever the answer exists there. Specifically: if the offer has a price, state the price. If the offer has an offer_url, send the link when the user asks for it, asks where to read more, asks to register/sign up, or expresses purchase intent. If grounded_facts / FAQ / objection notes contain the answer, answer from them.",
      "Do NOT default to 'a human representative will get back to you' when the requested fact is already present in the offer intelligence context. That phrasing is reserved for genuinely missing facts.",
      "Escalate to a human ONLY when: (a) the user explicitly asks for a human/manager, (b) the requested fact is genuinely missing from the offer intelligence and grounded facts, (c) the request is outside the offer's escalation_boundary, or (d) sensitive routing applies (distress, payment dispute, abuse, minor age signal).",
      "For active trips/offers, prefer useful concrete answers (price, dates, what's included, link) over generic soft deflection.",
      "Keep the reply aligned with the active prompt blocks and behavior settings above.",
      "Always do lightweight intake: if name, language preference, or stated interest are missing, gather them naturally without interrupting the user's topic.",
    ].join("\n- "),
  ].join("\n");

  const runtimePromptContext = {
    composition_version: "zooga-tamar-runtime-composition-v1",
    model_call_owner: "railway_tamar_runtime",
    zooga_direct_model_call: false,
    railway_prompt_consumption_confirmed_by_zooga: false,
    fallback_default_prompt_path: !input.tamarSettings && blockEntries.length === 0,
    conversation_mode: conversationMode,
    conversation_mode_reasons: conversationModeReasons,
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