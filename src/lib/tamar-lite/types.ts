/**
 * TAMAR LITE — stage 1 types (pure, client-safe).
 *
 * SHADOW ONLY. Nothing in the tamar-lite namespace may send a WhatsApp
 * message, mutate `contacts`, or touch the legacy conversation state.
 */

export type LitePhase =
  | "awaiting_consent"
  | "intake"
  | "sales_ready"
  | "sales_conversation"
  | "human_owned"
  | "opted_out"
  | "closed";

export type LiteConversation = {
  contact_id: string;
  phase: LitePhase;
  current_question_key: string | null;
  version: number;
  last_inbound_wamid: string | null;
  last_outbound_key: string | null;
  human_owned: boolean;
};

export type LiteInbound = {
  wamid: string;
  text: string;
  meta_timestamp: string | null;
  source_type: "text" | "voice" | "interactive";
  /** deterministic signals resolved before the reducer runs */
  is_opt_out: boolean;
  is_handoff_request: boolean;
  is_direct_question: boolean;
  is_topic_shift: boolean;
  consent_granted: boolean;
};

export type LiteActionKind =
  | "none"
  | "ask_consent"
  | "ask_intake_question"
  | "answer_question_then_resume"
  | "present_offers"
  | "handoff"
  | "stop";

export type LiteAction = {
  kind: LiteActionKind;
  /** outbound dedupe key; the outbox is never drained in stage 1 */
  outbound_key: string | null;
  question_key: string | null;
  question_text: string | null;
  resume_question_key: string | null;
  offer_ids: string[];
  reason_codes: string[];
};

export type LiteDecision = {
  state_before: LiteConversation;
  state_after: LiteConversation;
  action: LiteAction;
  facts: Record<string, string>;
  reason_codes: string[];
  /** always true in stage 1 */
  shadow: true;
};