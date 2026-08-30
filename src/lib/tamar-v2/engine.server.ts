/**
 * TAMAR BRAIN V2 — orchestrator.
 *
 * Pipeline (strict order):
 *   resolve contact -> derive state -> deterministic pre-checks
 *   -> AI interpretation (structured only) -> optional grounded wording
 *   -> decideTurn (pure, authoritative) -> persist -> send.
 *
 * The AI never writes state, never picks an offer, never decides handoff.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureHandoff } from "@/lib/tamar-handoff-core.server";
import { retrieveKnowledge } from "@/lib/tamar-brain/knowledge.server";
import {
  phoneVariants,
  recordDelivery,
  sendWhatsAppButtons,
  sendWhatsAppList,
  sendWhatsAppText,
  sendWhatsAppTemplate,
  isSessionWindowOpen,
  toE164,
  type SendResult,
} from "@/lib/whatsapp-meta.server";
import { questionSignature } from "@/lib/conversation-guard/core";
import { buildRecommendationText, decideTurn, nextStep, type TurnInput } from "./engine-core";
import { knownFieldsFromContact, loadAgentVersion, loadSellableOffers } from "./flow.server";
import { interpret } from "./interpreter.server";
import { interpretDeterministic } from "./interpret-rules";
import { deriveState, marketingAllowed } from "./state-machine";
import { isUserQuestion, isExplicitOptOut } from "./classify";
import { wantsHuman } from "./classify";
import { ORCHESTRATOR_VERSION, selectResponseAction } from "./response-orchestrator";
import { guardResponse, buildDeterministicOfferAnswer } from "./response-guard";
import {
  SAFE_CLARIFY_TEXT,
  SAFE_ERROR_TEXT,
  detectControlPath,
  finalBodyGuard,
  hasDanglingAnaphora,
  type ControlPath,
} from "./control-path";

import {
  HONEST_UNKNOWN,
  PAST_OFFER_NOTE,
  acceptedHandoffOffer,
  buildCustomerSelfSummary,
  buildOfferGroundingBlock,
  isPendingHandoffFresh,
  isProductQuestion,
  isSelfSummaryRequest,
  isUnsupportedDetailQuestion,
  mayOfferHandoff,
  offerAvailability,
  resolveOffer,
  shouldSendOfferLink,
  soloPolicyReply,
  type OfferKnowledge,
  type PendingProductHandoff,
} from "./offer-knowledge";
import {
  commitOfferLinkSent,
  lastGroundedOfferIdFrom,
  lastOfferIdFrom,
  loadOfferKnowledgeCandidates,
  pendingProductHandoffFrom,
  sentOfferIdsFrom,
  withOfferLedger,
  withPendingHandoff,
} from "./offer-knowledge.server";
import type { AgentVersion, Interpretation, OutboundMessage, TurnDecision } from "./types";
import { isConversationResetRequest, applyResetToDynamic } from "./reset";
import { readFocus, nextFocus, withFocus, type ActiveFocus } from "./focus";
import { normalizeVoiceTranscript, voiceClarificationText, type VoiceNormalization } from "./voice-normalize";
import { resolveCurrentMessage, currentProductAsk } from "./current-message";

import { detectSensitiveTopic, hasGroundedSensitiveData, sensitiveVerificationText } from "./sensitive";
import { writeGroundedAnswer } from "./writer.server";

/** Contact columns we may write intake values into directly. */
const CONTACT_COLUMNS = new Set([
  "first_name",
  "last_name",
  "relationship_status",
  "region",
  "city",
  "budget_sensitivity",
  "preferred_trip_style",
  "preferred_social_style",
]);

export type V2TurnInput = {
  phone?: string | null;
  contact_id?: string | null;
  message: string;
  option_id?: string | null;
  name?: string | null;
  inbound_message_id?: string | null;
  source?: string;
  /** dry run: no WhatsApp, no contact writes */
  simulate?: boolean;
  /** offline: skip model calls entirely (deterministic interpreter) */
  offline?: boolean;
};

export type V2TurnResult = {
  status: number;
  contact_id: string | null;
  decision: TurnDecision;
  interpretation: Interpretation;
  agent_version: number;
  sends: Array<{ kind: string; ok: boolean; http: number; error: string | null }>;
  /** Explicit, documented reason when no outbound was produced. */
  no_reply_reason: string | null;
  latency_ms: number;
};

async function findContact(input: V2TurnInput) {
  if (input.contact_id) {
    const { data } = await supabaseAdmin.from("contacts").select("*").eq("id", input.contact_id).maybeSingle();
    if (data) return data as any;
  }
  const variants = phoneVariants(input.phone);
  for (const v of variants) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .or(`phone.eq.${v},whatsapp_number.eq.${v}`)
      .limit(1)
      .maybeSingle();
    if (data) return data as any;
  }
  return null;
}

async function createContact(input: V2TurnInput) {
  const e164 = toE164(input.phone);
  if (!e164) {
    const { ContactCreateError } = await import("@/lib/contact-create-error");
    throw new ContactCreateError({ code: "invalid_phone", phone: input.phone, retryable: false });
  }
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert({
      // contacts.full_name is GENERATED ALWAYS — never write it.
      phone: e164,
      whatsapp_number: e164,
      first_name: input.name ?? null,
      source: "Tamar WhatsApp",
      status: "new_lead",
      conversation_state: "consent_pending",
    } as any)
    .select("*")
    .maybeSingle();
  if (error || !(data as any)?.id) {
    const { ContactCreateError } = await import("@/lib/contact-create-error");
    throw new ContactCreateError({
      code: "contact_create_failed",
      message: error?.message ?? "insert returned no row",
      phone: e164,
    });
  }
  // Re-point the zero-loss identity registry at the (possibly new) contact.
  try {
    const { registerIdentity } = await import("@/lib/zero-loss/identity.server");
    await registerIdentity(e164, (data as any).id, "tamar_v2");
  } catch { /* registry linking must never break the turn */ }
  return data as any;
}

/** Consent button ids are a fixed contract, independent of the flow table. */
const CONSENT_OPTION_VALUES: Record<string, string> = {
  consent_yes: "yes",
  consent_no: "no",
  consent_explain: "explain",
};

export function optionValueFor(agent: AgentVersion, stepKey: string | null, optionId: string | null): string | null {
  if (!optionId) return null;
  if (CONSENT_OPTION_VALUES[optionId]) return CONSENT_OPTION_VALUES[optionId]!;
  const step =
    agent.steps.find((s) => s.step_key === stepKey && s.options.some((o) => o.option_id === optionId)) ??
    agent.steps.find((s) => s.options.some((o) => o.option_id === optionId));
  const opt = step?.options.find((o) => o.option_id === optionId);
  return opt?.value ?? null;
}

function messageText(m: OutboundMessage): string {
  return m.body;
}

/**
 * Dispatch one outbound message.
 *
 * Inside the 24h customer-service window an interactive message is sent as
 * interactive — never downgraded to plain text. Outside the window only an
 * approved template may be used; with no template configured we FAIL CLOSED
 * and report the reason instead of pretending something was delivered.
 */
async function sendMessage(
  to: string,
  m: OutboundMessage,
  ctx: { windowOpen: boolean; template: string | null },
): Promise<SendResult> {
  if (m.kind === "text") {
    if (ctx.windowOpen) return sendWhatsAppText(to, m.body);
    if (ctx.template) return sendWhatsAppTemplate(to, ctx.template);
    return { ok: false, provider_message_id: null, status: 0, error: "outside_24h_window_no_approved_template" };
  }
  if (!ctx.windowOpen) {
    if (!ctx.template) {
      return { ok: false, provider_message_id: null, status: 0, error: "outside_24h_window_no_approved_template" };
    }
    return sendWhatsAppTemplate(to, ctx.template);
  }
  const options = m.options.map((o) => ({ id: o.id, label: o.label }));
  if (m.kind === "buttons" && options.length <= 3) return sendWhatsAppButtons(to, m.body, options);
  return sendWhatsAppList(to, m.body, options, { header: m.header ?? null });
}

/** Approved WhatsApp template used to re-open a closed session, if any. */
async function activeSessionTemplate(): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("tamar_copy_versions" as any)
      .select("template_name")
      .eq("copy_key", "consent_opener")
      .eq("is_active", true)
      .not("template_name", "is", null)
      .limit(1)
      .maybeSingle();
    return (data as any)?.template_name ?? null;
  } catch {
    return null;
  }
}

/**
 * The consent phase (opener + yes/no) is ALWAYS owned by the v2 engine, even
 * while v2 is disabled for the rest of the conversation, so every new thread
 * opens with the exact approved opener and stable buttons.
 */
export async function isConsentPhase(input: { phone?: string | null; contact_id?: string | null }): Promise<boolean> {
  const contact = await findContact(input as V2TurnInput);
  const state = deriveState(contact);
  return state === "new_inbound" || state === "consent_asked";
}

/** Run one WhatsApp turn through the v2 engine. */
/**
 * Rolling context for the decision layer: the last N transcript lines.
 * Without it the engine cannot see that it already asked something.
 */
async function loadRecentTranscript(contactId: string, limit = 12): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("interactions")
    .select("source, content, timestamp")
    .eq("contact_id", contactId)
    .order("timestamp", { ascending: false })
    .limit(limit);
  return ((data as any[]) ?? [])
    .reverse()
    .map((r) => `${String(r.source ?? "").includes("outbound") ? "תמר" : "לקוח"}: ${String(r.content ?? "").slice(0, 300)}`);
}

/**
 * Everything the customer explicitly told us, with verified provenance:
 * current, non-superseded EXPLICIT profile facts and current, non-skipped
 * questionnaire answers with friendly labels.
 */
async function loadCustomerSuppliedProfile(contactId: string) {
  const { RELATIONSHIP_LABELS } = await import("./self-summary-labels");
  const facts: Array<{ field_key: string; value: string | null; kind: string | null; is_current: boolean; superseded_by: string | null }> = [];
  try {
    const { data } = await supabaseAdmin
      .from("contact_profile_facts")
      .select("field_key, value_text, explicit_or_inferred, is_current, superseded_by")
      .eq("contact_id", contactId)
      .eq("is_current", true)
      .eq("explicit_or_inferred", "explicit")
      .is("superseded_by", null)
      .limit(30);
    for (const r of ((data as any[]) ?? [])) {
      facts.push({
        field_key: r.field_key,
        value: r.value_text ?? null,
        kind: r.explicit_or_inferred ?? null,
        is_current: r.is_current !== false,
        superseded_by: r.superseded_by ?? null,
      });
    }
  } catch { /* provenance missing => echo nothing */ }

  const answers: Array<{ question_key: string; label: string | null; raw_text: string | null; is_current: boolean; skipped_by_user: boolean }> = [];
  try {
    const { data } = await supabaseAdmin
      .from("relationship_intake_answers")
      .select("question_key, raw_text, is_current, skipped_by_user")
      .eq("contact_id", contactId)
      .eq("is_current", true)
      .eq("skipped_by_user", false)
      .limit(12);
    for (const r of ((data as any[]) ?? [])) {
      answers.push({
        question_key: r.question_key,
        label: RELATIONSHIP_LABELS[r.question_key] ?? null,
        raw_text: r.raw_text ?? null,
        is_current: r.is_current !== false,
        skipped_by_user: !!r.skipped_by_user,
      });
    }
  } catch { /* ignore */ }

  return { facts, answers };
}

/**
 * Grounding paths that CLOSE the turn: nothing may be appended after them —
 * no recommendation, no intake question, no second envelope.
 */
const TERMINAL_GROUNDING_PATHS = new Set([
  "offer_clarification",
  "sensitive_verification_required",
  "voice_clarification",
]);

/**
 * The mandatory context transaction failed. The turn produces NO outbound —
 * Tamar never answers context-blind — and reports an explicit operational
 * reason. Nothing durable is written for this inbound id, so a redelivery
 * can be processed normally once the storage problem is fixed.
 */
function failClosed(args: { contact: any; state: any; started: number; reason: string }): V2TurnResult {
  return {
    status: 503,
    contact_id: args.contact?.id ?? null,
    decision: {
      from_state: args.state,
      next_state: args.state,
      messages: [],
      actions: [],
      ask_step_key: null,
      captured: {},
      offer_ids: [],
      marketing_allowed: false,
      confidence_gate: "blocked",
      ambiguity_turns: 0,
      reason_codes: [args.reason],
      silent: true,
    },
    interpretation: interpretDeterministic(""),
    agent_version: 0,
    sends: [],
    no_reply_reason: args.reason,
    latency_ms: Date.now() - args.started,
  };
}

export async function runV2Turn(input: V2TurnInput): Promise<V2TurnResult> {
  const started = Date.now();
  const rawMessage = String(input.message ?? "").trim();
  const agent = await loadAgentVersion();

  let contact = input.simulate ? null : await findContact(input);
  if (!contact && !input.simulate) contact = await createContact(input);
  if (contact && !input.simulate) {
    const { healStaleHumanOwnership } = await import("@/lib/tamar-handoff-core.server");
    contact = await healStaleHumanOwnership(contact as any);
  }

  const dyn = (contact?.dynamic_profile_fields ?? {}) as Record<string, any>;
  const pendingStepKey: string | null = dyn?.["v2_pending_step"] ?? null;
  const ambiguityTurns: number = Number(dyn?.["v2_ambiguity_turns"] ?? 0);
  const answeredCount: number = Number(dyn?.["v2_answered_count"] ?? 0);

  const state = deriveState(contact);
  const knownFields = knownFieldsFromContact(contact ?? {}, agent.steps);
  const offers = await loadSellableOffers();

  // ---- Authoritative active focus (never moved by ranking) ---------------
  const currentFocus = readFocus(dyn);

  // ---- Voice: raw transcript preserved, normalized copy audited ----------
  let message = rawMessage;
  let voiceNorm: VoiceNormalization | null = null;
  if (String(input.source ?? "").includes("voice")) {
    voiceNorm = normalizeVoiceTranscript({
      raw: rawMessage,
      focusTitle: currentFocus.topic,
      catalogTitles: (offers as any[]).map((o) => String(o.title ?? "")),
    });
    if (voiceNorm.changed) message = voiceNorm.normalized;
    if (!input.simulate && contact?.id && (voiceNorm.changed || voiceNorm.ambiguous)) {
      const { recordVoiceNormalization } = await import("./voice-normalize.server");
      await recordVoiceNormalization({
        contactId: contact.id,
        waMessageId: input.inbound_message_id ?? null,
        normalization: voiceNorm,
      }).catch(() => null);
    }
  }

  // ---- LAST-INBOUND AUTHORITY -------------------------------------------
  // The current text / transcript is the ONLY intent source for this turn.
  const currentMessage = resolveCurrentMessage({
    rawText: rawMessage,
    normalizedText: voiceNorm?.changed ? message : null,
    source: input.source ?? null,
    inboundMessageId: input.inbound_message_id ?? null,
  });
  message = currentMessage.text;
  const currentAsk = currentProductAsk(message);

  // Deterministic, pre-model: "נתחיל מחדש" costs no model call at all.
  const resetRequested = isConversationResetRequest(message);


  // ---- Canonical bounded context package (one per turn) ------------------
  // MANDATORY TRANSACTION: no durable snapshot => no outbound. A
  // context-blind answer is exactly the production failure we are repairing.
  const { buildTurnContext, saveContextSnapshot, recordContextFailure } = await import("./context.server");
  const { transcriptLines, turnComplexity } = await import("./context");
  const intakeMissing = agent.steps
    .map((s) => s.step_key)
    .filter((k) => k && !(k in (knownFields ?? {})))
    .slice(0, 12);
  const built = await buildTurnContext({
    contact,
    state,
    focus: currentFocus,
    intakeAnswered: (knownFields ?? {}) as Record<string, string>,
    intakeMissing,
    // The EXACT inbound this decision is about — raw transcript preserved,
    // normalized copy and its audit kept distinct.
    inbound: {
      messageId: input.inbound_message_id ?? null,
      source: input.source ?? "whatsapp",
      rawText: rawMessage,
      normalizedText: voiceNorm?.changed ? message : null,
      normalization: voiceNorm
        ? {
            changed: voiceNorm.changed,
            ambiguous: voiceNorm.ambiguous,
            reason: voiceNorm.reason,
            confidence: voiceNorm.confidence,
          }
        : null,
    },
  }).catch(() => null);

  let contextSnapshotId: string | null = null;
  if (!input.simulate && contact?.id) {
    if (!built) {
      await recordContextFailure({
        contactId: contact.id,
        inboundMessageId: input.inbound_message_id ?? null,
        stage: "build",
        error: "context_build_failed",
      });
      return failClosed({ contact, state, started, reason: "context_build_failed" });
    }
    const saved = await saveContextSnapshot({
      contactId: contact.id,
      inboundMessageId: input.inbound_message_id ?? null,
      built,
    });
    if (!saved.id) {
      await recordContextFailure({
        contactId: contact.id,
        inboundMessageId: input.inbound_message_id ?? null,
        stage: "persist",
        error: saved.error,
      });
      return failClosed({ contact, state, started, reason: "context_persist_failed" });
    }
    contextSnapshotId = saved.id;
  }

  const ctxPackage = built?.context ?? null;
  const history = ctxPackage ? transcriptLines(ctxPackage, 12) : contact?.id ? await loadRecentTranscript(contact.id, 12) : [];

  // Complexity is decided BEFORE the first model call so routing is real:
  // a normal turn never pays for the strong model.
  const preComplexity: "simple" | "complex" = ctxPackage
    ? turnComplexity({ message, ctx: ctxPackage, wantsHuman: wantsHuman(message) })
    : wantsHuman(message)
      ? "complex"
      : "simple";

  const interpretation: Interpretation = input.offline || resetRequested
    ? interpretDeterministic(message)
    : await interpret(message, {
        state,
        pendingQuestion: pendingStepKey,
        known: knownFields,
        history,
        summary: ctxPackage?.summary ?? (contact?.dynamic_profile_fields as any)?.["v2_summary"] ?? null,
        complexity: preComplexity,
      });

  // After interpretation, low confidence / human intent may escalate the
  // wording stage even though interpretation itself ran cheap.
  const complexity: "simple" | "complex" = ctxPackage
    ? turnComplexity({ message, ctx: ctxPackage, wantsHuman: interpretation.wants_human, confidence: interpretation.confidence })
    : preComplexity;




  // ---- Product grounding -------------------------------------------------
  // Resolve WHICH offer the customer is talking about, then answer only from
  // that offer's structured knowledge + approved community knowledge.
  const candidates: OfferKnowledge[] = await loadOfferKnowledgeCandidates().catch(() => []);
  // Resolution from the CURRENT message only — context is allowed to carry the
  // offer forward only when this turn really is about a product.
  const directResolution = resolveOffer(message, candidates);
  const asksSomething =
    isUserQuestion(message) ||
    interpretation.intent === "question" ||
    interpretation.intent === "price_question";
  const productGate = isProductQuestion({
    message,
    directResolution,
    lastGroundedOfferId: lastGroundedOfferIdFrom(contact),
    isQuestion: asksSomething,
  });
  const productAsked = productGate.product;
  // Exact ids of what was ACTUALLY presented recently — "הטיול הזה" is
  // resolved against those, never guessed from the whole catalogue.
  const recentOfferIds = Array.from(
    new Set(
      [
        currentFocus.offer_id,
        ...(ctxPackage?.offers_presented ?? []),
        ...(ctxPackage?.offers_sent ?? []),
        lastGroundedOfferIdFrom(contact),
        lastOfferIdFrom(contact),
      ]
        .filter(Boolean)
        .map(String),
    ),
  );
  const searchResolution = productGate.useContext
    ? resolveOffer(message, candidates, {
        recentMessages: history,
        // The AUTHORITATIVE focus wins over any stale ledger pointer: an
        // answer about Baku keeps Baku for "הטיול", "מה המחיר",
        // "אפשר להביא חברה" until the customer changes topic.
        lastOfferId: currentFocus.offer_id ?? lastGroundedOfferIdFrom(contact) ?? lastOfferIdFrom(contact),
        recentOfferIds,
      })
    : directResolution;

  // ---- Active-offer continuity ------------------------------------------
  // A VALID active offer answers referential follow-ups (price, balance,
  // total, dates, link, inclusions, accessibility). No broad search and no
  // clarification while it holds, unless the customer explicitly names
  // another offer or explicitly asks for other options.
  const { applyActiveOfferContinuity } = await import("./active-offer-continuity");
  const activeOfferId = currentFocus.offer_id ?? ctxPackage?.active_offer?.id ?? null;
  const activeOffer = activeOfferId ? candidates.find((o) => o.id === activeOfferId) ?? null : null;
  const continuity = productAsked
    ? applyActiveOfferContinuity({ message, activeOffer, offers: candidates, resolution: searchResolution })
    : null;
  const resolution = continuity ? continuity.resolution : searchResolution;
  const resolved = productAsked ? resolution.offer : null;
  const availability = resolved ? offerAvailability(resolved) : { sellable: false, past: false };


  let answerText: string | null = null;
  let groundingPath = "none";
  let knowledgeIds: string[] = [];
  let linkSent = false;
  let pendingHandoff: PendingProductHandoff | null = null;
  let clearPendingHandoff = false;

  // ---- Pending product handoff: the customer said yes to a human ---------
  const pending = pendingProductHandoffFrom(contact);
  const acceptsPending =
    !!contact &&
    !input.simulate &&
    isPendingHandoffFresh(pending) &&
    (acceptedHandoffOffer(message) || wantsHuman(message));
  if (acceptsPending && pending) {
    const res = await ensureHandoff({
      contactId: contact.id,
      customerPhone: contact.whatsapp_number ?? contact.phone ?? null,
      customerName: contact.first_name ?? null,
      reason: "product_question_unknown",
      reasonCodes: ["product_question_unknown", "customer_accepted_handoff"],
      urgency: "normal",
      latestInbound: message,
      suggestedResponse: `שאלה פתוחה: ${pending.question}`,
      excerpt: history.slice(-12).map((line) => ({
        ts: new Date().toISOString(),
        source: line.startsWith("תמר") ? "tamar" : "customer",
        content: line,
      })),
      offerId: pending.offer_id,
      runtime: "v2",
    }).catch(() => null);
    if (res?.handoff_id) {
      answerText = res.receipt_text;
      groundingPath = "product_handoff_confirmed";
      clearPendingHandoff = true; // cleared ONLY after durable creation
    } else {
      // Never claim a handoff that was not created — keep the pending offer.
      answerText = "רגע אחד, לא הצלחתי להעביר את זה עכשיו. אני מנסה שוב ואחזור אלייך כאן.";
      groundingPath = "product_handoff_failed";
    }
  }

  // A price / itinerary / link question in the CURRENT message is answered
  // from the current message only: no older-turn policy reply may take it.
  const solo = currentAsk.any ? null : soloPolicyReply(message);
  // Sensitive / high-stakes topics may be answered only from grounded data.
  const sensitiveTopic = asksSomething ? detectSensitiveTopic(message) : null;
  if (resetRequested) {
    groundingPath = "conversation_reset";
  } else if (answerText) {
    /* pending-handoff turn already answered */
  } else if (!currentAsk.any && !input.simulate && contact && (await (async () => {
    const { handleReengagementReply } = await import("@/lib/tamar-activation/followup.server");
    const r = await handleReengagementReply({ contact, message }).catch(() => null);
    if (!r) return false;
    answerText = r.text;
    groundingPath = r.path;
    return true;
  })())) {
    /* re-engagement reply already answered from stored facts */
  } else if (isSelfSummaryRequest(message)) {
    // Customer-safe: ONLY explicit facts the customer supplied.
    const provenance = contact?.id ? await loadCustomerSuppliedProfile(contact.id) : { facts: [], answers: [] };
    answerText = buildCustomerSelfSummary({
      firstName: contact?.first_name ?? null,
      explicitFacts: provenance.facts,
      relationshipAnswers: provenance.answers,
    });
    groundingPath = "self_summary_explicit_facts";
  } else if (solo) {
    answerText = solo.text;
    groundingPath = solo.offer_handoff ? "solo_policy_unknown" : "solo_policy_approved";

  } else if (voiceNorm?.ambiguous && !voiceNorm.changed) {
    // Low-confidence speech is NEVER silently rewritten and never merged
    // with stale travel context: ask one concise clarification and stop.
    answerText = voiceClarificationText();
    groundingPath = "voice_clarification";
  } else if (resolution.ambiguous && resolution.clarification) {
    answerText = resolution.clarification;
    groundingPath = "offer_clarification";
  } else if (sensitiveTopic && !(resolved && hasGroundedSensitiveData(resolved as any, sensitiveTopic))) {
    // No verified accessibility / medical data for the EXACT offer:
    // acknowledge, promise verification, open a human follow-up. Never claim
    // suitability and never append an offer after this.
    answerText = sensitiveVerificationText(resolved?.title ?? null, sensitiveTopic);
    groundingPath = "sensitive_verification_required";
  } else if (productAsked && isUnsupportedDetailQuestion(message, resolved)) {
    answerText = HONEST_UNKNOWN;
    groundingPath = "honest_unknown";
  } else if (!input.offline && productAsked) {
    const hits = await retrieveKnowledge(message, 3).catch(() => []);
    knowledgeIds = hits.map((h: any) => String(h.source_id ?? ""));
    answerText = await writeGroundedAnswer({
      agent,
      message,
      facts: hits.map((h: any) => String(h.content ?? "")),
      offers,
      offerBlock: resolved ? buildOfferGroundingBlock(resolved) : null,
      infoOnly: !!resolved && !availability.sellable,
      complexity,
    }).catch(() => null);
    // A corrective turn ("דיברנו על לונדון") gets ONE short acknowledgement
    // before the actual pending answer — never a list of other candidates.
    if (answerText && continuity?.acknowledgement) {
      answerText = `${continuity.acknowledgement} ${answerText}`;
    }
    groundingPath = resolved ? "offer_knowledge" : "community_knowledge";
  }


  // ---- Offer a human ONLY for an unknown product/service question -------
  if (
    !clearPendingHandoff &&
    (groundingPath === "honest_unknown" || groundingPath === "solo_policy_unknown") &&
    mayOfferHandoff({
      inQuestionnaire: !!pendingStepKey,
      unknownProductQuestion: true,
      explicitRequest: wantsHuman(message),
    })
  ) {
    pendingHandoff = {
      offer_id: resolved?.id ?? pending?.offer_id ?? null,
      offer_title: resolved?.title ?? pending?.offer_title ?? null,
      question: message.slice(0, 500),
      at: new Date().toISOString(),
    };
  }

  // A past / non-sellable offer may be discussed, never marketed.
  if (answerText && resolved && availability.past && groundingPath === "offer_knowledge") {
    answerText = `${PAST_OFFER_NOTE}\n${answerText}`;
  }

  // The link is sent on the first relevant recommendation, an explicit
  // request, or a material need — never on every reply.
  if (answerText && resolved) {
    const link = shouldSendOfferLink({
      offer: resolved,
      message,
      isRecommendation: groundingPath === "offer_knowledge",
      sentOfferIds: sentOfferIdsFrom(contact),
      sellable: availability.sellable,
    });
    if (link.send && resolved.offer_url) {
      answerText = `${answerText}\n${resolved.offer_url}`;
      linkSent = true;
    }
  }

  const recentlySentOfferIds = Array.from(
    new Set([...(ctxPackage?.offers_sent ?? []), ...(ctxPackage?.offers_presented ?? [])]),
  );
  const explicitOfferRequest = /(שוב|עוד\s*פעם|תשלחי|תשלח|הקישור|לינק|תזכיר)/.test(message);

  // ---- ONE structured plan for the turn ----------------------------------
  // Deterministic turns (reset, terminal grounding, frozen threads, offline)
  // never pay for a planning call. Everything else gets ONE coherent plan
  // that deterministic validation may reject.
  const { deterministicPlan, planComposition } = await import("./planner");
  const answeredIntakeKeys = Object.keys(knownFields ?? {});
  const fallbackPlan = deterministicPlan({
    intent: interpretation.intent,
    isQuestion: asksSomething,
    focusOfferId: currentFocus.offer_id,
    focusTitle: currentFocus.topic,
    missingIntakeKeys: intakeMissing,
    answeredIntakeKeys,
    journeyStage: state,
    wantsHuman: interpretation.wants_human,
  });
  const planEnabled =
    !!process.env["LOVABLE_API_KEY"] &&
    !input.offline &&
    !resetRequested &&
    !TERMINAL_GROUNDING_PATHS.has(groundingPath) &&
    groundingPath !== "product_handoff_confirmed" &&
    !!ctxPackage &&
    state !== "human_owned" &&
    state !== "human_handoff_queued" &&
    state !== "opted_out";
  const { planTurn } = await import("./planner.server");
  const planOutcome = await planTurn({
    ctx: ctxPackage ?? ({} as any),
    validation: {
      focusOfferId: currentFocus.offer_id,
      allowedOfferIds: Array.from(
        new Set([
          ...candidates.map((c) => String(c.id)),
          ...(offers as any[]).map((o) => String(o.id)),
          ...recentOfferIds,
        ].filter(Boolean)),
      ),
      allowedSourceIds: knowledgeIds,
      answeredIntakeKeys,
      missingIntakeKeys: intakeMissing,
      groundedFactKeys: Object.entries(ctxPackage?.active_offer ?? {})
        .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
        .map(([k]) => k),
      explicitMention: resolution.reason === "exact" || resolution.reason === "alias",
      resolvedReference: resolution.reason === "context",
      resetRequested,
    },
    fallback: fallbackPlan,
    catalog: candidates.map((c) => ({ id: String(c.id), title: String(c.title ?? "") })),
    complexity,
    enabled: planEnabled,
  }).catch(() => null);
  const plan = planOutcome?.plan ?? fallbackPlan;
  // Only a model plan that PASSED deterministic validation may steer the turn.
  const planFromModel = plan.source === "model" && planOutcome?.accepted === true;
  const composition = planComposition(plan);
  const planReasonCodes = [
    `plan_${planOutcome?.routing ?? "skipped"}`,
    `plan_action_${plan.next_best_action}`,
    ...(planOutcome?.violations ?? []).slice(0, 3).map((v) => `plan_violation_${v.split(":")[0]}`),
  ];

  // ---- DETERMINISTIC CONTROL PATHS ---------------------------------------
  // Reset, consent, opt-out and handoff are control instructions, not
  // generative turns: they are decided here, before the orchestrator, and
  // their deterministic Hebrew copy is always delivered.
  const controlPath: ControlPath | null = detectControlPath({
    resetRequested,
    state,
    wantsHuman: interpretation.wants_human || wantsHuman(message),
    optOut: isExplicitOptOut(message),
  });
  let emptyBodyGuard: string | null = null;
  let finalUrlCount = 0;
  let dedupedUrlCount = 0;


  // ---- SINGLE RESPONSE ORCHESTRATOR --------------------------------------
  // ONE primary action, ONE composed payload. Every legacy post-answer
  // composer (recommendation concatenation, intake appender, catalog
  // fallback) is disabled for the turns this owns.
  const orchestrator = selectResponseAction({
    message,
    isQuestion: asksSomething,
    intent: interpretation.intent,
    wantsHuman: interpretation.wants_human || wantsHuman(message),
    state,
    resetRequested,
    groundingPath,
    answerText,
    activeOfferId,
    resolvedOfferId: resolved?.id ?? null,
    planValid: planFromModel,
    planAskIntake: composition.askIntake,
    planIntakeKey: plan.intake_question_key,
    missingIntakeKeys: intakeMissing,
    catalogSize: (offers as any[]).length,
    marketingAllowed: marketingAllowed(state),
    hasVerifiedLink: !!(resolved?.offer_url ?? activeOffer?.offer_url),
  });

  const guardCatalog = candidates.map((c) => ({
    id: String(c.id),
    title: String((c as any).title ?? ""),
    url: (c as any).offer_url ?? null,
    aliases: ((c as any).matching_tags ?? []) as string[],
    facts: [
      ...Object.values(((c as any).grounded_facts ?? {}) as Record<string, unknown>).map((v) => String(v ?? "")),
      String((c as any).ai_summary ?? ""),
      ...(((c as any).included ?? []) as string[]),
    ].filter(Boolean),
  }));
  /** Complete, subject-first grounded answer used when generation fails. */
  const deterministicOfferAnswer = (): string | null => {
    const off = (resolved ?? activeOffer) as OfferKnowledge | null;
    if (!off) return null;
    return buildDeterministicOfferAnswer({
      title: off.title,
      url: off.offer_url,
      facts: Object.entries((off.grounded_facts ?? {}) as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim())
        .map(([k, v]) => ({ label: String(k), value: String(v) })),
    });
  };
  let finalAnswer: string | null = answerText;
  let selectedOfferIds: string[] = orchestrator.offer_ids;
  let terminalAskStepKey: string | null = null;
  const orchestratorCodes: string[] = [
    `orchestrator_${orchestrator.action}`,
    ...orchestrator.reasons.map((r) => `orchestrator_reason_${r}`),
  ];
  let guardCodes: string[] = [];
  let recoveryMode: string | null = null;

  if (orchestrator.applies) {
    let intakeQuestion: string | null = null;
    if (orchestrator.action === "recommend_products") {
      const rec = buildRecommendationText({
        offers,
        maxOffers: agent.safety.max_offers ?? 2,
        excludeOfferIds: [activeOfferId, resolved?.id ?? null].filter(Boolean) as string[],
      });
      finalAnswer = [answerText, rec.text].filter(Boolean).join("\n\n");
      selectedOfferIds = rec.ids;
    } else if (orchestrator.action === "answer_and_ask_one_intake_question" && answerText) {
      const step =
        agent.steps.find(
          (s) => s.enabled && (s.field_key ?? s.step_key) === orchestrator.intake_key,
        ) ?? nextStep(agent, knownFields, "intake");
      if (step) {
        intakeQuestion = step.question_text;
        finalAnswer = `${answerText}\n\n${step.question_text}`;
        terminalAskStepKey = step.step_key;
      }
    }

    // ---- Final semantic response guard (deterministic first) -------------
    const allowedOfferIds = Array.from(
      new Set([...selectedOfferIds, activeOfferId, resolved?.id ?? null].filter(Boolean) as string[]),
    );
    const runGuard = (text: string | null) =>
      guardResponse({
        text: text ?? "",
        action: orchestrator.action,
        allowedOfferIds,
        catalog: guardCatalog,
      });
    let guard = runGuard(finalAnswer);
    guardCodes = guard.reason_codes;
    if (!guard.ok && finalAnswer) {
      // ONE regeneration inside the SAME selected action, with allowed
      // grounding only. Never a silent repair, never line stripping.
      if (!input.offline && resolved) {
        const regenerated = await writeGroundedAnswer({
          agent,
          message: `${message}\n\n(ענִי אך ורק על "${resolved.title}". אסור להזכיר מוצר או יעד אחר.)`,
          facts: [],
          offers,
          offerBlock: buildOfferGroundingBlock(resolved),
          infoOnly: !availability.sellable,
          complexity,
        }).catch(() => null);
        if (regenerated) {
          finalAnswer = intakeQuestion ? `${regenerated}\n\n${intakeQuestion}` : regenerated;
          guard = runGuard(finalAnswer);
          guardCodes = [...guardCodes, "guard_regenerated", ...guard.reason_codes];
          recoveryMode = "regenerated";
        }
      }
      if (!guard.ok) {
        // COMPLETE deterministic grounded answer from the allowed offer, or
        // one concise clarification. Never a stripped fragment.
        const deterministic = deterministicOfferAnswer();
        finalAnswer = deterministic
          ? intakeQuestion
            ? `${deterministic}\n\n${intakeQuestion}`
            : deterministic
          : SAFE_CLARIFY_TEXT;
        recoveryMode = deterministic ? "deterministic_offer_answer" : "safe_clarification";
        guardCodes = [...guardCodes, `guard_recovery_${recoveryMode}`];
      }
    }

    // ---- Completeness guard: never send a subject-less fragment ----------
    if (hasDanglingAnaphora(finalAnswer)) {
      const deterministic = deterministicOfferAnswer();
      finalAnswer = deterministic
        ? intakeQuestion
          ? `${deterministic}\n\n${intakeQuestion}`
          : deterministic
        : SAFE_CLARIFY_TEXT;
      recoveryMode = deterministic ? "completeness_offer_answer" : "completeness_clarification";
      guardCodes = [...guardCodes, `completeness_guard_${recoveryMode}`];
    }

    // ---- Empty payload: never let a blank body reach the send path -------
    if (!String(finalAnswer ?? "").trim()) {
      const deterministic = deterministicOfferAnswer();
      finalAnswer = deterministic ?? SAFE_ERROR_TEXT;
      recoveryMode = recoveryMode ?? (deterministic ? "empty_offer_answer" : "empty_safe_error");
      guardCodes = [...guardCodes, "guard_empty_payload"];
    }
  }


  const orchestratorTerminal = orchestrator.applies && !!finalAnswer;

  const turnInput: TurnInput = {
    state,
    message,
    optionId: input.option_id ?? null,
    optionValue: optionValueFor(agent, pendingStepKey, input.option_id ?? null),
    agent,
    interpretation,
    knownFields,
    pendingStepKey,
    ambiguityTurns,
    answeredCount,
    offers,
    firstName: contact?.first_name ?? input.name ?? null,
    answerText: orchestrator.applies ? finalAnswer : answerText,
    recentlySentOfferIds,
    explicitOfferRequest,
    resetRequested,
    // The orchestrated payload is the WHOLE reply. The validated plan may
    // also end the turn: an answer-first turn with no appropriate intake
    // question must not grow a recommendation tail.
    terminalAnswer:
      TERMINAL_GROUNDING_PATHS.has(groundingPath) ||
      orchestratorTerminal ||
      (!!answerText && planFromModel && composition.terminal),
    terminalReason: TERMINAL_GROUNDING_PATHS.has(groundingPath)
      ? groundingPath
      : orchestratorTerminal
        ? `orchestrator_${orchestrator.action}`
        : planFromModel
          ? `plan_${plan.next_best_action}`
          : groundingPath,
    terminalActions: groundingPath === "sensitive_verification_required" ? ["sensitive_followup"] : [],
    terminalAskStepKey,
    terminalOfferIds: selectedOfferIds,
    // No downstream layer may list offers unless recommending IS the action.
    allowRecommendation: orchestrator.recommendation_allowed,
  };

  const decision = decideTurn(turnInput);
  decision.reason_codes = [
    ...(decision.reason_codes ?? []),
    ...planReasonCodes,
    ...orchestratorCodes,
    ...guardCodes,
  ];



  // ---- Authoritative focus update ---------------------------------------
  // Only an explicit mention, a resolved reference or an explicit reset may
  // move it. Ranked/recommended offers never do.
  const { focus: updatedFocus } = nextFocus({
    current: currentFocus,
    resetRequested,
    resolvedOfferId: resolved?.id ?? null,
    resolvedTitle: resolved?.title ?? null,
    resolutionReason: resolution.reason,
    productAsked,
  });

  // Deterministic side effects of a terminal/reset turn. Both are idempotent
  // per inbound message id: a retry writes nothing new.
  if (!input.simulate && contact?.id) {
    if (decision.actions.includes("conversation_reset")) {
      const { recordConversationReset } = await import("./reset.server");
      const { cleared } = applyResetToDynamic(dyn);
      await recordConversationReset({
        contactId: contact.id,
        inboundMessageId: input.inbound_message_id ?? null,
        message,
        cleared,
      }).catch(() => null);
    }
    if (decision.actions.includes("sensitive_followup") && sensitiveTopic) {
      const { ensureSensitiveFollowupTask } = await import("./followup.server");
      await ensureSensitiveFollowupTask({
        contactId: contact.id,
        inboundMessageId: input.inbound_message_id ?? null,
        offerId: resolved?.id ?? null,
        offerTitle: resolved?.title ?? null,
        question: message,
        topic: sensitiveTopic,
      }).catch(() => null);
    }
  }

  const sends: V2TurnResult["sends"] = [];
  let noReplyReason: string | null = input.simulate ? "simulate" : null;
  let outgoing: OutboundMessage[] = decision.messages;
  if (!input.simulate && contact) {
    const to = toE164(contact.whatsapp_number ?? contact.phone ?? input.phone) ?? "";
    if (!to) {
      const { ContactCreateError } = await import("@/lib/contact-create-error");
      throw new ContactCreateError({ code: "invalid_phone", phone: input.phone, retryable: false });
    }
    if (decision.silent) {
      outgoing = [];
      noReplyReason = "silent_by_policy";
    } else {
      const windowOpen = !!input.inbound_message_id || (await isSessionWindowOpen(contact.id));
      const template = windowOpen ? null : await activeSessionTemplate();

      // ---- Envelope policy: dedupe EVERY segment, then one envelope -----
      const { planOutbound } = await import("./envelope");
      const recentSignatures = (ctxPackage?.transcript ?? [])
        .filter((t) => t.dir === "out")
        .slice(-6)
        .map((t) => questionSignature(t.text));
      // A direct answer to a repeated customer question is legitimate; only
      // Tamar-initiated segments (questions/offers) are history-deduped.
      // A deterministic control path (reset / consent / opt-out / handoff)
      // is ALWAYS delivered: its canonical copy repeats by design and must
      // never be deduplicated into an empty envelope.
      const answering =
        !!controlPath ||
        (decision.reason_codes ?? []).includes("answer_first") ||
        (orchestrator.applies && orchestrator.action !== "recommend_products");
      // Verified links only: the active offer record is the single source of
      // truth for anything clickable, and perks stay unpromised until real.
      const allowedUrls = [
        "https://www.zooga.co.il",
        ctxPackage?.active_offer?.url,
        ...Object.values(ctxPackage?.active_offer?.facts ?? {}),
        ...(offers as any[]).flatMap((o) => [o?.offer_url, o?.url]),
        ...(candidates as any[]).flatMap((o) => [o?.offer_url, o?.url, o?.registration_url]),
      ].filter((v): v is string => typeof v === "string" && /^https?:\/\//i.test(v));
      const planned = planOutbound({
        messages: decision.messages,
        recentSignatures: answering ? [] : recentSignatures,
        grounding: { allowedUrls, groundedPerks: [] },
      });

      if (planned.dropped.length) {
        decision.reason_codes = [...(decision.reason_codes ?? []), `deduped_${planned.dropped.length}`];
      }

      // ---- Conversation Progress Guard ------------------------------
      // The engine may not repeat a question it already asked. A second
      // attempt is rephrased once; a third becomes an open recovery turn.
      // A deterministic control path (reset / consent / opt-out / handoff)
      // is canonical copy: the progress guard may never rephrase it or
      // prepend intake framing to it.
      const { guardOutbound } = await import("@/lib/conversation-guard/guard.server");
      const first = controlPath ? null : planned.messages[0];
      const guard = first


        ? await guardOutbound({
            contactId: contact.id,
            phone: to,
            route: "tamar_v2",
            inboundMessageId: input.inbound_message_id ?? null,
            inboundText: message,
            candidateText: messageText(first),
            askedField: decision.ask_step_key ?? pendingStepKey,
            intent: interpretation.intent,
            stateBefore: state,
            stateAfter: decision.next_state,
            progress: {
              answered_user_intent: !!answerText,
              advanced_state: decision.next_state !== state,
              performed_handoff: decision.reason_codes?.includes("handoff") ?? false,
            },
          }).catch(() => null)
        : null;
      outgoing =
        guard && guard.verdict !== "send"
          ? [{ kind: "text", body: guard.text } as OutboundMessage]
          : planned.messages;
      if (guard && guard.verdict !== "send") {
        decision.reason_codes = [...(decision.reason_codes ?? []), `guard_${guard.verdict}`];
      }

      // ---- FINAL INVARIANT: no empty/whitespace body may be sent --------
      const bodyCheck = finalBodyGuard({
        bodies: outgoing.map((m) => messageText(m)),
        controlPath,
        controlText: decision.messages.map(messageText).find((b) => b.trim()) ?? null,
        safeText: finalAnswer ?? answerText ?? SAFE_ERROR_TEXT,
      });
      if (!bodyCheck.ok && bodyCheck.replacement) {
        outgoing = [{ kind: "text", body: bodyCheck.replacement } as OutboundMessage];
        emptyBodyGuard = bodyCheck.reason;
        decision.reason_codes = [...(decision.reason_codes ?? []), bodyCheck.reason ?? "empty_body_guard"];
      }

      // ---- ACTUAL FINAL SEND BOUNDARY: URL deduplication ---------------
      // Applied AFTER composition, regeneration, CTA/link insertion, guard
      // and recovery formatting — immediately before persistence and the
      // provider call, so the same verified URL is sent at most once.
      {
        const { dedupeUrls, countUrls } = await import("./envelope");
        const before = countUrls(outgoing.map(messageText).join("\n"));
        outgoing = dedupeUrls(outgoing);
        finalUrlCount = countUrls(outgoing.map(messageText).join("\n"));
        dedupedUrlCount = Math.max(0, before - finalUrlCount);
        if (dedupedUrlCount > 0) {
          decision.reason_codes = [...(decision.reason_codes ?? []), `deduped_url_${dedupedUrlCount}`];
        }
      }




      // ---- Idempotent CRM + memory writeback (one per inbound id) -----
      // Reuses the structured interpretation already produced; no extra
      // model call. A retry of the same wamid writes nothing.
      const { applyWriteback } = await import("./writeback.server");
      const writeback = await applyWriteback({
        contactId: contact.id,
        inboundMessageId: input.inbound_message_id ?? null,
        message,
        interpretation,
        capturedFields: decision.captured as Record<string, string>,
        previousSummary: ctxPackage?.summary ?? (dyn?.["v2_summary"] ?? null),
        contextSnapshotId,
        outboundText: outgoing.map(messageText).join(" "),
      }).catch(() => null);

      // Persist AFTER the guard chose the final text: an unsent candidate
      // must never appear in the transcript.
      await persistTurn({
        contact,
        input,
        decision,
        outbound: outgoing,
        interpretation,
        agent,
        message,
        answeredCount,
        offerId: resolved?.id ?? null,
        linkSent,
        pendingHandoff,
        clearPendingHandoff,
        groundedOfferId: groundingPath === "offer_knowledge" ? (resolved?.id ?? null) : null,
        grounding: { path: groundingPath, knowledge_ids: knowledgeIds, confidence: resolution.confidence, complexity },
        orchestrator: {
          version: ORCHESTRATOR_VERSION,
          selected_action: orchestrator.action,
          selected_offer_ids: selectedOfferIds,
          guard: guardCodes,
          fallback_reason: guardCodes.includes("guard_safe_fallback") ? "guard_safe_fallback" : null,
          regenerated: guardCodes.includes("guard_regenerated"),
          control_path: controlPath,
          empty_body_guard: emptyBodyGuard,
          recovery_mode: recoveryMode,
          completeness_guard: guardCodes.some((c) => c.startsWith("completeness_guard")),
          current_message_source: currentMessage.source,
          current_message_id: currentMessage.id,
          final_url_count: finalUrlCount,
          deduped_url_count: dedupedUrlCount,

        },
        summary: writeback && !writeback.skipped ? writeback.summary : null,
        focus: updatedFocus,
        contextSnapshotId,
      });

      for (const m of outgoing) {
        const res = await sendMessage(to, m, { windowOpen, template });
        sends.push({ kind: m.kind, ok: res.ok, http: res.status, error: res.error });
        await recordDelivery({
          contactId: contact.id,
          text: messageText(m),
          result: res,
          inboundMessageId: input.inbound_message_id ?? null,
          kind: `v2_${m.kind}`,
        });
        if (!res.ok) break;
      }
      // The link ledger is committed ONLY after a successful outbound send,
      // so a failed send never suppresses the link forever.
      if (linkSent && resolved?.id && sends.some((s) => s.ok)) {
        await commitOfferLinkSent(contact.id, resolved.id).catch(() => undefined);
      }
    }
    if (decision.silent) {
      await persistTurn({
        contact,
        input,
        decision,
        outbound: [],
        interpretation,
        agent,
        message,
        answeredCount,
        offerId: resolved?.id ?? null,
        linkSent,
        pendingHandoff,
        clearPendingHandoff,
        groundedOfferId: groundingPath === "offer_knowledge" ? (resolved?.id ?? null) : null,
        grounding: { path: groundingPath, knowledge_ids: knowledgeIds, confidence: resolution.confidence, complexity },
        orchestrator: {
          version: ORCHESTRATOR_VERSION,
          selected_action: orchestrator.action,
          selected_offer_ids: selectedOfferIds,
          guard: guardCodes,
          fallback_reason: guardCodes.includes("guard_safe_fallback") ? "guard_safe_fallback" : null,
          regenerated: guardCodes.includes("guard_regenerated"),
          control_path: controlPath,
          empty_body_guard: emptyBodyGuard,
          recovery_mode: recoveryMode,
          completeness_guard: guardCodes.some((c) => c.startsWith("completeness_guard")),
        },
        focus: updatedFocus,
        contextSnapshotId,
      });
    }
    decision.messages = outgoing;
  }


  return {
    status: 200,
    contact_id: contact?.id ?? null,
    decision,
    interpretation,
    agent_version: agent.version,
    sends,
    no_reply_reason: noReplyReason,
    latency_ms: Date.now() - started,
  };
}

async function persistTurn(args: {
  contact: any;
  input: V2TurnInput;
  decision: TurnDecision;
  /** the FINAL post-guard outbound envelope actually being sent */
  outbound: OutboundMessage[];

  interpretation: Interpretation;
  agent: AgentVersion;
  message: string;
  answeredCount: number;
  offerId?: string | null;
  linkSent?: boolean;
  pendingHandoff?: PendingProductHandoff | null;
  clearPendingHandoff?: boolean;
  groundedOfferId?: string | null;
  grounding?: { path: string; knowledge_ids: string[]; confidence: number; complexity?: string };
  /** Single Response Orchestrator observability for this turn */
  orchestrator?: {
    version: string;
    selected_action: string;
    selected_offer_ids: string[];
    guard: string[];
    fallback_reason: string | null;
    regenerated: boolean;
    control_path?: string | null;
    empty_body_guard?: string | null;
    recovery_mode?: string | null;
    completeness_guard?: boolean;
  };
  /** compact rolling conversation summary produced by the writeback pass */
  summary?: string | null;
  /** authoritative active conversational focus after this turn */
  focus?: ActiveFocus | null;
  /** snapshot this turn reasoned over; linked to the decision trace */
  contextSnapshotId?: string | null;
}) {
  const { contact, decision, interpretation, agent, message } = args;
  const now = new Date().toISOString();

  // inbound + outbound transcript
  try {
    // The Inbound Context Gate already logs the inbound line keyed by the
    // provider message id; the ledger keeps exactly one row per wamid.
    const { recordInboundLedger } = await import("@/lib/inbound-ledger.server");
    await recordInboundLedger({
      contactId: contact.id,
      text: message,
      inboundMessageId: args.input.inbound_message_id ?? null,
      source: "tamar_inbound",
    });
    for (const m of args.outbound) {
      await supabaseAdmin.from("interactions").insert({
        contact_id: contact.id,
        type: "whatsapp_message",
        source: "tamar_outbound",
        content: messageText(m),
      } as any);
    }
  } catch { /* transcript must never break a turn */ }

  // durable contact state
  const dyn = { ...((contact.dynamic_profile_fields ?? {}) as Record<string, any>) };
  dyn["v2_pending_step"] = decision.ask_step_key;
  dyn["v2_ambiguity_turns"] = decision.ambiguity_turns;
  dyn["v2_answered_count"] = args.answeredCount + (Object.keys(decision.captured).length ? 1 : 0);
  if (args.summary) dyn["v2_summary"] = args.summary;
  // last-offer pointer only; the LINK ledger is committed after a successful
  // send (commitOfferLinkSent), never here.
  Object.assign(dyn, withOfferLedger(dyn, { offerId: args.offerId ?? null, linkSent: false }));
  const withPending = withPendingHandoff(dyn, {
    pending: args.pendingHandoff ?? null,
    clear: !!args.clearPendingHandoff,
    groundedOfferId: args.groundedOfferId ?? null,
  });
  for (const k of Object.keys(dyn)) if (!(k in withPending)) delete dyn[k];
  Object.assign(dyn, withPending);

  if (args.focus) Object.assign(dyn, withFocus(dyn, args.focus));

  // A reset clears ONLY volatile working state. History, CRM columns, facts,
  // memories, audit rows and consent are untouched.
  if (decision.actions.includes("conversation_reset")) {
    const reset = applyResetToDynamic(dyn);
    for (const k of Object.keys(dyn)) delete dyn[k];
    Object.assign(dyn, reset.dyn);
  }

  const patch: Record<string, unknown> = {
    conversation_state: decision.next_state,
    conversation_state_at: now,
    last_interaction_at: now,
  };
  for (const [k, v] of Object.entries(decision.captured)) {
    if (CONTACT_COLUMNS.has(k)) patch[k] = v;
    else dyn[k] = v;
  }
  patch["dynamic_profile_fields"] = dyn;

  if (decision.actions.includes("consent_granted")) {
    patch["consent_marketing"] = true;
    patch["consent_date"] = now;
    patch["consent_responded_at"] = now;
    patch["opted_out_at"] = null;
  }
  if (decision.ask_step_key === "consent") patch["consent_asked_at"] = contact.consent_asked_at ?? now;
  if (decision.actions.includes("opt_out")) {
    patch["opted_out_at"] = now;
    patch["consent_marketing"] = false;
    patch["consent_responded_at"] = now;
  }
  if (decision.actions.includes("opt_in")) {
    patch["opted_out_at"] = null;
    patch["consent_marketing"] = true;
  }

  try {
    await supabaseAdmin.from("contacts").update(patch as any).eq("id", contact.id);
  } catch { /* ignore */ }

  // state transition ledger
  if (decision.next_state !== decision.from_state) {
    try {
      await supabaseAdmin.from("tamar_state_transitions").insert({
        contact_id: contact.id,
        from_state: decision.from_state,
        to_state: decision.next_state,
        trigger: "v2_engine",
        reason_codes: decision.reason_codes,
        actor: "tamar_v2",
      } as any);
    } catch { /* ignore */ }
  }

  // decision trace (its id is linked back onto the context snapshot)
  let traceId: string | null = null;
  try {
    const { data: traceRow } = await supabaseAdmin.from("tamar_decision_traces").insert({
      contact_id: contact.id,
      state: decision.from_state,
      considered_actions: decision.actions,
      selected_action: decision.reason_codes[0] ?? "reply",
      confidence: interpretation.confidence,
      reason_codes: decision.reason_codes,
      fields_used: decision.captured,
      offer_ids: args.offerId ? [...new Set([...decision.offer_ids, args.offerId])] : decision.offer_ids,
      prompt_version: `v2.${agent.version}`,
      model: interpretation.source,
    } as any).select("id").maybeSingle();
    traceId = (traceRow as any)?.id ?? null;
  } catch { /* ignore */ }

  // runtime execution row (dashboards depend on this table)
  try {
    const { data: execRow } = await supabaseAdmin.from("tamar_runtime_executions").insert({
      contact_id: contact.id,
      channel: "whatsapp",
      source: args.input.source ?? "meta_webhook",
      inbound_message: message,
      outbound_reply: args.outbound.map(messageText).join("\n---\n"),
      runtime_mode: "brain_v2",
      composition_version: `v2.${agent.version}`,
      conversation_mode: decision.next_state,
      conversation_mode_reasons: decision.reason_codes,
      prompt_blocks_injected: {
        interpretation_source: interpretation.source,
        grounding_path: args.grounding?.path ?? "none",
        grounding_confidence: args.grounding?.confidence ?? 0,
        knowledge_ids: args.grounding?.knowledge_ids ?? [],
        offer_id: args.offerId ?? null,
        offer_link_sent: !!args.linkSent,
        context_snapshot_id: args.contextSnapshotId ?? null,
        orchestrator_version: args.orchestrator?.version ?? null,
        selected_action: args.orchestrator?.selected_action ?? null,
        selected_offer_ids: args.orchestrator?.selected_offer_ids ?? [],
        guard_result: args.orchestrator?.guard ?? [],
        guard_fallback_reason: args.orchestrator?.fallback_reason ?? null,
        guard_regenerated: !!args.orchestrator?.regenerated,
        control_path: args.orchestrator?.control_path ?? null,
        empty_body_guard: args.orchestrator?.empty_body_guard ?? null,
        recovery_mode: args.orchestrator?.recovery_mode ?? null,
        completeness_guard: !!args.orchestrator?.completeness_guard,
        semantic_guard: args.orchestrator?.guard ?? [],
        final_envelope_count: args.outbound.length,
        deployment_sha: process.env["DEPLOYMENT_SHA"] ?? process.env["CF_VERSION_METADATA_ID"] ?? null,
      },
    } as any).select("id").maybeSingle();
    const { attachDecisionTrace } = await import("./context.server");
    await attachDecisionTrace({
      contactId: contact.id,
      inboundMessageId: args.input.inbound_message_id ?? null,
      snapshotId: args.contextSnapshotId ?? null,
      decisionTraceId: traceId,
      runtimeExecutionId: (execRow as any)?.id ?? null,
    }).catch(() => false);
  } catch { /* ignore */ }

  // handoff + freeze (also covers follow-ups on an already frozen thread)
  const isHandoff = decision.actions.includes("handoff");
  const isHandoffFollowUp = decision.actions.includes("handoff_followup");
  if (isHandoff || isHandoffFollowUp) {
    try {
      await ensureHandoff({
        contactId: contact.id,
        customerPhone: contact.whatsapp_number ?? contact.phone ?? null,
        customerName: contact.first_name ?? contact.full_name ?? null,
        reason: decision.reason_codes.join(",") || "human_request",
        reasonCodes: decision.reason_codes,
        urgency: decision.reason_codes.includes("urgency_high") ? "high" : "normal",
        latestInbound: message,
        excerpt: [],
        followUp: isHandoffFollowUp,
        runtime: "v2",
      });
    } catch { /* handoff row failure must not lose the reply */ }
  }
  if (isHandoff) {
    try {
      await supabaseAdmin
        .from("contacts")
        .update({ human_owned: true, human_owned_at: now, human_owned_by: "tamar_v2" } as any)
        .eq("id", contact.id);
    } catch { /* ignore */ }
  }
}
