/**
 * TEMPORARY STATIC-REPLY DIAGNOSTIC — tightly scoped.
 *
 * For exactly one number (+972547702620 / 972547702620 / 0547702620) the
 * tamar-turn route answers with one fixed diagnostic text through the normal
 * Meta outbound path, instead of running the Tamar engine. Every other number
 * (including the primary canary +972512277533) is untouched.
 *
 * Idempotency reuses the canonical inbound dedupe ledger, so a retry of the
 * same meta_message_id never sends a second message.
 *
 * Remove this module when the diagnostic is finished.
 */
import { normalizePhone } from "@/lib/phone";
import { isGroupJid } from "./config";
import { claimInbound, recordReply } from "@/lib/runtime-inbound-dedupe";
import { recordDelivery, sendWhatsAppText, toE164 } from "@/lib/whatsapp-meta.server";

/** The only number the static bypass applies to. */
export const STATIC_BYPASS_PHONE_E164 = "+972547702620";

/** Exact diagnostic text. */
export const STATIC_BYPASS_TEXT = "Lovable Static Bypass Test - Loko is watching";

export const STATIC_BYPASS_RUNTIME_MODE = "lovable_static_bypass";

const onlyDigits = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/** True only for +972547702620 / 972547702620 / 0547702620. */
export function isStaticBypassPhone(phone: unknown): boolean {
  if (phone == null) return false;
  const raw = String(phone).trim();
  if (!raw || isGroupJid(raw)) return false;
  const target = STATIC_BYPASS_PHONE_E164.replace(/\D/g, "");
  const digits = onlyDigits(raw);
  if (digits === target || digits === "0" + target.slice(3)) return true;
  const normalized = normalizePhone(raw);
  return !!normalized && onlyDigits(normalized) === target;
}

export type StaticBypassResult = {
  ok: true;
  reply_text: string;
  reply_sent: boolean;
  runtime_mode: typeof STATIC_BYPASS_RUNTIME_MODE;
  duplicate: boolean;
};

/**
 * Send the fixed diagnostic reply once per inbound message id.
 * No secret and no customer message text is ever logged here.
 */
export async function runStaticBypass(args: {
  phone: string | null | undefined;
  metaMessageId: string | null;
}): Promise<StaticBypassResult> {
  const to = toE164(args.phone) ?? STATIC_BYPASS_PHONE_E164;
  const wamid = String(args.metaMessageId ?? "").trim();

  if (wamid) {
    const claim = await claimInbound({
      inboundMessageId: wamid,
      phone: to,
      source: STATIC_BYPASS_RUNTIME_MODE,
    });
    if (claim.duplicate) {
      return {
        ok: true,
        reply_text: STATIC_BYPASS_TEXT,
        reply_sent: false,
        runtime_mode: STATIC_BYPASS_RUNTIME_MODE,
        duplicate: true,
      };
    }
  }

  const result = await sendWhatsAppText(to, STATIC_BYPASS_TEXT);
  await recordDelivery({
    contactId: null,
    text: STATIC_BYPASS_TEXT,
    result,
    inboundMessageId: wamid || null,
    kind: STATIC_BYPASS_RUNTIME_MODE,
  });
  if (wamid && result.ok) await recordReply(wamid, STATIC_BYPASS_TEXT);

  return {
    ok: true,
    reply_text: STATIC_BYPASS_TEXT,
    reply_sent: result.ok,
    runtime_mode: STATIC_BYPASS_RUNTIME_MODE,
    duplicate: false,
  };
}
