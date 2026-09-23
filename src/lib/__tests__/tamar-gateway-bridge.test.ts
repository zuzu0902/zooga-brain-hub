/**
 * Hostinger Gateway -> Tamar active bridge.
 *
 * Covers: two-number allowlist, hard blocks, gateway credential scoped to the
 * tamar-turn route only, and idempotency (no second model call / send).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANARY_PHONES_E164,
  canaryInboundDecision,
  isCanaryPhone,
  isCanaryPrimaryPhone,
} from "@/lib/tamar-canary/config";
import { extractBearerToken } from "@/routes/api/public/runtime/tamar-turn";

const TURN_SRC = readFileSync("src/routes/api/public/runtime/tamar-turn.ts", "utf8");
const WEBHOOK_SRC = readFileSync("src/routes/api/public/webhook/tamar.ts", "utf8");
const OVERRIDE_SRC = readFileSync("src/lib/tamar-canary/handoff-override.server.ts", "utf8");
const ENGINE_SRC = readFileSync("src/lib/tamar-engine.server.ts", "utf8");

describe("two-number canary allowlist", () => {
  it("allows exactly the two authorized numbers in every normalized form", () => {
    expect([...CANARY_PHONES_E164]).toEqual(["+972512277533", "+972547702620"]);
    const allowed = [
      "+972512277533",
      "972512277533",
      "0512277533",
      "+972547702620",
      "972547702620",
      "0547702620",
      "+972 54-770-2620",
    ];
    for (const v of allowed) {
      expect(isCanaryPhone(v)).toBe(true);
      expect(canaryInboundDecision(v)).toEqual({ allowed: true, reason: "canary_allowed" });
    }
  });

  it("hard-blocks a third number and any group JID before model or send", () => {
    for (const v of ["+972501112222", "972547702621", "0501234567", "", null, undefined]) {
      expect(isCanaryPhone(v as any)).toBe(false);
      expect(canaryInboundDecision(v as any).allowed).toBe(false);
    }
    expect(canaryInboundDecision("+972501112222").reason).toBe("blocked_non_canary");
    expect(canaryInboundDecision("120363012345678901@g.us").reason).toBe("blocked_group");
    expect(isCanaryPhone("120363012345678901@g.us")).toBe(false);
  });

  it("keeps the handoff override and manager-alert suppression on the primary line only", () => {
    expect(isCanaryPrimaryPhone("+972512277533")).toBe(true);
    expect(isCanaryPrimaryPhone("+972547702620")).toBe(false);
    expect(OVERRIDE_SRC).toContain("isCanaryPrimaryPhone");
    expect(OVERRIDE_SRC).not.toContain("isCanaryPhone(");
  });
});

describe("tamar-turn bridge contract", () => {
  it("gates inbound before the engine runs", () => {
    expect(TURN_SRC.indexOf("gateInboundForCanary")).toBeLessThan(TURN_SRC.indexOf("runTamarTurn(body)"));
    expect(TURN_SRC).toContain('json({ ok: false, error: "blocked"');
  });

  it("accepts the gateway credential only through the database digest RPC", () => {
    expect(TURN_SRC).toContain("zooga_core_gateway_authorized");
    expect(TURN_SRC).toContain("x-api-token");
    // no hardcoded token or digest anywhere in the route
    expect(TURN_SRC).not.toMatch(/[0-9a-f]{64}/);
  });

  it("does not weaken any other route: the Meta webhook keeps signature verification", () => {
    expect(WEBHOOK_SRC).toContain("x-hub-signature-256");
    expect(WEBHOOK_SRC).not.toContain("zooga_core_gateway_authorized");
  });

  it("requires meta_message_id for gateway-origin events", () => {
    expect(TURN_SRC).toContain("meta_message_id_required");
    expect(TURN_SRC).toContain('auth.origin === "gateway" && !metaMessageId');
  });

  it("parses bearer tokens defensively", () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("Bearer short")).toBeNull();
    expect(extractBearerToken("Token " + "x".repeat(40))).toBeNull();
    expect(extractBearerToken("Bearer " + "x".repeat(40))).toBe("x".repeat(40));
  });
});

describe("idempotency", () => {
  it("replays a repeated meta_message_id without a second model call or send", () => {
    const idx = ENGINE_SRC.indexOf("idempotent_replay: true");
    expect(idx).toBeGreaterThan(0);
    expect(ENGINE_SRC).toContain('.eq("raw_payload->>meta_message_id", metaMessageId)');
    // the duplicate branch returns before contact resolution / engine execution
    expect(idx).toBeLessThan(ENGINE_SRC.indexOf("await resolveOrCreateContact(body)"));
  });
});
