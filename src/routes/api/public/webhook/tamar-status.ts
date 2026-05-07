import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const VALID_WA = new Set(["not_sent", "sent", "delivered", "read", "replied", "failed"]);
const VALID_LEAD = new Set([
  "imported", "duplicate", "ready_for_intake", "sent_to_tamar",
  "replied", "converted_to_contact", "failed", "opted_out",
]);

export const Route = createFileRoute("/api/public/webhook/tamar-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: any = null;
        try {
          payload = await request.json().catch(() => null);

          const url = new URL(request.url);
          const providedToken =
            request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
            request.headers.get("x-api-token") ||
            url.searchParams.get("token") ||
            payload?.token ||
            null;

          const { data: settings } = await supabaseAdmin
            .from("api_settings")
            .select("tamar_backend_api_token")
            .eq("id", 1)
            .maybeSingle();

          if (settings?.tamar_backend_api_token && settings.tamar_backend_api_token !== providedToken) {
            return new Response(JSON.stringify({ error: "invalid token" }), {
              status: 401, headers: { "Content-Type": "application/json" },
            });
          }

          // Accept either a single update or { updates: [...] }
          const updates: any[] = Array.isArray(payload?.updates)
            ? payload.updates
            : payload?.lead_id
            ? [payload]
            : [];

          let updated = 0;
          for (const u of updates) {
            if (!u?.lead_id) continue;
            const patch: any = { last_message_at: new Date().toISOString() };
            if (u.whatsapp_status && VALID_WA.has(u.whatsapp_status)) {
              patch.whatsapp_template_status = u.whatsapp_status;
              if (u.whatsapp_status === "replied") patch.import_status = "replied";
              if (u.whatsapp_status === "failed") patch.import_status = "failed";
            }
            if (u.import_status && VALID_LEAD.has(u.import_status)) {
              patch.import_status = u.import_status;
            }
            if (u.consent_status && ["unknown", "approved", "declined"].includes(u.consent_status)) {
              patch.consent_status = u.consent_status;
            }
            const { error } = await supabaseAdmin
              .from("imported_leads")
              .update(patch)
              .eq("id", u.lead_id);
            if (!error) updated++;
          }

          await supabaseAdmin.from("webhook_logs").insert({
            source: "tamar_status",
            payload,
            status: "received",
          });

          return Response.json({ ok: true, updated });
        } catch (e: any) {
          await supabaseAdmin.from("webhook_logs").insert({
            source: "tamar_status",
            payload,
            status: "error",
            error: String(e?.message || e),
          });
          return new Response(JSON.stringify({ error: "internal" }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});