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
import { decideTurn, type TurnInput } from "./engine-core";
import { knownFieldsFromContact, loadAgentVersion, loadSellableOffers } from "./flow.server";
import { interpret } from "./interpreter.server";
import { interpretDeterministic } from "./interpret-rules";
import { deriveState } from "./state-machine";
import { isUserQuestion } from "./classify";
import {
  HONEST_UNKNOWN,
  PAST_OFFER_NOTE,
  buildCustomerSelfSummary,
  buildOfferGroundingBlock,
  isSelfSummaryRequest,
  isUnsupportedDetailQuestion,
  offerAvailability,
  resolveOffer,
  shouldSendOfferLink,
  soloPolicyReply,
  type OfferKnowledge,
} from "./offer-knowledge";
import {
  lastOfferIdFrom,
  loadOfferKnowledgeCandidates,
  sentOfferIdsFrom,
  withOfferLedger,
} from "./offer-knowledge.server";
import type { AgentVersion, Interpretation, OutboundMessage, TurnDecision } from "./types";
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

export async function runV2Turn(input: V2TurnInput): Promise<V2TurnResult> {
  const started = Date.now();
  const message = String(input.message ?? "").trim();
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
  const history = contact?.id ? await loadRecentTranscript(contact.id, 12) : [];

  const interpretation: Interpretation = input.offline
    ? interpretDeterministic(message)
    : await interpret(message, {
        state,
        pendingQuestion: pendingStepKey,
        known: knownFields,
        history,
        summary: (contact?.dynamic_profile_fields as any)?.["v2_summary"] ?? null,
      });

  // ---- Product grounding -------------------------------------------------
  // Resolve WHICH offer the customer is talking about, then answer only from
  // that offer's structured knowledge + approved community knowledge.
  const candidates: OfferKnowledge[] = await loadOfferKnowledgeCandidates().catch(() => []);
  const resolution = resolveOffer(message, candidates, {
    recentMessages: history,
    lastOfferId: lastOfferIdFrom(contact),
  });
  const resolved = resolution.offer;
  const availability = resolved ? offerAvailability(resolved) : { sellable: false, past: false };

  const productAsked =
    isUserQuestion(message) ||
    interpretation.intent === "question" ||
    interpretation.intent === "price_question";

  let answerText: string | null = null;
  let groundingPath = "none";
  let knowledgeIds: string[] = [];
  let linkSent = false;

  const solo = soloPolicyReply(message);
  if (isSelfSummaryRequest(message)) {
    // Customer-safe: ONLY explicit facts the customer supplied.
    let relationshipAnswers: Array<{ question_key: string; raw_text: string | null }> = [];
    if (contact?.id) {
      const { data } = await supabaseAdmin
        .from("relationship_intake_answers")
        .select("question_key, raw_text")
        .eq("contact_id", contact.id)
        .limit(12);
      relationshipAnswers = ((data as any[]) ?? []).map((r) => ({
        question_key: r.question_key,
        raw_text: r.raw_text ?? null,
      }));
    }
    answerText = buildCustomerSelfSummary({ contact, relationshipAnswers });
    groundingPath = "self_summary_explicit_facts";
  } else if (solo) {
    answerText = solo.text;
    groundingPath = solo.offer_handoff ? "solo_policy_unknown" : "solo_policy_approved";
  } else if (resolution.ambiguous && resolution.clarification) {
    answerText = resolution.clarification;
    groundingPath = "offer_clarification";
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
    }).catch(() => null);
    groundingPath = resolved ? "offer_knowledge" : "community_knowledge";
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
    answerText,
  };
  const decision = decideTurn(turnInput);

  const sends: V2TurnResult["sends"] = [];
  let noReplyReason: string | null = input.simulate ? "simulate" : null;
  if (!input.simulate && contact) {
    await persistTurn({
      contact,
      input,
      decision,
      interpretation,
      agent,
      message,
      answeredCount,
      offerId: resolved?.id ?? null,
      linkSent,
      grounding: { path: groundingPath, knowledge_ids: knowledgeIds, confidence: resolution.confidence },
    });
    const to = toE164(contact.whatsapp_number ?? contact.phone ?? input.phone) ?? "";
    if (!to) {
      const { ContactCreateError } = await import("@/lib/contact-create-error");
      throw new ContactCreateError({ code: "invalid_phone", phone: input.phone, retryable: false });
    }
    if (decision.silent) {
      noReplyReason = "silent_by_policy";
    } else {
      const windowOpen = !!input.inbound_message_id || (await isSessionWindowOpen(contact.id));
      const template = windowOpen ? null : await activeSessionTemplate();
      // ---- Conversation Progress Guard ------------------------------
      // The engine may not repeat a question it already asked. A second
      // attempt is rephrased once; a third becomes an open recovery turn.
      const { guardOutbound } = await import("@/lib/conversation-guard/guard.server");
      const first = decision.messages[0];
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
      const outgoing =
        guard && guard.verdict !== "send"
          ? [{ kind: "text", body: guard.text } as any]
          : decision.messages;
      if (guard && guard.verdict !== "send") {
        decision.reason_codes = [...(decision.reason_codes ?? []), `guard_${guard.verdict}`];
      }
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
    }
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
  interpretation: Interpretation;
  agent: AgentVersion;
  message: string;
  answeredCount: number;
  offerId?: string | null;
  linkSent?: boolean;
  grounding?: { path: string; knowledge_ids: string[]; confidence: number };
}) {
  const { contact, decision, interpretation, agent, message } = args;
  const now = new Date().toISOString();

  // inbound + outbound transcript
  try {
    // The Inbound Context Gate already logs the inbound line keyed by the
    // provider message id; upserting on that key keeps exactly one row.
    await supabaseAdmin.from("interactions").upsert(
      {
        contact_id: contact.id,
        type: "whatsapp_message",
        source: "tamar_inbound",
        content: message,
        provider_message_id: args.input.inbound_message_id ?? null,
      } as any,
      { onConflict: "provider_message_id", ignoreDuplicates: true } as any,
    );
    for (const m of decision.messages) {
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
  Object.assign(
    dyn,
    withOfferLedger(dyn, { offerId: args.offerId ?? null, linkSent: !!args.linkSent }),
  );

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

  // decision trace
  try {
    await supabaseAdmin.from("tamar_decision_traces").insert({
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
    } as any);
  } catch { /* ignore */ }

  // runtime execution row (dashboards depend on this table)
  try {
    await supabaseAdmin.from("tamar_runtime_executions").insert({
      contact_id: contact.id,
      channel: "whatsapp",
      source: args.input.source ?? "meta_webhook",
      inbound_message: message,
      outbound_reply: decision.messages.map(messageText).join("\n---\n"),
      runtime_mode: "brain_v2",
      composition_version: `v2.${agent.version}`,
      conversation_mode: decision.next_state,
      conversation_mode_reasons: decision.reason_codes,
      prompt_blocks_injected: { interpretation_source: interpretation.source },
    } as any);
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
