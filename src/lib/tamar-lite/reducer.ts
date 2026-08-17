/**
 * TAMAR LITE — the single deterministic reducer. Pure: no I/O, no model
 * calls, no sending. Same input always produces the same decision.
 *
 * Priority (fixed): opted out > handoff/human owned > consent >
 * direct question / topic shift (answer, then resume the missing field) >
 * baseline intake > sales.
 *
 * The next intake question comes ONLY from the canonical resolver in
 * `@/lib/intake-next-question`. Question order is never duplicated here.
 */
import { getNextMissingIntakeQuestion } from "@/lib/intake-next-question";
import type { IntakeSnapshot } from "@/lib/onboarding/baseline-intake";
import type { IntakeFieldDefinition } from "@/lib/onboarding/types";
import type { LiteAction, LiteConversation, LiteDecision, LiteInbound } from "./types";

export type ReducerInput = {
  conversation: LiteConversation;
  inbound: LiteInbound;
  defs: IntakeFieldDefinition[];
  snapshot: IntakeSnapshot;
  consentGranted: boolean;
  optedOut: boolean;
  humanOwned: boolean;
  /** candidate offers already filtered + ranked by the pure sales selector */
  offerCandidates: string[];
  /** facts extracted from this inbound (adapter output, may be empty) */
  facts?: Record<string, string>;
};

function emptyAction(reason: string[]): LiteAction {
  return {
    kind: "none",
    outbound_key: null,
    question_key: null,
    question_text: null,
    resume_question_key: null,
    offer_ids: [],
    reason_codes: reason,
  };
}

function key(wamid: string, kind: string, suffix?: string | null) {
  return [wamid, kind, suffix ?? ""].filter(Boolean).join(":");
}

export function reduceLite(input: ReducerInput): LiteDecision {
  const before = input.conversation;
  const { inbound } = input;
  const facts = input.facts ?? {};
  const next = getNextMissingIntakeQuestion(input.defs, input.snapshot);

  let after: LiteConversation = { ...before, last_inbound_wamid: inbound.wamid };
  let action: LiteAction;

  if (input.optedOut || inbound.is_opt_out) {
    after = { ...after, phase: "opted_out", current_question_key: null };
    action = emptyAction(["opt_out"]);
    action.kind = "stop";
  } else if (input.humanOwned || before.human_owned || inbound.is_handoff_request) {
    after = { ...after, phase: "human_owned", human_owned: true };
    action = emptyAction([inbound.is_handoff_request ? "handoff_requested" : "human_owned"]);
    action.kind = "handoff";
    action.outbound_key = null;
  } else if (!input.consentGranted && !inbound.consent_granted) {
    after = { ...after, phase: "awaiting_consent", current_question_key: null };
    action = emptyAction(["consent_missing"]);
    action.kind = "ask_consent";
    action.outbound_key = key(inbound.wamid, "ask_consent");
  } else if (inbound.is_direct_question || inbound.is_topic_shift) {
    // The customer owns this turn. We answer, then come back to the same
    // missing field — the intake never consumes a question as an answer.
    after = {
      ...after,
      phase: next ? "intake" : "sales_ready",
      current_question_key: next?.field_key ?? null,
    };
    action = emptyAction([inbound.is_direct_question ? "direct_question" : "topic_shift"]);
    action.kind = "answer_question_then_resume";
    action.resume_question_key = next?.field_key ?? null;
    action.outbound_key = key(inbound.wamid, "answer");
  } else if (next) {
    // A known fact is never asked again: the canonical resolver already
    // excludes every field present in the snapshot (city/region included).
    after = { ...after, phase: "intake", current_question_key: next.field_key };
    action = emptyAction(["intake_next_question"]);
    action.kind = "ask_intake_question";
    action.question_key = next.field_key;
    action.question_text = next.question_text;
    action.outbound_key = key(inbound.wamid, "intake", next.field_key);
  } else if (input.offerCandidates.length) {
    after = { ...after, phase: "sales_conversation", current_question_key: null };
    action = emptyAction(["sales_candidates"]);
    action.kind = "present_offers";
    action.offer_ids = input.offerCandidates.slice(0, 3);
    action.outbound_key = key(inbound.wamid, "offers");
  } else {
    after = { ...after, phase: "sales_ready", current_question_key: null };
    action = emptyAction(["no_offer_candidates"]);
  }

  after = {
    ...after,
    version: before.version + 1,
    last_outbound_key: action.outbound_key ?? before.last_outbound_key,
  };

  return {
    state_before: before,
    state_after: after,
    action,
    facts,
    reason_codes: action.reason_codes,
    shadow: true,
  };
}