/**
 * AGENT-CENTRIC MIGRATION — outbound delivery audit endpoint.
 *
 * Hostinger Gateway executes the WhatsApp send and reports the result here.
 * This route ONLY records that delivery in the existing CRM/history/audit
 * structures (messages + webhook_logs). It never sends anything, never
 * mutates arbitrary data and never logs secrets or credentials.
 *
 * Idempotent by provider_message_id, or by inbound_message_id + status when
 * the provider id is absent.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone } from "@/lib/phone";
import { authorizeGatewayRequest, jsonResponse } from "@/lib/zooga-gateway/gateway-route-auth.server";

export const AUDIT_SOURCE = "gateway_delivery_audit";
export const ALLOWED_DELIVERY_STATUS = ["sent", "delivered", "read", "failed"] as const;
export type DeliveryStatus = (typeof ALLOWED_DELIVERY_STATUS)[number];

export const AUDIT_LIMITS = {
  maxBodyBytes: 8192,
  maxTextChars: 4000,
  maxIdChars: 200,
};

/** Maps a Gateway delivery status onto the CRM message_status enum. */
export function toMessageStatus(status: DeliveryStatus): "sent" | "failed" {
  return status === "failed" ? "failed" : "sent";
}

export type AuditInput = {
  phone: string;
  inbound_message_id: string | null;
  provider_message_id: string | null;
  text: string;
  status: DeliveryStatus;
};

export function validateAuditBody(body: any): { ok: true; value: AuditInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };

  const extra = Object.keys(body).filter(
    (k) => !["phone", "inbound_message_id", "provider_message_id", "text", "status"].includes(k),
  );
  if (extra.length) return { ok: false, error: "unsupported_field" };

  const phone = normalizePhone(body.phone);
  if (!phone) return { ok: false, error: "invalid_phone" };

  const status = String(body.status ?? "");
  if (!(ALLOWED_DELIVERY_STATUS as readonly string[]).includes(status)) {
    return { ok: false, error: "invalid_status" };
  }

  const text = String(body.text ?? "").trim();
  if (!text || text.length > AUDIT_LIMITS.maxTextChars) return { ok: false, error: "invalid_text" };

  const inbound = body.inbound_message_id ? String(body.inbound_message_id).trim() : "";
  const provider = body.provider_message_id ? String(body.provider_message_id).trim() : "";
  if (inbound.length > AUDIT_LIMITS.maxIdChars || provider.length > AUDIT_LIMITS.maxIdChars) {
    return { ok: false, error: "invalid_message_id" };
  }
  if (!inbound && !provider) return { ok: false, error: "message_id_required" };

  return {
    ok: true,
    value: {
      phone,
      inbound_message_id: inbound || null,
      provider_message_id: provider || null,
      text,
      status: status as DeliveryStatus,
    },
  };
}

async function findDuplicate(input: AuditInput): Promise<boolean> {
  if (input.provider_message_id) {
    const { data } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("provider_message_id", input.provider_message_id)
      .limit(1)
      .maybeSingle();
    if (data) return true;
  }
  if (input.inbound_message_id) {
    const { data } = await supabaseAdmin
      .from("webhook_logs")
      .select("id")
      .eq("source", AUDIT_SOURCE)
      .eq("status", input.status)
      .eq("payload->>inbound_message_id", input.inbound_message_id)
      .limit(1)
      .maybeSingle();
    if (data) return true;
  }
  return false;
}

export const Route = createFileRoute("/api/public/runtime/tamar-delivery-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorized = await authorizeGatewayRequest(request);
        if (!authorized) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

        const raw = await request.text();
        if (raw.length > AUDIT_LIMITS.maxBodyBytes) {
          return jsonResponse({ ok: false, error: "payload_too_large" }, 413);
        }
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return jsonResponse({ ok: false, error: "invalid_body" }, 400);
        }

        const validated = validateAuditBody(parsed);
        if (!validated.ok) return jsonResponse({ ok: false, error: validated.error }, 400);
        const input = validated.value;

        if (await findDuplicate(input)) {
          return jsonResponse({ ok: true, duplicate: true, recorded: false });
        }

        const { data: contact } = await supabaseAdmin
          .from("contacts")
          .select("id")
          .eq("phone", input.phone)
          .limit(1)
          .maybeSingle();
        const contactId = (contact as any)?.id ?? null;

        let messageRecorded = false;
        if (contactId) {
          const { error } = await supabaseAdmin.from("messages").insert({
            contact_id: contactId,
            channel: "WhatsApp",
            message_text: input.text,
            status: toMessageStatus(input.status),
            sent_at: input.status === "failed" ? null : new Date().toISOString(),
            provider_message_id: input.provider_message_id,
          } as any);
          messageRecorded = !error;
        }

        await supabaseAdmin.from("webhook_logs").insert({
          source: AUDIT_SOURCE,
          status: input.status,
          error: null,
          payload: {
            executor: "hostinger_gateway",
            contact_id: contactId,
            inbound_message_id: input.inbound_message_id,
            provider_message_id: input.provider_message_id,
            message_recorded: messageRecorded,
          },
        } as any);

        if (input.inbound_message_id && input.provider_message_id) {
          await supabaseAdmin
            .from("runtime_inbound_dedupe" as any)
            .update({ source: `gateway:${input.provider_message_id}` } as any)
            .eq("inbound_message_id", input.inbound_message_id);
        }

        return jsonResponse({
          ok: true,
          duplicate: false,
          recorded: true,
          contact_known: !!contactId,
        });
      },
    },
  },
});
