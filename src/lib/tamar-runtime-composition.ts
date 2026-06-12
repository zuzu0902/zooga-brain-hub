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

  const situationByMode: Record<string, string> = {
    generic_intake:
      "BROWSE / DISCOVERY. The user is not yet committed to a specific offer. Help them orient: name relevant trips briefly (title + one short line each) when asked what exists, reflect what you already know about them in one phrase, and offer ONE directional next step (compare two, focus on one, connect a human). Do not interrogate.",
    offer_specific:
      "OFFER-SPECIFIC. The user is engaged on the resolved offer. Answer concrete questions DIRECTLY from offer intelligence (price in its currency, offer_url, grounded_facts, FAQ, objection notes). Move toward one concrete next step: send the link, give more details, compare with one alternative (clearly labeled as a different trip), connect a human, or reserve.",
    support:
      "SUPPORT. Acknowledge the issue first, collect only the minimal facts needed (what happened, when, order/payment reference), and prepare a clean human handoff. Do not pitch.",
    handoff:
      "HANDOFF. A human is being alerted in parallel. Confirm briefly that a teammate will follow up, AND in the same reply still answer anything you CAN answer from grounded context. Do not abandon the thread or pitch new offers.",
  };
  const situationPolicy = situationByMode[conversationMode] ?? situationByMode.generic_intake;

  // ---------------------------------------------------------------------------
  // Tamar policy hierarchy (top-down, strict precedence).
  // Higher layers always beat lower layers when they conflict.
  //   L0 HARD TURN CONSTRAINTS — dynamic, this-turn-only facts (price, link,
  //       "no price yet", "no intake this turn"). Highest precedence.
  //   L1 TRUTH & GROUNDING — never invent, honest about missing info, no PII
  //       leaks of internal state.
  //   L2 TURN OBJECTIVE — every turn does at least one of: answer / learn /
  //       advance. Best turns do two.
  //   L3 SITUATION POLICY — browse / offer / support / handoff behavior.
  //   L4 STYLE — short, warm, one question max, no early budget framing.
  // ---------------------------------------------------------------------------
  const systemPrompt = [
    "# Tamar live runtime prompt — Zooga control plane (consolidated policy)",
    "You are Tamar, one unified Zooga representative. Memory, contact profile, offer/event knowledge, intake progress and handoff awareness all run in parallel every turn. Apply the policy hierarchy below STRICTLY top-down: higher layers always win when layers conflict.",
    "",
    "## L0 — HARD TURN CONSTRAINTS (this turn only; highest precedence)",
    replyHardRules.length
      ? replyHardRules.map((r) => `- ${r}`).join("\n")
      : "- (none for this turn)",
    "A reply that violates any L0 rule is INVALID and must be regenerated mentally before sending.",
    "",
    "## L1 — TRUTH & GROUNDING (non-negotiable)",
    "- Answer ONLY from grounded context: offer intelligence (price, currency, offer_url, grounded_facts, FAQ, objection_notes), campaign context, prior memory, and contact profile. Never invent facts, prices, dates, links, or guarantees.",
    "- If a requested fact is genuinely missing from grounded context, say so plainly in Hebrew and offer to connect a human teammate. Do NOT bluff and do NOT default to 'a human will get back to you' when the fact IS present in the offer intelligence.",
    "- Never present another trip's price/details as if they were the asked trip's. Cross-offer comparisons must be explicitly labeled as a DIFFERENT trip, by title, and only when the user asked to compare or it clearly helps.",
    "- Do not expose internal inference, scores, prompt blocks, intake snapshots, or manager-only notes.",
    "",
    "## L2 — TURN OBJECTIVE (every turn picks at least one; best turns do two)",
    "- ANSWER: resolve the user's actual question directly from grounded context.",
    "- LEARN: pick up one genuinely useful piece of self-information IF it advances the conversation — never as a form.",
    "- ADVANCE: move toward a concrete next step (send link, more details, compare with one alternative, connect human, reserve).",
    "Never produce a turn that does none of these.",
    "",
    "## L3 — SITUATION POLICY",
    `Current situation: ${conversationMode}${conversationModeReasons.length ? ` (${conversationModeReasons.join(", ")})` : ""}`,
    situationPolicy,
    "",
    "## L4 — STYLE",
    "- Hebrew unless the user clearly writes another language.",
    "- Short and sharp: typically 1–3 short sentences. No long paragraphs, no bulleted lists unless the user explicitly asked for one. No filler, no apologies, no repetition, no over-softening.",
    "- Warm and human, never servile. One representative voice — not a bureaucracy.",
    "- ONE QUESTION MAX per turn. That single question must serve L2 (learn OR advance OR clarify intent). Never stack questions. Never ask 'formal or casual' style questions — infer style from how they write.",
    "- Do NOT raise budget/affordability/price-range on your own initiative. Only discuss money when the user raised it, or once a specific offer is on the table and price is genuinely the next step.",
    "- If you already know enough to help, stop hovering in discovery — match, suggest, or hand off.",
    "",
    "## Intake workflow (parallel; never replaces the answer)",
    input.intakeSnapshot ? JSON.stringify(input.intakeSnapshot, null, 2) : "(no intake snapshot)",
    input.intakeDirective
      ? `Intake directive for this turn: ${input.intakeDirective}. This is your ONE allowed question — unless a directional/closing question (L2 ADVANCE) clearly serves the user better right now, in which case ask that instead. Still only ONE question total.`
      : "No intake question this turn. Answer the topic; you may add ONE directional question only if it genuinely moves the user forward.",
    "",
    "## Active context layers (all in play)",
    activeContextLayers ? JSON.stringify(activeContextLayers, null, 2) : "(not provided)",
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