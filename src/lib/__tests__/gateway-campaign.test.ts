import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { buildCampaignPayload, classifyGatewayStatus, CampaignInput, GATEWAY_CAMPAIGN_PATH } from "../gateway-campaign.functions";

describe("gateway campaign", () => {
  it("builds payload with 5s delay", () => {
    expect(buildCampaignPayload("t", [{ phone: "972501234567" }])).toEqual({
      template_name: "t", language_code: "he", delay_seconds: 5, contacts: [{ phone: "972501234567", name: "" }],
    });
  });
  it("requires explicit confirmation", () => {
    const base = { template_name: "t", contacts: [{ phone: "972501234567" }] };
    expect(() => CampaignInput.parse(base)).toThrow();
    expect(() => CampaignInput.parse({ ...base, confirmed: false })).toThrow();
    expect(CampaignInput.parse({ ...base, confirmed: true }).confirmed).toBe(true);
  });
  it("classifies failures", () => {
    expect(classifyGatewayStatus(202)).toBeNull();
    expect(classifyGatewayStatus(401)).toBe("gateway_unauthorized");
    expect(classifyGatewayStatus(404)).toBe("gateway_route_not_found");
  });
  it("uses one route, no hardcoded host or token in UI", () => {
    expect(GATEWAY_CAMPAIGN_PATH).toBe("/v1/campaign/trigger");
    const ui = readFileSync("src/components/quick-campaign.tsx", "utf8");
    expect(ui).not.toMatch(/https?:\/\/|\bfetch\(|token/i);
    const srv = readFileSync("src/lib/gateway-campaign.functions.ts", "utf8");
    expect(srv).not.toMatch(/segapo\.com|X-Zooga-Token/);
  });
});
