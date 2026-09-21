/**
 * TAMAR CANARY — server side of the inbound canary gate.
 *
 *  - `recordBlockedInbound` writes ONE minimal auditable event for a blocked
 *    non-canary inbound. No message text is stored; the phone is masked.
 *  - `runCanaryRestart` performs the narrowly scoped, durable restart through
 *    the constrained `canary_restart_tamar` database function. It is
 *    idempotent per Meta wamid and never impersonates a UI admin user.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { maskPhone } from "@/lib/zero-loss/core";
import {
  CANARY_BLOCK_SOURCE,
  CANARY_BLOCK_STATUS,
  canaryInboundDecision,
  type CanaryGateDecision,
} from "./config";

export { CANARY_PHONE_E164, CANARY_RESTART_PHRASE, isCanaryPhone, isCanaryRestartPhrase } from "./config";

/** Decide + audit in one call at the webhook boundary. */
export async function gateInboundForCanary(args: {
  phone: string | null | undefined;
  inboundMessageId: string | null;
  messageType?: string | null;
}): Promise<CanaryGateDecision> {
  const decision = canaryInboundDecision(args.phone);
  if (decision.allowed) return decision;
  await recordBlockedInbound({ ...args, reason: decision.reason });
  return decision;
}

export async function recordBlockedInbound(args: {
  phone: string | null | undefined;
  inboundMessageId: string | null;
  messageType?: string | null;
  reason: string;
}): Promise<void> {
  try {
    await supabaseAdmin.from("webhook_logs").insert({
      source: CANARY_BLOCK_SOURCE,
      status: CANARY_BLOCK_STATUS,
      payload: {
        // minimal, non-sensitive: no message text is ever stored here
        inbound_message_id: args.inboundMessageId,
        phone_masked: maskPhone(args.phone ?? null),
        message_type: args.messageType ?? null,
        reason: args.reason,
        reply_sent: false,
      },
    } as any);
  } catch {
    /* auditing must never break the webhook acknowledgement */
  }
}

export type CanaryRestartResult = {
  ok: boolean;
  duplicate: boolean;
  error?: string;
};

/**
 * Durable restart for the canary contact only. The phone constraint is
 * enforced again inside the database function, so a wrong caller cannot
 * widen the scope.
 */
export async function runCanaryRestart(args: {
  phone: string | null | undefined;
  inboundMessageId: string | null;
}): Promise<CanaryRestartResult> {
  const wamid = String(args.inboundMessageId ?? "").trim();
  if (!wamid) return { ok: false, duplicate: false, error: "inbound_message_id_required" };
  try {
    const { data, error } = await (supabaseAdmin as any).rpc("canary_restart_tamar", {
      p_phone: String(args.phone ?? ""),
      p_inbound_message_id: wamid,
    });
    if (error) return { ok: false, duplicate: false, error: String(error.message ?? error).slice(0, 200) };
    return { ok: (data as any)?.ok === true, duplicate: (data as any)?.duplicate === true };
  } catch (err: any) {
    return { ok: false, duplicate: false, error: String(err?.message ?? err).slice(0, 200) };
  }
}
