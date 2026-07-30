/**
 * META WHATSAPP WEBHOOK — the single live entrypoint of Zooga OS.
 *
 *   Meta WhatsApp -> this route -> Tamar engine (Supabase + Lovable AI)
 *                 -> Meta Graph API send -> Supabase delivery ledger
 *
 * GET  : hub.challenge verification against META_VERIFY_TOKEN.
 * POST : X-Hub-Signature-256 HMAC verification against META_APP_SECRET.
 *        Invalid signature => 401, nothing is processed.
 *        Idempotency: runtime_inbound_dedupe keyed by Meta wamid. A retry
 *        never calls the model and never sends a second WhatsApp message.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runTamarTurn } from "@/lib/tamar-engine.server";
import { claimInbound, recordReply } from "@/lib/runtime-inbound-dedupe";
import {
  parseInboundMessages,
  parseStatusUpdates,
  recordDelivery,
  sendWhatsAppText,
  verifyHubChallenge,
  verifyMetaSignature,
} from "@/lib/whatsapp-meta.server";

const WA_STATUS_MAP: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

async function applyStatusUpdates(payload: any) {
  const statuses = parseStatusUpdates(payload);
  if (!statuses.length) return 0;
  for (const s of statuses) {
    await supabaseAdmin.from("webhook_logs").insert({
      source: "meta_whatsapp_status",
      status: s.status,
      error: s.error,
      payload: { provider_message_id: s.wamid, recipient: s.recipient },
    } as any);
    const mapped = WA_STATUS_MAP[s.status];
    if (mapped && s.recipient) {
      await supabaseAdmin
        .from("imported_leads")
        .update({
          whatsapp_template_status: mapped as any,
          last_message_at: new Date().toISOString(),
          ...(s.status === "failed" ? { import_status: "failed" as any } : {}),
        } as any)
        .eq("phone", s.recipient)
        .eq("whatsapp_template_status", "sent");
    }
  }
  return statuses.length;
}

export const Route = createFileRoute("/api/public/webhook/tamar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const challenge = verifyHubChallenge(new URL(request.url));
        if (challenge) return new Response(challenge, { status: 200 });
        return new Response("forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        const raw = await request.text();
        const signature = request.headers.get("x-hub-signature-256");
        if (!verifyMetaSignature(raw, signature)) {
          await supabaseAdmin.from("webhook_logs").insert({
            source: "meta_whatsapp",
            status: "rejected_invalid_signature",
            error: "invalid_signature",
            payload: { signature_present: !!signature },
          } as any);
          return new Response(JSON.stringify({ error: "invalid_signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let payload: any = null;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response(JSON.stringify({ error: "invalid_json" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const statusCount = await applyStatusUpdates(payload);
        const messages = parseInboundMessages(payload);
        if (!messages.length) {
          return Response.json({ ok: true, processed: 0, statuses: statusCount });
        }

        const results: any[] = [];
        for (const msg of messages) {
          // ---- Idempotency gate (wamid) BEFORE any model call or send ----
          const claim = await claimInbound({
            inboundMessageId: msg.wamid,
            phone: msg.from,
            source: "meta_whatsapp",
          });
          if (claim.duplicate) {
            await supabaseAdmin.from("webhook_logs").insert({
              source: "meta_whatsapp",
              status: "duplicate_inbound_suppressed",
              payload: {
                inbound_message_id: msg.wamid,
                duplicate_detected: true,
                reply_sent: false,
                hit_count: claim.hit_count,
              },
            } as any);
            results.push({ wamid: msg.wamid, duplicate: true, reply_sent: false });
            continue;
          }

          await supabaseAdmin.from("webhook_logs").insert({
            source: "meta_whatsapp",
            status: "received",
            payload: {
              inbound_message_id: msg.wamid,
              from_present: !!msg.from,
              has_text: !!msg.text,
            },
          } as any);

          if (!msg.text) {
            results.push({ wamid: msg.wamid, skipped: "unsupported_message_type" });
            continue;
          }

          const turn = await runTamarTurn({
            message: msg.text,
            phone: msg.from,
            whatsapp_number: msg.from,
            name: msg.name,
            source: "whatsapp",
            meta_message_id: msg.wamid,
            meta_timestamp: msg.timestamp,
          });

          const replyText: string = turn.payload?.reply_text ?? "";
          if (turn.status !== 200 || !replyText) {
            results.push({
              wamid: msg.wamid,
              reply_sent: false,
              error: turn.payload?.error ?? "no_reply",
              trace_id: turn.payload?.trace_id ?? null,
            });
            continue;
          }

          const send = await sendWhatsAppText(msg.from, replyText);
          await recordDelivery({
            contactId: turn.payload?.contact_id ?? null,
            offerId: turn.payload?.meta?.offer_id ?? null,
            text: replyText,
            result: send,
            inboundMessageId: msg.wamid,
          });
          await recordReply(msg.wamid, replyText).catch(() => {});

          if (turn.payload?.trace_id) {
            await supabaseAdmin
              .from("tamar_runtime_executions" as any)
              .update({
                raw_payload: {
                  ...(turn.payload?.raw_payload ?? {}),
                  delivery: {
                    transport: "meta_direct",
                    ok: send.ok,
                    provider_message_id: send.provider_message_id,
                    http_status: send.status,
                    error: send.error,
                  },
                },
              } as any)
              .eq("id", turn.payload.trace_id);
          }

          results.push({
            wamid: msg.wamid,
            contact_id: turn.payload?.contact_id ?? null,
            trace_id: turn.payload?.trace_id ?? null,
            reply_sent: send.ok,
            provider_message_id: send.provider_message_id,
            send_error: send.error,
            handoff_requested: !!turn.payload?.handoff_requested,
          });
        }

        return Response.json({ ok: true, processed: results.length, statuses: statusCount, results });
      },
    },
  },
});
