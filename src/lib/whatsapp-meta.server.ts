/**
 * META WHATSAPP TRANSPORT — the only outbound/inbound WhatsApp channel.
 *
 * Inbound : Meta Cloud API webhook -> verifyMetaSignature + parseInboundMessages
 * Outbound: Graph API /messages via WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID
 *
 * Secrets are read from process.env inside functions only. No token is ever
 * stored in a business table, logged, or returned to a caller.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GRAPH_VERSION = "v21.0";

/**
 * Meta returns recipients as bare digits ("972501234567") while the CRM stores
 * E.164 ("+972501234567"). Every callback match MUST go through these.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

/** All spellings a phone may appear as in our own tables. */
export function phoneVariants(raw: string | null | undefined): string[] {
  const e164 = toE164(raw);
  if (!e164) return [];
  return Array.from(new Set([e164, e164.slice(1)]));
}

export type InboundWhatsAppMessage = {
  wamid: string;
  from: string;
  text: string;
  name: string | null;
  business_phone_number_id: string | null;
  timestamp: string | null;
};

export type MetaStatusUpdate = {
  wamid: string;
  status: string;
  recipient: string | null;
  error: string | null;
};

/** Verify Meta's X-Hub-Signature-256 over the RAW request body. */
export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return false;
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const got = header.slice("sha256=".length).trim();
  const a = Buffer.from(got, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** GET hub-challenge verification. Returns the challenge or null. */
export function verifyHubChallenge(url: URL): string | null {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.META_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) return challenge;
  return null;
}

/** Extract text messages from a Meta WhatsApp webhook payload. */
export function parseInboundMessages(payload: any): InboundWhatsAppMessage[] {
  const out: InboundWhatsAppMessage[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;
      const phoneId = value?.metadata?.phone_number_id ?? null;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      for (const msg of value.messages ?? []) {
        const text =
          msg?.text?.body ??
          msg?.button?.text ??
          msg?.interactive?.list_reply?.title ??
          msg?.interactive?.button_reply?.title ??
          "";
        if (!msg?.id || !msg?.from) continue;
        const profile = contacts.find((c: any) => c?.wa_id === msg.from);
        out.push({
          wamid: String(msg.id),
          from: String(msg.from),
          text: String(text ?? "").trim(),
          name: profile?.profile?.name ?? null,
          business_phone_number_id: phoneId,
          timestamp: msg?.timestamp ? String(msg.timestamp) : null,
        });
      }
    }
  }
  return out;
}

/** Extract delivery-status callbacks (sent/delivered/read/failed). */
export function parseStatusUpdates(payload: any): MetaStatusUpdate[] {
  const out: MetaStatusUpdate[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const s of change?.value?.statuses ?? []) {
        if (!s?.id) continue;
        out.push({
          wamid: String(s.id),
          status: String(s.status ?? "unknown"),
          recipient: s?.recipient_id ? String(s.recipient_id) : null,
          error: s?.errors?.[0]?.title ?? null,
        });
      }
    }
  }
  return out;
}

export type SendResult = {
  ok: boolean;
  provider_message_id: string | null;
  status: number;
  error: string | null;
};

async function graphSend(body: any): Promise<SendResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    return { ok: false, provider_message_id: null, status: 0, error: "whatsapp_credentials_missing" };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        provider_message_id: null,
        status: res.status,
        error: String(json?.error?.message ?? `meta_${res.status}`).slice(0, 300),
      };
    }
    return {
      ok: true,
      provider_message_id: json?.messages?.[0]?.id ?? null,
      status: res.status,
      error: null,
    };
  } catch (e: any) {
    return { ok: false, provider_message_id: null, status: 0, error: String(e?.message ?? e).slice(0, 300) };
  }
}

export function sendWhatsAppText(to: string, text: string): Promise<SendResult> {
  return graphSend({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: true, body: text },
  });
}

export function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode = "he",
  components?: any[],
): Promise<SendResult> {
  return graphSend({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components?.length ? { components } : {}),
    },
  });
}

/** Persist an outbound delivery attempt. Supabase is the delivery ledger. */
export async function recordDelivery(args: {
  contactId: string | null;
  offerId?: string | null;
  text: string;
  result: SendResult;
  inboundMessageId?: string | null;
  kind?: string;
}): Promise<void> {
  const { contactId, offerId = null, text, result, inboundMessageId = null, kind = "reply" } = args;
  try {
    if (contactId) {
      await supabaseAdmin.from("messages").insert({
        contact_id: contactId,
        offer_id: offerId,
        channel: "WhatsApp",
        message_text: text,
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? new Date().toISOString() : null,
      } as any);
    }
    await supabaseAdmin.from("webhook_logs").insert({
      source: "meta_whatsapp_send",
      status: result.ok ? "sent" : "failed",
      error: result.error,
      payload: {
        kind,
        contact_id: contactId,
        inbound_message_id: inboundMessageId,
        provider_message_id: result.provider_message_id,
        http_status: result.status,
      },
    } as any);
    if (inboundMessageId && result.provider_message_id) {
      await supabaseAdmin
        .from("runtime_inbound_dedupe" as any)
        .update({ source: `meta:${result.provider_message_id}` } as any)
        .eq("inbound_message_id", inboundMessageId);
    }
  } catch {
    /* delivery ledger must never break the webhook */
  }
}

/** Presence-only diagnostics. Never returns secret values. */
export function metaConfigPresence() {
  return {
    meta_app_secret: !!process.env.META_APP_SECRET,
    meta_verify_token: !!process.env.META_VERIFY_TOKEN,
    whatsapp_access_token: !!process.env.WHATSAPP_ACCESS_TOKEN,
    whatsapp_phone_number_id: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    lovable_api_key: !!process.env.LOVABLE_API_KEY,
  };
}
