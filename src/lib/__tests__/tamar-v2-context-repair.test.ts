/**
 * TAMAR V2 — repair regression for the verified production failure:
 * zero context snapshots, focus drift to unrelated offers, and a bad voice
 * token ("בקבוק") merged with stale travel context.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_FOCUS, nextFocus, readFocus, withFocus } from "@/lib/tamar-v2/focus";
import { normalizeVoiceTranscript, voiceClarificationText } from "@/lib/tamar-v2/voice-normalize";
import { RESET_CLEAR_KEYS, applyResetToDynamic } from "@/lib/tamar-v2/reset";

describe("authoritative active focus", () => {
  const baku = { topic: "טיול לבאקו", offer_id: "off_baku", provenance: "explicit_mention" as const, updated_at: "t0" };

  it("a recommendation or ranking can never move the focus", () => {
    const { focus, changed } = nextFocus({
      current: baku,
      resolvedOfferId: "off_vietnam",
      resolvedTitle: "וייטנאם 60+",
      resolutionReason: "ranked",
      productAsked: true,
    });
    expect(changed).toBe(false);
    expect(focus.offer_id).toBe("off_baku");
  });

  it("a referential phrase resolves to the SAME focused offer, not another one", () => {
    const { focus, changed } = nextFocus({
      current: baku,
      resolvedOfferId: "off_baku",
      resolvedTitle: "טיול לבאקו",
      resolutionReason: "context",
      productAsked: true,
    });
    expect(changed).toBe(false);
    expect(focus.offer_id).toBe("off_baku");
  });

  it("a context resolution cannot override an existing focus", () => {
    const { focus } = nextFocus({
      current: baku,
      resolvedOfferId: "off_vietnam",
      resolutionReason: "context",
      productAsked: true,
    });
    expect(focus.offer_id).toBe("off_baku");
  });

  it("an explicit mention of another offer does move the focus", () => {
    const { focus, changed } = nextFocus({
      current: baku,
      resolvedOfferId: "off_vietnam",
      resolvedTitle: "וייטנאם 60+",
      resolutionReason: "exact",
      productAsked: true,
    });
    expect(changed).toBe(true);
    expect(focus.offer_id).toBe("off_vietnam");
    expect(focus.provenance).toBe("explicit_mention");
  });

  it("a reset clears the focus and the reset also strips it from durable state", () => {
    const { focus } = nextFocus({ current: baku, resetRequested: true });
    expect(focus.offer_id).toBeNull();
    expect(RESET_CLEAR_KEYS as readonly string[]).toContain("v2_focus");
    const dyn = withFocus({ region: "מרכז" }, baku);
    expect(readFocus(dyn).offer_id).toBe("off_baku");
    const after = applyResetToDynamic(dyn).dyn;
    expect(readFocus(after)).toEqual(EMPTY_FOCUS);
    expect(after["region"]).toBe("מרכז");
  });
});

describe("voice normalization is audited, never a silent guess", () => {
  const catalog = ["טיול לבאקו", "טיול לוייטנאם 60+", "מסיבת פורים"];

  it("corrects a domain token against the active focus and reports the reason", () => {
    const n = normalizeVoiceTranscript({ raw: "כמה עולה הטיול לבאקוו?", focusTitle: "טיול לבאקו", catalogTitles: catalog });
    expect(n.raw).toBe("כמה עולה הטיול לבאקוו?");
    expect(n.normalized).toContain("באקו");
    expect(n.changed).toBe(true);
    expect(n.reason).toContain("domain_entity_correction");
    expect(n.confidence).toBeGreaterThan(0);
  });

  it("leaves ordinary speech untouched", () => {
    const n = normalizeVoiceTranscript({ raw: "אני רוצה לשמוע פרטים", focusTitle: "טיול לבאקו", catalogTitles: catalog });
    expect(n.changed).toBe(false);
    expect(n.normalized).toBe(n.raw);
  });

  it("a low-confidence near-match is never rewritten silently", () => {
    const n = normalizeVoiceTranscript({ raw: "מה עם באקוני הזה?", focusTitle: "טיול לבאקו", catalogTitles: catalog });
    expect(n.changed).toBe(false);
    expect(n.ambiguous).toBe(true);
    expect(n.reason).toBe("low_confidence_domain_match");
  });

  it("asks one concise clarification instead of guessing", () => {
    expect(voiceClarificationText()).toContain("?");
    expect(voiceClarificationText().length).toBeLessThan(200);
  });
});
