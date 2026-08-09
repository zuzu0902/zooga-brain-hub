import { describe, it, expect } from "vitest";
import {
  buildManagerAlertComponents,
  buildManagerAlertParams,
  buildManagerAlertText,
  buildTranscriptDigest,
  MANAGER_ALERT_PARAM_MAX,
  looksTechnical,
} from "@/lib/handoff-template-params";

const alexZRow = {
  customer_name: "Alex Z",
  customer_phone: "0501234567",
  latest_inbound_message: "אני רוצה לדבר עם נציג לגבי הטיול לאלבניה",
  handoff_reason: "llm_decision_handoff",
  urgency: "normal",
  conversation_excerpt: [
    { ts: "1", source: "customer_inbound", content: "יש טיול לאלבניה?" },
    { ts: "2", source: "tamar", content: "כן, יש טיול לאלבניה בספטמבר" },
    { ts: "3", source: "customer_inbound", content: "אפשר לדבר עם מישהו?" },
    { ts: "4", source: "tamar", content: "כמובן, מעבירה לנציג" },
  ],
};

describe("manager alert template mapping", () => {
  it("maps the exact component order name/phone/context", () => {
    const { components } = buildManagerAlertComponents(alexZRow);
    expect(components).toHaveLength(1);
    expect(components[0].type).toBe("body");
    const p = components[0].parameters;
    expect(p.map((x: any) => x.type)).toEqual(["text", "text", "text"]);
    expect(p[0].text).toBe("Alex Z");
    expect(p[1].text).toBe("+972501234567");
    expect(p[2].text).toContain("בקשה אחרונה");
  });

  it("never leaks technical reason/urgency values into parameters", () => {
    const { components } = buildManagerAlertComponents(alexZRow);
    const serialized = JSON.stringify(components);
    expect(serialized).not.toContain("llm_decision_handoff");
    expect(serialized).not.toContain('"normal"');
    expect(looksTechnical("llm_decision_handoff")).toBe(true);
    expect(looksTechnical("normal")).toBe(true);
    expect(looksTechnical("Alex Z")).toBe(false);
  });

  it("falls back across phone sources and flags missing data", () => {
    expect(buildManagerAlertParams({ customer_phone: null, contact_whatsapp_number: "972501112222" }).phone).toBe(
      "+972501112222",
    );
    expect(buildManagerAlertParams({ contact_phone: "050-111-2233" }).phone).toBe("+972501112233");
    const none = buildManagerAlertParams({ customer_name: null });
    expect(none.phone).toBe("מספר לא זמין");
    expect(none.name).toBe("ללא שם");
    expect(none.dataIssues).toContain("missing_callback_phone");
    // a technical enum is never accepted as a phone
    expect(buildManagerAlertParams({ customer_phone: "llm_decision_handoff" }).phone).toBe("מספר לא זמין");
  });

  it("uses transcript, then latest message, then last-resort fallback", () => {
    expect(buildTranscriptDigest(alexZRow.conversation_excerpt, null)).toContain("תמר:");
    expect(buildTranscriptDigest(null, "רוצה נציג")).toContain("רוצה נציג");
    expect(buildTranscriptDigest(null, null)).toBe("הלקוח ביקש לחזור אליו");
    expect(buildTranscriptDigest(null, null, "en")).toBe("The customer asked to be called back");
  });

  it("keeps only the last 6 turns, in order", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ source: "customer_inbound", content: `m${i}` }));
    const digest = buildTranscriptDigest(many, null);
    expect(digest).not.toContain("m5");
    expect(digest.indexOf("m6")).toBeLessThan(digest.indexOf("m11"));
  });

  it("sanitizes newlines and enforces Meta length limits", () => {
    const long = buildManagerAlertParams({
      customer_name: "A",
      customer_phone: "0500000000",
      latest_inbound_message: "ש\n\nלום   " + "א".repeat(2000),
    });
    expect(long.context.length).toBeLessThanOrEqual(MANAGER_ALERT_PARAM_MAX);
    expect(long.context).not.toMatch(/[\r\n\t]/);
  });

  it("supports english labels", () => {
    const p = buildManagerAlertParams({ customer_phone: "0500000000", latest_inbound_message: "need an agent" }, "en");
    expect(p.context).toContain("Latest request");
  });

  it("in-window free text carries the same mapping", () => {
    const text = buildManagerAlertText({ ...alexZRow, crm_link: "/contacts/x", escalation_count: 2 });
    expect(text).toContain("+972501234567");
    expect(text).not.toContain("llm_decision_handoff");
    expect(text).toContain("תזכורת #2");
  });
});