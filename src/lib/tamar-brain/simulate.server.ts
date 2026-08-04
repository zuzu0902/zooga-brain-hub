/**
 * DRY-RUN SIMULATOR — evaluates the Brain's deterministic layers and the
 * action planner for a synthetic turn. It never touches contacts, never
 * sends WhatsApp, and never persists a decision trace.
 */
import { classifyConsentReply } from "./consent";
import { detectHandoffSignal, isGoodbye, isUserQuestion } from "./signals";
import { allowedActionsForState, planNextAction } from "./action-planner.server";
import { retrieveKnowledge } from "./knowledge.server";
import { automationFrozen, type ConversationState } from "./state-machine";

export type SimulationResult = {
  state: ConversationState;
  automation_frozen: boolean;
  consent_classification: string;
  handoff_signal: ReturnType<typeof detectHandoffSignal>;
  user_question: boolean;
  goodbye: boolean;
  allowed_actions: string[];
  knowledge_hits: number;
  plan: Awaited<ReturnType<typeof planNextAction>> | null;
  notes: string[];
};

export async function simulateTurn(args: {
  message: string;
  state: ConversationState;
}): Promise<SimulationResult> {
  const { message, state } = args;
  const notes: string[] = [];
  const handoff = detectHandoffSignal(message);
  const frozen = automationFrozen(state);
  const allowed = allowedActionsForState(state);

  if (frozen) notes.push("automation frozen for this state — Tamar stays silent");
  if (handoff.handoff) notes.push(`deterministic handoff: ${handoff.reason}`);
  if (state === "consent_pending") notes.push("consent gate active — no intake, no marketing");

  const hits = frozen || handoff.handoff ? [] : await retrieveKnowledge(message, 3);
  const plan =
    frozen || handoff.handoff || state === "consent_pending"
      ? null
      : await planNextAction({
          state,
          message,
          knownFields: {},
          unknownFields: ["age_range", "region", "preferred_trip_style"],
          allowedActions: allowed,
          turnCount: 1,
          answeredCount: 0,
          userAskedQuestion: isUserQuestion(message),
          offerTitles: [],
          knowledgeSnippets: hits.map((h) => h.content),
          campaignSource: null,
          emotionalTone: null,
        });

  return {
    state,
    automation_frozen: frozen,
    consent_classification: classifyConsentReply(message),
    handoff_signal: handoff,
    user_question: isUserQuestion(message),
    goodbye: isGoodbye(message),
    allowed_actions: allowed,
    knowledge_hits: hits.length,
    plan,
    notes,
  };
}