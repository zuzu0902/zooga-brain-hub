/**
 * TAMAR LITE — AI adapter INTERFACE ONLY (stage 1).
 *
 * Hard boundary: the model may extract facts and draft text. It may never
 * change state, decide consent/handoff, pick an offer to send, or send.
 * Stage 1 ships a no-op adapter so no model call is made on live contacts.
 */
export type LiteAdapterInput = {
  text: string;
  transcript: string[];
  known_facts: Record<string, unknown>;
  question_key: string | null;
  question_text: string | null;
  /** offer ids already chosen by the deterministic selector */
  offer_ids: string[];
};

export type LiteAdapterOutput = {
  /** normalized facts, keyed by intake field_key */
  facts: Record<string, string>;
  /** draft only; never sent in shadow mode */
  draft: { text: string } | null;
  model_metadata: Record<string, unknown>;
};

export interface LiteAiAdapter {
  readonly id: string;
  extractAndDraft(input: LiteAdapterInput): Promise<LiteAdapterOutput>;
}

/** Stage 1 default: no model call, no facts, no draft. */
export const noopLiteAdapter: LiteAiAdapter = {
  id: "noop-shadow",
  async extractAndDraft() {
    return { facts: {}, draft: null, model_metadata: { adapter: "noop-shadow", called: false } };
  },
};

let current: LiteAiAdapter = noopLiteAdapter;

export function getLiteAdapter(): LiteAiAdapter {
  return current;
}

/** Test-only injection point; production stays on the no-op adapter. */
export function setLiteAdapter(adapter: LiteAiAdapter) {
  current = adapter;
}