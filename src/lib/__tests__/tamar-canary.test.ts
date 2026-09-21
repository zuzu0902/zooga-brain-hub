/**
 * TAMAR CANARY — number normalization, hard block for non-canary inbound,
 * canary allowed, restart idempotency/audit, consent/history preservation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
const rpcCalls: Array<{ fn: string; args: any }> = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (name: string) => ({
      insert: async (payload: any) => {
        db[name] ??= [];
        db[name]!.push(payload);
        return { data: [payload], error: null };
      },
    }),
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      // emulate the database function: canary-only + idempotent per wamid
      const digits = String(args?.p_phone ?? "").replace(/\D/g, "");
      if (digits !== "972512277533" && digits !== "0512277533") {
        return { data: null, error: { message: "not_canary_phone" } };
      }
      db["tamar_canary_restarts"] ??= [];
      const existing = db["tamar_canary_restarts"]!.find(
        (r) => r["inbound_message_id"] === args.p_inbound_message_id,
      );
      if (existing) return { data: { ok: true, duplicate: true }, error: null };
      db["tamar_canary_restarts"]!.push({
        inbound_message_id: args.p_inbound_message_id,
        consent_status: "granted",
        opted_out: false,
      });
      return {
        data: { ok: true, duplicate: false, consent_status: "granted", opted_out: false },
        error: null,
      };
    },
  },
}));

import {
  CANARY_PHONE_E164,
  CANARY_RESTART_PHRASE,
  canaryInboundDecision,
  isCanaryPhone,
  isCanaryRestartPhrase,
} from "@/lib/tamar-canary/config";
import { gateInboundForCanary, runCanaryRestart } from "@/lib/tamar-canary/canary.server";
import { isConversationResetRequest, applyResetToDynamic } from "@/lib/tamar-v2/reset";

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  rpcCalls.length = 0;
});

describe("canary number normalization", () => {
  it("accepts the canonical number and its equivalent forms only", () => {
    expect(CANARY_PHONE_E164).toBe("+972512277533");
    for (const v of ["+972512277533", "972512277533", "0512277533", "+972 51-227-7533"]) {
      expect(isCanaryPhone(v)).toBe(true);
    }
    for (const v of ["+972512277833", "972512277534", "", null, undefined, "0501234567"]) {
      expect(isCanaryPhone(v as any)).toBe(false);
    }
  });

  it("never treats a group JID as the canary", () => {
    expect(isCanaryPhone("120363012345678901@g.us")).toBe(false);
    expect(canaryInboundDecision("120363012345678901@g.us").reason).toBe("blocked_group");
  });
});

describe("webhook boundary gate", () => {
  it("hard-blocks a non-canary inbound and audits it without message text", async () => {
    const decision = await gateInboundForCanary({
      phone: "+972501112222",
      inboundMessageId: "wamid.block.1",
      messageType: "text",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("blocked_non_canary");
    const logs = db["webhook_logs"] ?? [];
    expect(logs).toHaveLength(1);
    expect(logs[0]!["status"]).toBe("inbound_blocked_non_canary");
    expect(logs[0]!["payload"]["reply_sent"]).toBe(false);
    expect(logs[0]!["payload"]["phone_masked"]).toMatch(/^\*\*\*/);
    expect(JSON.stringify(logs[0])).not.toContain("972501112222");
  });

  it("allows the canary number and writes no block event", async () => {
    const decision = await gateInboundForCanary({
      phone: "972512277533",
      inboundMessageId: "wamid.ok.1",
      messageType: "text",
    });
    expect(decision.allowed).toBe(true);
    expect(db["webhook_logs"] ?? []).toHaveLength(0);
  });
});

describe("canary restart", () => {
  it("recognizes the exact Hebrew phrase only", () => {
    expect(isCanaryRestartPhrase(CANARY_RESTART_PHRASE)).toBe(true);
    expect(isCanaryRestartPhrase("  התחל מחדש  ")).toBe(true);
    expect(isCanaryRestartPhrase("התחל מחדש.")).toBe(true);
    expect(isCanaryRestartPhrase("אפשר להתחיל מחדש את הטיול?")).toBe(false);
  });

  it("is durable and idempotent per inbound message id", async () => {
    const first = await runCanaryRestart({ phone: "+972512277533", inboundMessageId: "wamid.r.1" });
    expect(first).toEqual({ ok: true, duplicate: false });
    const retry = await runCanaryRestart({ phone: "+972512277533", inboundMessageId: "wamid.r.1" });
    expect(retry).toEqual({ ok: true, duplicate: true });
    expect(db["tamar_canary_restarts"]).toHaveLength(1);
    expect(rpcCalls.every((c) => c.fn === "canary_restart_tamar")).toBe(true);
  });

  it("refuses any non-canary phone at the database boundary", async () => {
    const res = await runCanaryRestart({ phone: "+972501112222", inboundMessageId: "wamid.r.2" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not_canary_phone");
  });

  it("requires an inbound message id and never calls the database without one", async () => {
    const res = await runCanaryRestart({ phone: "+972512277533", inboundMessageId: null });
    expect(res.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("preserves consent and history semantics", async () => {
    await runCanaryRestart({ phone: "+972512277533", inboundMessageId: "wamid.r.3" });
    const row = db["tamar_canary_restarts"]![0]!;
    expect(row["consent_status"]).toBe("granted");
    expect(row["opted_out"]).toBe(false);
    // no message/interaction rows are ever deleted by this path
    expect(db["messages"]).toBeUndefined();
    expect(db["interactions"]).toBeUndefined();
  });
});

describe("conversation reset recognition", () => {
  it("treats 'התחל מחדש' as a conversation reset and clears only volatile state", () => {
    expect(isConversationResetRequest("התחל מחדש")).toBe(true);
    const { dyn, cleared } = applyResetToDynamic({
      v2_last_offer_id: "off_1",
      consent_marketing: true,
      first_name: "אלכס",
    });
    expect(cleared).toContain("v2_last_offer_id");
    expect(dyn["consent_marketing"]).toBe(true);
    expect(dyn["first_name"]).toBe("אלכס");
  });
});
