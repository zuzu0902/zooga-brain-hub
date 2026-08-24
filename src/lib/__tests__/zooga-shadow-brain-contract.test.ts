import { describe, it, expect } from "vitest";
import {
  SHADOW_BRAIN_ACTIONS,
  SHADOW_BRAIN_STATES,
  SHADOW_BRAIN_MODEL_ID,
  SHADOW_BRAIN_PROMPT_VERSION,
  SHADOW_BRAIN_OUTPUT_SCHEMA,
  SHADOW_BRAIN_REQUEST_CONTRACT,
  MAX_REASON_CODES,
  validateShadowBrainOutput,
  normalizeReasonCodes,
  estimateCostUsd,
  sanitizeBrainStatus,
  EMPTY_BRAIN_STATUS,
} from "@/lib/zooga-gateway/shadow-brain-contract";

describe("Zooga shadow brain output contract", () => {
  it("targets gpt-5.6-luna through the Responses API with store=false and no tools", () => {
    expect(SHADOW_BRAIN_MODEL_ID).toBe("gpt-5.6-luna");
    expect(SHADOW_BRAIN_REQUEST_CONTRACT.api).toBe("responses");
    expect(SHADOW_BRAIN_REQUEST_CONTRACT.store).toBe(false);
    expect(SHADOW_BRAIN_REQUEST_CONTRACT.tools).toHaveLength(0);
    expect(SHADOW_BRAIN_REQUEST_CONTRACT.tool_choice).toBe("none");
    expect(SHADOW_BRAIN_REQUEST_CONTRACT.prompt_version).toBe(SHADOW_BRAIN_PROMPT_VERSION);
  });

  it("exposes only the four structured output fields", () => {
    expect(Object.keys(SHADOW_BRAIN_OUTPUT_SCHEMA.schema.properties).sort()).toEqual([
      "action",
      "confidence",
      "reason_codes",
      "state_after",
    ]);
    expect(SHADOW_BRAIN_OUTPUT_SCHEMA.schema.additionalProperties).toBe(false);
    expect(SHADOW_BRAIN_OUTPUT_SCHEMA.strict).toBe(true);
  });

  it("accepts a valid structured decision", () => {
    const r = validateShadowBrainOutput({
      action: "recommend_offer",
      state_after: "offer_recommended",
      reason_codes: ["intake_complete", "offer_match"],
      confidence: 0.72,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.action).toBe("recommend_offer");
      expect(r.output.reason_codes).toEqual(["intake_complete", "offer_match"]);
    }
  });

  it("rejects free text, unknown enums and out-of-range confidence", () => {
    expect(validateShadowBrainOutput(null).ok).toBe(false);
    expect(validateShadowBrainOutput("send this message").ok).toBe(false);
    expect(
      validateShadowBrainOutput({ action: "send_whatsapp", state_after: "closed", confidence: 1 }).ok,
    ).toBe(false);
    expect(
      validateShadowBrainOutput({ action: "noop", state_after: "not_a_state", confidence: 1 }).ok,
    ).toBe(false);
    expect(
      validateShadowBrainOutput({ action: "noop", state_after: "closed", confidence: 1.4 }).ok,
    ).toBe(false);
  });

  it("drops free-text or oversized reason codes and caps the array", () => {
    expect(normalizeReasonCodes(["ok_code", "שלום", "has space", "A".repeat(80)])).toEqual(["ok_code"]);
    expect(normalizeReasonCodes(Array.from({ length: 30 }, (_, i) => `code_${i}`))).toHaveLength(
      MAX_REASON_CODES,
    );
  });

  it("never lets a message draft or contact data survive validation", () => {
    const r = validateShadowBrainOutput({
      action: "noop",
      state_after: "closed",
      reason_codes: [],
      confidence: 0,
      message: "היי מירב",
      phone: "+972501234567",
      contact_id: "abc",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.output).sort()).toEqual([
      "action",
      "confidence",
      "reason_codes",
      "state_after",
    ]);
  });

  it("computes cost deterministically", () => {
    expect(
      estimateCostUsd({ inputTokens: 1000, outputTokens: 200, inputCostPer1k: 0.00125, outputCostPer1k: 0.01 }),
    ).toBeCloseTo(0.00325, 6);
    expect(
      estimateCostUsd({ inputTokens: -5, outputTokens: 0, inputCostPer1k: 1, outputCostPer1k: 1 }),
    ).toBe(0);
  });

  it("uses only closed action/state vocabularies", () => {
    expect(SHADOW_BRAIN_ACTIONS).toContain("noop");
    expect(SHADOW_BRAIN_ACTIONS).not.toContain("send_message");
    expect(SHADOW_BRAIN_STATES).toContain("human_handoff_queued");
  });
});

describe("Zooga shadow brain admin status sanitizer", () => {
  it("defaults to OFF and zeroed counters", () => {
    expect(sanitizeBrainStatus(null)).toEqual(EMPTY_BRAIN_STATUS);
    expect(EMPTY_BRAIN_STATUS.enabled).toBe(false);
  });

  it("drops any unexpected field, including anything key-shaped", () => {
    const out = sanitizeBrainStatus({
      enabled: true,
      model_id: "gpt-5.6-luna",
      requests_today: 3,
      cost_usd_today: 0.001234,
      api_key: "sk-live-should-never-appear",
      openai_api_key: "sk-nope",
      phone: "+972501234567",
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("972");
    expect(Object.keys(out).sort()).toEqual(Object.keys(EMPTY_BRAIN_STATUS).sort());
    expect(out.requests_today).toBe(3);
  });
});
