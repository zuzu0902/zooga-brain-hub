import { describe, expect, it } from "vitest";
import {
  classifyPilotRows,
  isPilotOutreachEligible,
  pilotContactPatch,
  pilotImportCounts,
} from "@/lib/tamar-pilot/eligibility";
import { decidePilotLifecycle, PILOT_FOLLOWUP_HOURS } from "@/lib/tamar-pilot/lifecycle";
import {
  normalizeRelationshipStatus,
  isRemovedBaselineIntakeKey,
  relationshipStatusDefinition,
} from "@/lib/tamar-pilot/relationship-status";
import { sanitizeGrounding, isVerifiedLink } from "@/lib/tamar-pilot/grounding";
import { managerOutcomeBlockers, validateManagerOutcome } from "@/lib/tamar-pilot/manager-outcome";
import { planOutbound } from "@/lib/tamar-v2/envelope";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe("pilot eligibility", () => {
  it("classifies file rows and never implies consent", () => {
    const rows = classifyPilotRows({
      rows: [
        { full_name: "א", phone: "0501234567" },
        { full_name: "א שוב", phone: "050-123-4567" },
        { full_name: "ב", phone: "0529876543" },
        { full_name: "ג", phone: "123" },
      ],
      existing: [{ id: "c1", phone: "0529876543", opted_out_at: hoursAgo(1) }],
    });
    const counts = pilotImportCounts(rows);
    expect(counts.eligible).toBe(1);
    expect(counts.duplicate_in_file).toBe(1);
    expect(counts.opted_out).toBe(1);
    expect(counts.invalid_phone).toBe(1);
    const patch = pilotContactPatch({ batchId: "b", fileName: "f.csv", at: hoursAgo(0) });
    expect(Object.keys(patch).join()).not.toMatch(/consent/);
  });

  it("only allows outreach from a pilot file or an inbound-initiated contact", () => {
    expect(isPilotOutreachEligible({}).eligible).toBe(false);
    expect(isPilotOutreachEligible({ pilot_eligible_at: hoursAgo(1) }).eligible).toBe(true);
    expect(isPilotOutreachEligible({ last_inbound_at: hoursAgo(1) }).reason).toBe("inbound_initiated");
    expect(isPilotOutreachEligible({ pilot_eligible_at: hoursAgo(1), opted_out_at: hoursAgo(1) }).eligible).toBe(false);
  });
});

describe("48h no-answer lifecycle", () => {
  const base = { opener_sent_at: hoursAgo(60), followup_sent_at: null, no_response_at: null, last_inbound_at: null };

  it("waits for the window, then sends exactly one follow-up", () => {
    expect(decidePilotLifecycle({ ...base, opener_sent_at: hoursAgo(4) }).action).toBe("none");
    expect(decidePilotLifecycle(base).action).toBe("send_followup");
    expect(decidePilotLifecycle({ ...base, followup_sent_at: hoursAgo(2) }).action).toBe("none");
  });

  it("raises the alert once, then stops for good", () => {
    const due = { ...base, followup_sent_at: hoursAgo(PILOT_FOLLOWUP_HOURS + 1) };
    expect(decidePilotLifecycle(due).action).toBe("raise_no_response_alert");
    expect(decidePilotLifecycle({ ...due, no_response_at: hoursAgo(1) }).action).toBe("none");
  });

  it("stops on reply, consent, opt-out or human ownership", () => {
    expect(decidePilotLifecycle({ ...base, last_inbound_at: hoursAgo(10) }).reason).toBe("customer_replied");
    expect(decidePilotLifecycle({ ...base, consent_granted: true }).reason).toBe("consent_granted");
    expect(decidePilotLifecycle({ ...base, opted_out_at: hoursAgo(1) }).reason).toBe("opted_out");
    expect(decidePilotLifecycle({ ...base, human_owned: true }).reason).toBe("human_owned");
  });
});

describe("relationship status baseline intake", () => {
  it("is a menu with canonical values and drops the removed question", () => {
    const def = relationshipStatusDefinition();
    expect(def.presentation).toBe("menu");
    expect(def.options.map((o) => o.value)).toContain("widowed");
    expect(isRemovedBaselineIntakeKey("arriving_alone")).toBe(true);
    expect(isRemovedBaselineIntakeKey("relationship_status")).toBe(false);
  });

  it("normalizes Hebrew and English answers", () => {
    expect(normalizeRelationshipStatus("גרושה")).toBe("divorced");
    expect(normalizeRelationshipStatus("אלמן")).toBe("widowed");
    expect(normalizeRelationshipStatus("in relationship")).toBe("in_relationship");
    expect(normalizeRelationshipStatus("משהו אחר")).toBeNull();
  });
});

describe("outbound grounding", () => {
  const ctx = { allowedUrls: ["https://zooga.co.il/trip/1"] };

  it("keeps verified links and strips everything else", () => {
    expect(isVerifiedLink("https://zooga.co.il/trip/1/", ctx.allowedUrls)).toBe(true);
    const ok = sanitizeGrounding("הנה הקישור להרשמה: https://zooga.co.il/trip/1", ctx);
    expect(ok.violations).toEqual([]);
    const bad = sanitizeGrounding("שלום. תירשמי כאן https://evil.example/x", ctx);
    expect(bad.violations).toContain("unverified_link");
    expect(bad.text).toBe("שלום.");
  });

  it("never promises an ungrounded perk", () => {
    const res = sanitizeGrounding("יש לך הטבה מיוחדת של 20%. נשמח לראותך.", ctx);
    expect(res.violations).toContain("ungrounded_perk");
    expect(res.text).toBe("נשמח לראותך.");
  });

  it("applies the guard inside the single envelope plan", () => {
    const planned = planOutbound({
      messages: [{ kind: "text", body: "פרטים כאן https://evil.example/x" } as any],
      grounding: { allowedUrls: ctx.allowedUrls },
    });
    expect(planned.messages).toHaveLength(0);
    expect(planned.dropped[0]?.reason).toContain("unverified_link");
  });
});

describe("manager handoff outcome", () => {
  it("blocks a release without contact, outcome and summary", () => {
    expect(managerOutcomeBlockers({}).length).toBe(3);
    expect(() => validateManagerOutcome({ contacted: true, outcome: "sold" })).toThrow("manager_outcome_required");
  });

  it("accepts a complete manager record", () => {
    const out = validateManagerOutcome({
      contacted: true,
      outcome: "sold",
      summary: "דיברתי עם הלקוחה, נרשמה לטיול",
    });
    expect(out.outcome).toBe("sold");
    expect(out.manager_summary).toContain("נרשמה");
  });
});
