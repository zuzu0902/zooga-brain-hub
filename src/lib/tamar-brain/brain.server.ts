/**
 * TAMAR BRAIN v1 — orchestrator gate.
 *
 * Runs BEFORE the generative engine on every inbound turn and decides
 * deterministically whether the turn is:
 *   - frozen        (human_owned / handoff queued)  -> no automated reply
 *   - handoff       (supreme rule)                  -> ack + manager alert
 *   - consent flow  (pending / opted out)           -> scripted consent copy
 *   - pass          (consented)                     -> the agent engine runs
 *
 * The AI agent only acts inside the `pass` branch.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifyConsentReply, consentClarifyExhausted } from "./consent";
import { detectHandoffSignal, isGoodbye, isUserQuestion } from "./signals";
import { canTransition, deriveState, type ConversationState } from "./state-machine";
import { loadBrainPolicy, loadCopy } from "./copy.server";
import { ensureHandoff, HANDOFF_FROZEN_ACK_TEXT, HANDOFF_RECEIPT_TEXT } from "@/lib/tamar-handoff-core.server";
import { isOptInMessage, isOptOutMessage, OPT_OUT_CONFIRMATION } from "@/lib/optout";

export type BrainGate =
  | { kind: "pass"; state: ConversationState; handoff_signal: ReturnType<typeof detectHandoffSignal>; user_question: boolean; goodbye: boolean }
  | { kind: "reply"; state: ConversationState; text: string; reason: string; marketing: false }
  | { kind: "silent"; state: ConversationState; reason: string };

export async function applyTransition(args: {
  contactId: string | null;
  from: ConversationState;
  to: ConversationState;
  trigger: string;
  reasonCodes?: string[];
  actor?: string;
  patch?: Record<string, unknown>;
}): Promise<ConversationState> {
  const check = canTransition(args.from, args.to);
  if (!check.allowed) {
    console.warn("[tamar-brain] blocked transition", check.reason);
    return args.from;
  }
  if (!args.contactId) return check.noop ? args.from : args.to;

  await supabaseAdmin
    .from("contacts")
    .update({
      ...(args.patch ?? {}),
      conversation_state: args.to,
      conversation_state_at: new Date().toISOString(),
    } as any)
    .eq("id", args.contactId);

  if (!check.noop) {
    await supabaseAdmin.from("tamar_state_transitions" as any).insert({
      contact_id: args.contactId,
      from_state: args.from,
      to_state: args.to,
      trigger: args.trigger,
      reason_codes: args.reasonCodes ?? [],
      actor: args.actor ?? "system",
    } as any);
  }
  return args.to;
}

export type GateInput = {
  contact: any;
  message: string;
  interactions: any[];
  phone: string | null;
};

export async function runBrainGate(input: GateInput): Promise<BrainGate> {
  const contact = input.contact;
  const contactId = contact?.id ?? null;
  const message = String(input.message ?? "").trim();
  const policy = await loadBrainPolicy();
  const state = deriveState(contact);
  const handoffSignal = detectHandoffSignal(message);
  const userQuestion = isUserQuestion(message);
  const goodbye = isGoodbye(message);

  // ---------- 1. Human ownership freeze (highest precedence) ----------
  // Automation stays frozen (no selling, no questions) BUT Tamar is never
  // silent: the customer gets one acknowledgement and the message is
  // appended to the open handoff, re-escalating it under a cooldown.
  if (state === "human_owned" || state === "human_handoff_queued" || state === "paused") {
    await supabaseAdmin.from("webhook_logs").insert({
      source: "tamar_brain",
      status: "automation_frozen",
      payload: { contact_id: contactId, state, has_message: !!message },
    } as any);
    if (!message) return { kind: "silent", state, reason: `automation_frozen_${state}` };
    await ensureHandoff({
      contactId,
      customerPhone: input.phone,
      customerName: contact?.full_name ?? contact?.first_name ?? null,
      reason: "follow_up_while_human_owned",
      reasonCodes: ["frozen_followup", ...handoffSignal.reason_codes],
      urgency: handoffSignal.handoff ? handoffSignal.urgency : "normal",
      latestInbound: message,
      followUp: true,
      runtime: "v1",
    });
    return {
      kind: "reply",
      state,
      text: HANDOFF_FROZEN_ACK_TEXT,
      reason: `automation_frozen_${state}_ack`,
      marketing: false,
    };
  }

  // ---------- 2. Explicit opt-out at any time ----------
  if (isOptOutMessage(message)) {
    await applyTransition({
      contactId,
      from: state,
      to: "opted_out",
      trigger: "inbound_opt_out",
      reasonCodes: ["stop_word"],
      patch: { consent_marketing: false, opted_out_at: new Date().toISOString() },
    });
    return { kind: "reply", state: "opted_out", text: OPT_OUT_CONFIRMATION, reason: "opt_out", marketing: false };
  }

  // ---------- 3. Handoff — supreme rule ----------
  if (handoffSignal.handoff) {
    await ensureHandoff({
      contactId,
      customerPhone: input.phone,
      customerName: contact?.full_name ?? contact?.first_name ?? null,
      reason: handoffSignal.reason,
      reasonCodes: handoffSignal.reason_codes,
      urgency: handoffSignal.urgency,
      latestInbound: message,
      suggestedResponse: null,
      excerpt: (input.interactions ?? []).slice(0, 10).map((i: any) => ({
        ts: String(i?.timestamp ?? ""),
        source: String(i?.source ?? i?.type ?? ""),
        content: String(i?.content ?? ""),
      })),
      runtime: "v1",
    });
    await applyTransition({
      contactId,
      from: state,
      to: "human_handoff_queued",
      trigger: "handoff_signal",
      reasonCodes: handoffSignal.reason_codes,
    });
    return {
      kind: "reply",
      state: "human_handoff_queued",
      text: HANDOFF_RECEIPT_TEXT,
      reason: handoffSignal.reason,
      marketing: false,
    };
  }

  // ---------- 4. Opted-out contacts ----------
  if (state === "opted_out") {
    if (isOptInMessage(message)) {
      await applyTransition({
        contactId,
        from: state,
        to: "consented",
        trigger: "explicit_opt_in",
        patch: {
          consent_marketing: true,
          consent_date: new Date().toISOString(),
          consent_source: "whatsapp_opt_in",
          opted_out_at: null,
          consent_responded_at: new Date().toISOString(),
        },
      });
      const ack = await loadCopy("consent_yes_ack", { contactId });
      return { kind: "reply", state: "consented", text: ack.body, reason: "opt_in", marketing: false };
    }
    // The person initiated: a service answer is allowed, marketing is not.
    return {
      kind: "reply",
      state: "opted_out",
      text:
        "אני כאן ואשמח לעזור 🙂 שים לב שהוסרת מרשימת הדיוור, אז אני לא שולחת הצעות. אם תרצה שאמשיך לעדכן אותך — כתוב לי \"התחל\", ובכל שלב אפשר לבקש לדבר עם אדם.",
      reason: "opted_out_service_only",
      marketing: false,
    };
  }

  // ---------- 5. Consent gate ----------
  if (policy.consent_gate_enabled && state === "consent_pending") {
    const answer = classifyConsentReply(message);

    if (answer === "yes") {
      const copy = await loadCopy("consent_optin_template", { contactId });
      await applyTransition({
        contactId,
        from: state,
        to: "consented",
        trigger: "consent_yes",
        patch: {
          consent_marketing: true,
          consent_date: new Date().toISOString(),
          consent_source: "whatsapp_template_reply",
          consent_wording_version: `${copy.variant}.v${copy.version}`,
          consent_responded_at: new Date().toISOString(),
        },
      });
      const ack = await loadCopy("consent_yes_ack", { contactId });
      await applyTransition({ contactId, from: "consented", to: "intake_active", trigger: "consent_yes_to_intake" });
      return { kind: "reply", state: "intake_active", text: ack.body, reason: "consent_yes", marketing: false };
    }

    if (answer === "no") {
      await applyTransition({
        contactId,
        from: state,
        to: "opted_out",
        trigger: "consent_no",
        patch: {
          consent_marketing: false,
          opted_out_at: new Date().toISOString(),
          consent_source: "whatsapp_template_reply",
          consent_responded_at: new Date().toISOString(),
        },
      });
      if (contactId) {
        await supabaseAdmin
          .from("imported_leads")
          .update({ consent_status: "declined", opted_out_at: new Date().toISOString(), send_state: "opted_out" } as any)
          .eq("contact_id", contactId);
        await supabaseAdmin
          .from("campaign_contacts")
          .update({ opted_out_at: new Date().toISOString(), send_state: "opted_out" } as any)
          .eq("contact_id", contactId);
      }
      const close = await loadCopy("consent_no_close", { contactId });
      return { kind: "reply", state: "opted_out", text: close.body, reason: "consent_no", marketing: false };
    }

    // Ambiguous: exactly ONE clarification question, then wait.
    if (consentClarifyExhausted(input.interactions ?? [])) {
      return { kind: "silent", state, reason: "consent_ambiguous_already_clarified" };
    }
    const clarify = await loadCopy("consent_clarify", { contactId });
    return { kind: "reply", state, text: clarify.body, reason: "consent_ambiguous", marketing: false };
  }

  // ---------- 6. Consented: hand the turn to the agent ----------
  return { kind: "pass", state, handoff_signal: handoffSignal, user_question: userQuestion, goodbye };
}

/** Persist a decision trace (no unnecessary PII). */
export async function recordDecisionTrace(row: {
  contactId: string | null;
  runtimeExecutionId?: string | null;
  state: string;
  consideredActions: unknown;
  selectedAction: string;
  confidence?: number | null;
  reasonCodes?: string[];
  fieldsUsed?: string[];
  offerIds?: string[];
  knowledgeSourceIds?: string[];
  promptVersion?: string | null;
  model?: string | null;
  latencyMs?: number | null;
}): Promise<void> {
  try {
    await supabaseAdmin.from("tamar_decision_traces" as any).insert({
      contact_id: row.contactId,
      runtime_execution_id: row.runtimeExecutionId ?? null,
      state: row.state,
      considered_actions: row.consideredActions ?? [],
      selected_action: row.selectedAction,
      confidence: row.confidence ?? null,
      reason_codes: row.reasonCodes ?? [],
      fields_used: row.fieldsUsed ?? [],
      offer_ids: row.offerIds ?? [],
      knowledge_source_ids: row.knowledgeSourceIds ?? [],
      prompt_version: row.promptVersion ?? "tamar-brain-v1",
      model: row.model ?? null,
      latency_ms: row.latencyMs ?? null,
    } as any);
  } catch {
    /* traces must never break a turn */
  }
}