/**
 * RUNTIME HANDOFF — Railway brain → Lovable CRM bridge.
 *
 * Persists a manager_handoffs row, flags the contact for the existing
 * Handoff Console, and forwards an alert to the configured manager
 * delivery target (api_settings.tamar_backend_url + /manager-alerts/handoff).
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

async function resolveContact(body: any): Promise<{ id: string; row: any } | null> {
  if (body.contact_id) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id, first_name, last_name, full_name, phone, whatsapp_number")
      .eq("id", body.contact_id)
      .maybeSingle();
    if (data) return { id: (data as any).id, row: data };
  }
  const phone = normalizePhone(body.phone ?? body.whatsapp_number);
  if (phone) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id, first_name, last_name, full_name, phone, whatsapp_number")
      .or(`phone.eq.${phone},whatsapp_number.eq.${phone}`)
      .maybeSingle();
    if (data) return { id: (data as any).id, row: data };
  }
  return null;
}

export const Route = createFileRoute("/api/public/runtime/handoff")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const unauthorized = await authorizeRuntimeBridge(request);
        if (unauthorized) return unauthorized;

        const body = await request.json().catch(() => ({} as any));
        const resolved = await resolveContact(body);
        if (!resolved) {
          return new Response(
            JSON.stringify({ ok: false, error: "contact_not_resolved" }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
        const contactId = resolved.id;
        const contact = resolved.row as any;

        const reason = String(body.reason ?? "unspecified");
        const latestInbound = body.latest_inbound_message ?? null;
        const latestOutbound = body.latest_outbound_message ?? null;
        const resolvedOfferId = body.resolved_offer_id ?? null;
        const trace = body.trace ?? null;

        const customerPhone =
          contact.phone ?? contact.whatsapp_number ?? normalizePhone(body.phone);
        const customerName =
          contact.full_name ??
          [contact.first_name, contact.last_name].filter(Boolean).join(" ") ??
          "Unknown WhatsApp contact";

        const excerpt: any[] = [];
        if (latestInbound) excerpt.push({ ts: new Date().toISOString(), source: "customer_inbound", content: latestInbound });
        if (latestOutbound) excerpt.push({ ts: new Date().toISOString(), source: "tamar_outbound", content: latestOutbound });

        const { data: handoffRow, error: insertErr } = await supabaseAdmin
          .from("manager_handoffs" as any)
          .insert({
            contact_id: contactId,
            customer_phone: customerPhone,
            customer_name: customerName,
            handoff_reason: reason,
            latest_inbound_message: latestInbound,
            conversation_excerpt: excerpt,
            resolved_offer_id: resolvedOfferId,
            status: "open",
            delivery_promise: "queued",
            delivery_attempts: 0,
          } as any)
          .select("id")
          .single();

        if (insertErr || !handoffRow) {
          return new Response(
            JSON.stringify({ ok: false, error: "handoff_insert_failed", detail: insertErr?.message }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
        const handoffId = (handoffRow as any).id as string;

        // Resolve active manager + delivery target.
        const [{ data: manager }, { data: api }] = await Promise.all([
          supabaseAdmin
            .from("managers" as any)
            .select("id, name, phone")
            .eq("active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
          supabaseAdmin
            .from("api_settings")
            .select("tamar_backend_url, tamar_backend_api_token")
            .eq("id", 1)
            .maybeSingle(),
        ]);

        const baseUrl = ((api as any)?.tamar_backend_url ?? "").trim() || null;
        const bearer =
          process.env.TAMAR_API_TOKEN || (api as any)?.tamar_backend_api_token || null;

        const alertPayload = {
          handoff_id: handoffId,
          manager: manager ? { id: (manager as any).id, name: (manager as any).name, phone: (manager as any).phone } : null,
          manager_id: manager ? (manager as any).id : null,
          manager_phone: manager ? (manager as any).phone : null,
          manager_name: manager ? (manager as any).name : null,
          customer_contact_id: contactId,
          customer_phone: customerPhone,
          customer_name: customerName,
          handoff_reason: reason,
          latest_inbound_message: latestInbound,
          latest_outbound_message: latestOutbound,
          resolved_offer_id: resolvedOfferId,
          trace,
          created_at: new Date().toISOString(),
        };

        let alertResponse: any = null;
        let alertError: string | null = null;
        let managerNotified = false;
        let deliveryPromise: "queued" | "live" | "failed" = "queued";
        // Track separately so the response type-narrowing stays loose.
        const initialPromise: "queued" | "live" | "failed" = "queued";

        if (baseUrl && manager) {
          try {
            const res = await fetch(`${baseUrl.replace(/\/$/, "")}/manager-alerts/handoff`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
              },
              body: JSON.stringify(alertPayload),
            });
            const txt = await res.text().catch(() => "");
            let parsed: any = null;
            try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = { raw: txt }; }
            alertResponse = { status: res.status, body: parsed };
            if (res.ok) {
              managerNotified = true;
              deliveryPromise = "live";
            } else {
              alertError = `railway_${res.status}`;
              deliveryPromise = "failed";
            }
          } catch (e: any) {
            alertError = `delivery_failed: ${String(e?.message ?? e).slice(0, 200)}`;
            deliveryPromise = "failed";
          }
        } else {
          alertError = !baseUrl ? "tamar_backend_url_missing" : "no_active_manager";
          deliveryPromise = "failed";
        }

        await supabaseAdmin
          .from("manager_handoffs" as any)
          .update({
            alert_payload: alertPayload,
            alert_response: alertResponse,
            alert_error: alertError,
            manager_notified: managerNotified,
            notified_at: managerNotified ? new Date().toISOString() : null,
            notified_manager_id: manager ? (manager as any).id : null,
            status: managerNotified ? "notified" : "open",
            delivery_promise: deliveryPromise,
            delivery_attempts: 1,
          } as any)
          .eq("id", handoffId);

        // Flag contact + create ops task on failure.
        await supabaseAdmin
          .from("contacts")
          .update({ manager_attention_required: true } as any)
          .eq("id", contactId);

        if (!managerNotified) {
          await supabaseAdmin.from("tasks").insert({
            contact_id: contactId,
            title: `Handoff delivery FAILED — ${customerName}`,
            description: `reason: ${alertError ?? "unknown"} • railway_bridge\n\nLatest inbound: ${latestInbound ?? ""}`,
            status: "open",
            priority: "high",
            resolution_state: "pending",
          } as any).then(() => undefined, (e) => {
            console.error("[runtime-handoff] task_create_failed", e);
          });
        }

        return new Response(
          JSON.stringify({
            ok: true,
            handoff_id: handoffId,
            manager_notified: managerNotified,
            delivery_promise: deliveryPromise,
            alert_error: alertError,
            // Explicit, honest delivery truth for the Railway brain.
            // - "delivered": manager service ack'd (2xx)
            // - "queued":    request accepted but no live ack (reserved; not used today)
            // - "failed":    no delivery — missing manager/url, non-2xx, or exception
            delivery_status:
              (deliveryPromise as string) === "live"
                ? "delivered"
                : (deliveryPromise as string) === "queued"
                  ? "queued"
                  : "failed",
            // Wording hint the brain should use in the customer-facing reply.
            // Never "live" unless the manager service actually acknowledged.
            recommended_wording: managerNotified ? "live" : "queued",
            _initial_promise: initialPromise,
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
        );
      },
    },
  },
});