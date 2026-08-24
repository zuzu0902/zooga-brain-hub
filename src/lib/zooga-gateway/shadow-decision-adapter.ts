/**
 * ZOOGA OS SHADOW DECISION ADAPTER — DISABLED in this milestone.
 *
 * There is NO model call, NO network call and NO customer send here. The
 * default implementation always reports `adapter_disabled`; a deterministic
 * mock exists only so tests can exercise the comparison pipeline.
 */
import type { ShadowInputSignals, ShadowOutcome } from "./shadow-compare";

export type ShadowProposal = {
  outcome: ShadowOutcome | null;
  confidence: number | null;
  provider: string | null;
  model_id: string | null;
  model_version: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  /** Short code only. `adapter_disabled` means "intentionally off", not a failure. */
  error_code: string | null;
};

export const ADAPTER_DISABLED_CODE = "adapter_disabled";

export type ShadowDecisionAdapter = {
  readonly enabled: boolean;
  readonly name: string;
  propose(signals: ShadowInputSignals): Promise<ShadowProposal>;
};

function emptyProposal(errorCode: string | null): ShadowProposal {
  return {
    outcome: null,
    confidence: null,
    provider: null,
    model_id: null,
    model_version: null,
    latency_ms: null,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    error_code: errorCode,
  };
}

/** The only adapter wired in production. Never calls anything. */
export const disabledShadowAdapter: ShadowDecisionAdapter = {
  enabled: false,
  name: "disabled",
  async propose() {
    return emptyProposal(ADAPTER_DISABLED_CODE);
  },
};

/** Test-only deterministic adapter. Not referenced by any runtime path. */
export function createMockShadowAdapter(outcome: ShadowOutcome): ShadowDecisionAdapter {
  return {
    enabled: true,
    name: "mock",
    async propose() {
      return { ...emptyProposal(null), outcome, confidence: 1, provider: "mock", latency_ms: 0 };
    },
  };
}

export function getShadowDecisionAdapter(): ShadowDecisionAdapter {
  return disabledShadowAdapter;
}
