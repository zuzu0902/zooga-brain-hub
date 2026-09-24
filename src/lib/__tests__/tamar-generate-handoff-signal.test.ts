import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tamar-engine.server", () => ({ runTamarTurn: vi.fn() }));
vi.mock("@/lib/tamar-canary/canary.server", () => ({ gateInboundForCanary: vi.fn() }));
vi.mock("@/lib/zooga-gateway/gateway-route-auth.server", () => ({
  authorizeGatewayRequest: vi.fn(),
  jsonResponse: vi.fn(),
}));

const { deriveHandoffSignal } = await import("@/routes/api/public/runtime/tamar-generate");
const SRC = readFileSync("src/routes/api/public/runtime/tamar-generate.ts", "utf8");
const H = "11111111-2222-4333-8444-555555555555";

describe("tamar-generate handoff signal", () => {
  it("true with opaque id when this turn requested a handoff", () => {
    expect(deriveHandoffSignal({ handoff_requested: true, handoff: { id: H, alert_error: "x" } }, null)).toEqual({
      handoff_requested: true,
      handoff_id: H,
    });
  });

  it("true without id when the handoff row is unavailable", () => {
    expect(deriveHandoffSignal({ handoff_requested: true, handoff: null }, null)).toEqual({
      handoff_requested: true,
      handoff_id: null,
    });
  });

  it("false for an ordinary turn, ignoring stray handoff objects", () => {
    expect(deriveHandoffSignal({ handoff_requested: false, handoff: { id: H } }, null)).toEqual({
      handoff_requested: false,
      handoff_id: null,
    });
    expect(deriveHandoffSignal({}, null).handoff_requested).toBe(false);
  });

  it("duplicate is false unless a stored handoff for the same trace proves it", () => {
    expect(deriveHandoffSignal({ duplicate: true, handoff_requested: true }, null)).toEqual({
      handoff_requested: false,
      handoff_id: null,
    });
    expect(deriveHandoffSignal({ duplicate: true, handoff_requested: false }, H)).toEqual({
      handoff_requested: true,
      handoff_id: H,
    });
  });

  it("never returns non-opaque ids", () => {
    expect(deriveHandoffSignal({ handoff_requested: true, handoff: { id: "+972500000000" } }, null).handoff_id).toBeNull();
    expect(deriveHandoffSignal({ duplicate: true }, "phone").handoff_requested).toBe(false);
  });

  it("route still never imports a Meta sender and only looks up by trace", () => {
    expect(SRC).not.toMatch(/whatsapp-meta|sendWhatsApp/);
    expect(SRC).toContain("suppress_outbound: true");
    expect(SRC).toContain('.eq("runtime_trace_id", traceId)');
    expect(SRC).not.toMatch(/customer_phone|latest_inbound_message/);
  });
});
