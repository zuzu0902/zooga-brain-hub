import { describe, it, expect } from "vitest";
import { parseBulk, cleanPhone, maskPhone } from "../phone-bulk";
import { buildCampaignPayload } from "../gateway-campaign.functions";

describe("phone-bulk", () => {
  it("normalizes formats", () => {
    expect(cleanPhone("054-123 4567")).toBe("972541234567");
    expect(cleanPhone("541234567")).toBe("972541234567");
    expect(cleanPhone("+972 (54) 123.4567")).toBe("972541234567");
    expect(cleanPhone("00972541234567")).toBe("972541234567");
    expect(cleanPhone("123@g.us")).toBeNull();
    expect(cleanPhone("abc")).toBeNull();
  });
  it("parses names, dedupes, reports invalid", () => {
    const r = parseBulk("0541234567, דנה\n972541234567\njunk\n\n0521112222\tיוסי");
    expect(r.valid).toEqual([
      { phone: "972541234567", name: "דנה" },
      { phone: "972521112222", name: "יוסי" },
    ]);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toEqual(["junk"]);
  });
  it("masks", () => expect(maskPhone("972541234567")).toBe("97254••••567"));
  it("payload has delay_seconds 5", () => {
    expect(buildCampaignPayload("tamar_intro", [{ phone: "972541234567", name: null }])).toEqual({
      template_name: "tamar_intro", language_code: "he", delay_seconds: 5,
      contacts: [{ phone: "972541234567", name: "" }],
    });
  });
});
