/**
 * Temporary static-reply diagnostic: exact scoping + idempotency.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";

const claimInbound = vi.fn();
const recordReply = vi.fn();
const sendWhatsAppText = vi.fn();
const recordDelivery = vi.fn();

vi.mock("@/lib/runtime-inbound-dedupe", () => ({
  claimInbound: (...a: any[]) => claimInbound(...a),
  recordReply: (...a: any[]) => recordReply(...a),
}));
vi.mock("@/lib/whatsapp-meta.server", () => ({
  sendWhatsAppText: (...a: any[]) => sendWhatsAppText(...a),
  recordDelivery: (...a: any[]) => recordDelivery(...a),
  toE164: (v: any) => {
    const d = String(v ?? "").replace(/\D/g, "");
    return d ? "+" + d : null;
  },
}));

import {
  STATIC_BYPASS_TEXT,
  isStaticBypassPhone,
  runStaticBypass,
} from "@/lib/tamar-canary/static-bypass.server";

const TURN_SRC = readFileSync("src/routes/api/public/runtime/tamar-turn.ts", "utf8");

beforeEach(() => {
  claimInbound.mockReset().mockResolvedValue({ duplicate: false });
  recordReply.mockReset();
  sendWhatsAppText.mockReset().mockResolvedValue({ ok: true, provider_message_id: "wamid.out", status: 200, error: null });
  recordDelivery.mockReset();
});

describe("static bypass scoping", () => {
  it("matches only the bypass number in its normalized forms", () => {
    for (const v of ["+972547702620", "972547702620", "0547702620", "+972 54-770-2620"]) {
      expect(isStaticBypassPhone(v)).toBe(true);
    }
    for (const v of ["+972512277533", "972512277533", "0512277533", "+972501112222", "", null, "120363012345678901@g.us"]) {
      expect(isStaticBypassPhone(v as any)).toBe(false);
    }
  });

  it("runs after authorization and the canary gate, before runTamarTurn", () => {
    expect(TURN_SRC.indexOf("gateInboundForCanary")).toBeLessThan(TURN_SRC.indexOf("isStaticBypassPhone(phone)"));
    expect(TURN_SRC.indexOf("isStaticBypassPhone(phone)")).toBeLessThan(TURN_SRC.indexOf("runTamarTurn(body)"));
    expect(TURN_SRC.indexOf("authorize(request)")).toBeLessThan(TURN_SRC.indexOf("isStaticBypassPhone(phone)"));
  });
});

describe("static bypass behaviour", () => {
  it("sends the exact text once and reports the diagnostic runtime mode", async () => {
    const r = await runStaticBypass({ phone: "0547702620", metaMessageId: "wamid.A" });
    expect(r).toMatchObject({
      ok: true,
      reply_text: STATIC_BYPASS_TEXT,
      reply_sent: true,
      runtime_mode: "lovable_static_bypass",
      duplicate: false,
    });
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppText).toHaveBeenCalledWith("+972547702620", STATIC_BYPASS_TEXT);
    expect(recordReply).toHaveBeenCalledWith("wamid.A", STATIC_BYPASS_TEXT);
  });

  it("does not send twice for a repeated meta_message_id", async () => {
    claimInbound.mockResolvedValueOnce({ duplicate: true, cached_reply_text: STATIC_BYPASS_TEXT });
    const r = await runStaticBypass({ phone: "+972547702620", metaMessageId: "wamid.A" });
    expect(r.duplicate).toBe(true);
    expect(r.reply_sent).toBe(false);
    expect(r.reply_text).toBe(STATIC_BYPASS_TEXT);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });
});
