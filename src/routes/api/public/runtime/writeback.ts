/**
 * RUNTIME WRITEBACK — Railway brain → Lovable CRM bridge.
 *
 * Logs inbound + outbound turn into interactions, applies lead field
 * updates, and persists a runtime trace row. Replaces direct Supabase
 * writes from Railway.
 *
 * Auth: Authorization: Bearer <RUNTIME_BRIDGE_TOKEN>
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeRuntimeBridge, normalizePhone } from "@/lib/runtime-bridge-auth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-token",
};

const DYNAMIC_FIELDS = new Set([
  "preferred_destination",
  "preferred_time_window",
  "travel_companion_state",
  "current_offer_id",
]);

async function resolveContactId(body: any): Promise<string | null> {
  if (body.contact_id) return String(body.contact_id);
  const phone = normalizePhone(body.phone ?? body.whatsapp_number);
  if (!phone) return null;
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .or(`phone.eq.${phone},whatsapp_number.eq.${phone}`)
    .maybeSingle();
  return (data as any)?.id ?? null;
}

export const Route = createFileRoute("/api/public/runtime/writeback")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const unauthorized = await authorizeRuntimeBridge(request);
        if (unauthorized) return unauthorized;

        const body = await request.json().catch(() => ({} as any));
        const contactId = await resolveContactId(body);
        if (!contactId) {
          return new Response(
            JSON.stringify({ ok: false, error: "contact_not_resolved" }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }

        const messageId: string | null = body.message_id ?? null;
        const inboundText: string | null = body.inbound_text ?? null;
        const outboundText: string | null = body.outbound_text ?? null;
        const mode: string = String(body.mode ?? "unknown");
        const resolvedOfferId: string | null = body.resolved_offer_id ?? null;
        const lastPresentedOffers: any = body.last_presented_offers ?? null;

        // Idempotency: skip if we already logged this exact message_id.
        if (messageId) {
          const { data: existing } = await supabaseAdmin
            .from("webhook_logs")
            .select("id")
            .eq("source", "railway_runtime_writeback")
            .contains("payload", { message_id: messageId } as any)
            .limit(1)
            .maybeSingle();
          if (existing) {
            return new Response(
              JSON.stringify({ ok: true, idempotent: true }),
              { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }
        }

        const now = new Date().toISOString();
        const interactionRows: any[] = [];
        if (inboundText) {
          interactionRows.push({
            contact_id: contactId,
            type: "whatsapp_inbound",
            source: "railway_runtime",
            content: inboundText,
            related_offer_id: resolvedOfferId,
            timestamp: now,
          });
        }
        if (outboundText) {
          interactionRows.push({
            contact_id: contactId,
            type: "whatsapp_outbound",
            source: "railway_runtime",
            content: outboundText,
            related_offer_id: resolvedOfferId,
            timestamp: now,
          });
        }
        if (interactionRows.length) {
          await supabaseAdmin.from("interactions").insert(interactionRows);
        }

        // Apply lead updates — known columns straight through, unknown keys
        // (preferred_destination, etc.) into dynamic_profile_fields.
        const leadUpdates = (body.lead_updates ?? {}) as Record<string, any>;
        if (leadUpdates && typeof leadUpdates === "object") {
          const patch: Record<string, any> = {};
          const dynPatch: Record<string, any> = {};
          for (const [k, v] of Object.entries(leadUpdates)) {
            if (v === undefined || v === null) continue;
            if (k === "lead_stage") patch.intake_stage = v;
            else if (DYNAMIC_FIELDS.has(k)) dynPatch[k] = v;
            else patch[k] = v;
          }
          if (Object.keys(dynPatch).length) {
            const { data: c } = await supabaseAdmin
              .from("contacts")
              .select("dynamic_profile_fields")
              .eq("id", contactId)
              .maybeSingle();
            const prev = ((c as any)?.dynamic_profile_fields ?? {}) as Record<string, any>;
            patch.dynamic_profile_fields = { ...prev, ...dynPatch };
          }
          if (Object.keys(patch).length) {
            await supabaseAdmin.from("contacts").update(patch as any).eq("id", contactId);
          }
        }

        // Persist numbered-browse memory so the next turn can resolve "2" → offer.
        // CRITICAL: this list MUST match the numbered items in outbound_text
        // exactly (same items, order, numbering). If it doesn't, we reject the
        // write to prevent the next turn from resolving "3" to a stale offer
        // that the user never actually saw as item 3.
        let presentedRejected: { reason: string; missing?: string[] } | null = null;
        if (Array.isArray(lastPresentedOffers)) {
          const normalized = lastPresentedOffers
            .map((it: any, i: number) => ({
              index: Number(it?.index ?? i + 1),
              offer_id: it?.offer_id ?? it?.id ?? null,
              title: it?.title ?? null,
            }))
            .filter((it) => it.offer_id)
            .map((it, i) => ({ ...it, index: i + 1 }));

          // Validate against the rendered outbound, in order.
          if (outboundText && normalized.length) {
            let cursor = 0;
            const missing: string[] = [];
            for (const it of normalized) {
              if (!it.title) continue;
              const needle = `${it.index}. ${it.title}`;
              const found = outboundText.indexOf(needle, cursor);
              if (found < 0) {
                missing.push(needle);
              } else {
                cursor = found + needle.length;
              }
            }
            if (missing.length) {
              presentedRejected = { reason: "list_mismatch_with_outbound", missing };
            }
          }

          if (!presentedRejected) {
            await supabaseAdmin
              .from("contacts")
              .update({
                last_presented_offers: normalized,
                last_presented_offers_at: new Date().toISOString(),
              } as any)
              .eq("id", contactId);
          }
        }

        // Persist runtime trace row.
        const { data: traceRow } = await supabaseAdmin
          .from("tamar_runtime_executions" as any)
          .insert({
            contact_id: contactId,
            offer_id: resolvedOfferId,
            channel: "whatsapp",
            source: "railway_runtime_bridge",
            inbound_message: inboundText,
            outbound_reply: outboundText,
            runtime_mode: "zooga_pack",
            raw_payload: { ...body, mode, presented_rejected: presentedRejected },
          } as any)
          .select("id")
          .single();

        // Audit log for idempotency lookups.
        await supabaseAdmin.from("webhook_logs").insert({
          source: "railway_runtime_writeback",
          payload: {
            message_id: messageId,
            contact_id: contactId,
            mode,
            resolved_offer_id: resolvedOfferId,
          },
        } as any);

        return new Response(
          JSON.stringify({
            ok: true,
            trace_id: (traceRow as any)?.id ?? null,
            presented_rejected: presentedRejected,
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
        );
      },
    },
  },
});