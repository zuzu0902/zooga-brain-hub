/**
 * Agent-centric migration — Lovable is intelligence + CRM/audit only.
 *
 * Covers: gateway authorization parity with tamar-turn, no Meta sender
 * reachable from tamar-generate, the exact minimal response contract,
 * mandatory meta_message_id idempotency, and the delivery-audit contract.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_DELIVERY_STATUS,
  AUDIT_SOURCE,
  toMessageStatus,
  validateAuditBody,
} from "@/routes/api/public/runtime/tamar-delivery-audit";
import { extractBearerToken } from "@/lib/zooga-gateway/gateway-route-auth.server";

const GENERATE_SRC = readFileSync("src/routes/api/public/runtime/tamar-generate.ts", "utf8");
const AUDIT_SRC = readFileSync("src/routes/api/public/runtime/tamar-delivery-audit.ts", "utf8");
const AUTH_SRC = readFileSync("src/lib/zooga-gateway/gateway-route-auth.server.ts", "utf8");
const TURN_SRC = readFileSync("src/routes/api/public/runtime/tamar-turn.ts", "utf8");
const ENGINE_SRC = readFileSync("src/lib/tamar-engine.server.ts", "utf8");
const HANDOFF_SRC = readFileSync("src/lib/tamar-handoff-core.server.ts", "utf8");

describe("authorization", () => {
  it("validates the gateway credential only through the database digest RPC", () => {
    expect(AUTH_SRC).toContain("zooga_core_gateway_authorized");
    expect(AUTH_SRC).not.toMatch(/[0-9a-f]{64}/);
    for (const src of [GENERATE_SRC, AUDIT_SRC]) {
      expect(src).toContain("authorizeGatewayRequest");
      expect(src).toContain('json({ ok: false, error: "unauthorized" }'.replace("json", "jsonResponse"));
      expect(src).not.toMatch(/[0-9a-f]{64}/);
    }
  });

  it("parses bearer tokens defensively", () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("Bearer short")).toBeNull();
    expect(extractBearerToken("Token " + "x".repeat(40))).toBeNull();
    expect(extractBearerToken("Bearer " + "x".repeat(40))).toBe("x".repeat(40));
  });

  it("leaves the legacy tamar-turn route behaviour unchanged", () => {
    expect(TURN_SRC).toContain("zooga_core_gateway_authorized");
    expect(TURN_SRC).toContain("x-api-token");
    expect(TURN_SRC).toContain("runTamarTurn(body)");
    expect(TURN_SRC).not.toContain("gateway_execution");
  });
});

describe("tamar-generate never reaches Meta", () => {
  it("imports no WhatsApp sender", () => {
    expect(GENERATE_SRC).not.toMatch(/whatsapp-meta/);
    expect(GENERATE_SRC).not.toMatch(/sendWhatsApp(Text|Template)/);
    expect(GENERATE_SRC).toContain("suppress_outbound: true");
  });

  it("keeps the engine free of a direct Meta sender", () => {
    expect(ENGINE_SRC).not.toMatch(/from "@\/lib\/whatsapp-meta\.server"/);
  });

  it("defers the only transitive send (manager alert) on the suppressed path", () => {
    expect(ENGINE_SRC).toContain("deferManagerAlert: body?.suppress_outbound === true");
    expect(HANDOFF_SRC).toContain("input.deferManagerAlert");
    expect(HANDOFF_SRC).toContain("gateway_execution_deferred");
    // the deferral branch precedes any notify call
    expect(HANDOFF_SRC.indexOf("input.deferManagerAlert")).toBeLessThan(
      HANDOFF_SRC.indexOf("await notifyManagerForHandoff(handoffId)"),
    );
  });

  it("still enforces the inbound allowlist before any engine work", () => {
    expect(GENERATE_SRC.indexOf("gateInboundForCanary")).toBeLessThan(GENERATE_SRC.indexOf("runTamarTurn("));
    expect(GENERATE_SRC).toContain('error: "blocked"');
  });
});

describe("tamar-generate response contract", () => {
  it("returns exactly the minimal gateway contract", () => {
    const block = GENERATE_SRC.slice(GENERATE_SRC.indexOf("return jsonResponse({\n          ok: true,"));
    for (const key of ["ok: true", "reply_text", "trace_id", "duplicate", "runtime_mode: GENERATE_RUNTIME_MODE"]) {
      expect(block).toContain(key);
    }
    expect(GENERATE_SRC).toContain('export const GENERATE_RUNTIME_MODE = "gateway_execution"');
    expect(block).not.toContain("contact_id");
  });

  it("requires a stable meta_message_id, a message and a phone", () => {
    expect(GENERATE_SRC).toContain('error: "meta_message_id_required"');
    expect(GENERATE_SRC).toContain('error: "message_required"');
    expect(GENERATE_SRC).toContain('error: "phone_required"');
    expect(GENERATE_SRC.indexOf("meta_message_id_required")).toBeLessThan(GENERATE_SRC.indexOf("runTamarTurn("));
  });

  it("relies on engine idempotency keyed on meta_message_id", () => {
    expect(GENERATE_SRC).toContain("duplicate: payload.duplicate === true");
    expect(ENGINE_SRC).toContain('.eq("raw_payload->>meta_message_id", metaMessageId)');
  });
});

describe("delivery audit", () => {
  const base = {
    phone: "0547702620",
    inbound_message_id: "wamid.IN",
    provider_message_id: "wamid.OUT",
    text: "שלום",
    status: "sent",
  };

  it("accepts a strict valid payload and normalizes the phone", () => {
    const res = validateAuditBody(base);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.phone).toBe("+972547702620");
      expect(res.value.status).toBe("sent");
    }
  });

  it("rejects unknown fields, bad status, bad phone, empty text and missing ids", () => {
    expect(validateAuditBody({ ...base, human_owned: true })).toEqual({ ok: false, error: "unsupported_field" });
    expect(validateAuditBody({ ...base, status: "queued" })).toEqual({ ok: false, error: "invalid_status" });
    expect(validateAuditBody({ ...base, phone: "abc" })).toEqual({ ok: false, error: "invalid_phone" });
    expect(validateAuditBody({ ...base, text: "" })).toEqual({ ok: false, error: "invalid_text" });
    expect(
      validateAuditBody({ ...base, inbound_message_id: null, provider_message_id: null }),
    ).toEqual({ ok: false, error: "message_id_required" });
    expect(validateAuditBody(null)).toEqual({ ok: false, error: "invalid_body" });
  });

  it("maps gateway statuses onto the CRM message status", () => {
    expect([...ALLOWED_DELIVERY_STATUS]).toEqual(["sent", "delivered", "read", "failed"]);
    expect(toMessageStatus("delivered")).toBe("sent");
    expect(toMessageStatus("read")).toBe("sent");
    expect(toMessageStatus("failed")).toBe("failed");
  });

  it("is idempotent by provider id, then by inbound id + status", () => {
    expect(AUDIT_SRC).toContain('.eq("provider_message_id", input.provider_message_id)');
    expect(AUDIT_SRC).toContain('.eq("payload->>inbound_message_id", input.inbound_message_id)');
    expect(AUDIT_SRC).toContain("duplicate: true, recorded: false");
    expect(AUDIT_SRC.indexOf("findDuplicate(input)")).toBeLessThan(AUDIT_SRC.indexOf('.from("messages").insert'));
  });

  it("records only into existing audit structures and never sends", () => {
    expect(AUDIT_SOURCE).toBe("gateway_delivery_audit");
    expect(AUDIT_SRC).not.toMatch(/sendWhatsApp/);
    expect(AUDIT_SRC).not.toMatch(/whatsapp-meta/);
    // no arbitrary mutation surface
    expect(AUDIT_SRC).not.toMatch(/\.rpc\(/);
    expect(AUDIT_SRC).not.toMatch(/from\("contacts"\)[\s\S]{0,40}\.update/);
  });
});
