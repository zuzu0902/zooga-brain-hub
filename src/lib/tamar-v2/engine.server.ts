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

  const interpretation: Interpretation = input.offline
    ? interpretDeterministic(message)
    : await interpret(message, { state, pendingQuestion: pendingStepKey, known: knownFields });

  // Grounded wording is produced ONLY for real customer questions.
  let answerText: string | null = null;
  if (!input.offline && (isUserQuestion(message) || interpretation.intent === "question" || interpretation.intent === "price_question")) {
    const hits = await retrieveKnowledge(message, 3).catch(() => []);
    answerText = await writeGroundedAnswer({
      agent,
      message,
      facts: hits.map((h: any) => String(h.content ?? "")),
      offers,
    }).catch(() => null);
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
  if (!input.simulate && contact) {
    await persistTurn({ contact, input, decision, interpretation, agent, message, answeredCount });
    const to = toE164(contact.whatsapp_number ?? contact.phone ?? input.phone) ?? "";
    if (to && !decision.silent) {
      const windowOpen = !!input.inbound_message_id || (await isSessionWindowOpen(contact.id));
      const template = windowOpen ? null : await activeSessionTemplate();
      for (const m of decision.messages) {
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
}) {
  const { contact, decision, interpretation, agent, message } = args;
  const now = new Date().toISOString();

  // inbound + outbound transcript
  try {
    await supabaseAdmin.from("interactions").insert({
      contact_id: contact.id,
      type: "whatsapp_message",
      source: "tamar_inbound",
      content: message,
    } as any);
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
      offer_ids: decision.offer_ids,
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
