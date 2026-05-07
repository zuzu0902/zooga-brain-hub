import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/webhook/tamar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Facebook webhook verification (hub.challenge)
        const url = new URL(request.url);
        const challenge = url.searchParams.get("hub.challenge");
        if (challenge) return new Response(challenge, { status: 200 });
        return new Response("ok", { status: 200 });
      },
      POST: async ({ request }) => {
        let payload: any = null;
        try {
          payload = await request.json().catch(() => null);

          // Optional token check from api_settings or query param
          const url = new URL(request.url);
          const providedToken =
            request.headers.get("x-api-token") ||
            url.searchParams.get("token") ||
            payload?.token ||
            null;

          const { data: settings } = await supabaseAdmin
            .from("api_settings")
            .select("webhook_token, default_source")
            .eq("id", 1)
            .maybeSingle();

          if (settings?.webhook_token && settings.webhook_token !== providedToken) {
            await supabaseAdmin.from("webhook_logs").insert({
              source: "tamar_bot",
              payload,
              status: "rejected",
              error: "Invalid token",
            });
            return new Response(JSON.stringify({ error: "invalid token" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          await supabaseAdmin.from("webhook_logs").insert({
            source: "tamar_bot",
            payload,
            status: "received",
          });

          // Normalize fields. Accept multiple shapes.
          const phone =
            payload?.phone ||
            payload?.whatsapp_number ||
            payload?.from?.phone ||
            null;
          const facebook_id =
            payload?.facebook_id ||
            payload?.fb_id ||
            payload?.sender?.id ||
            payload?.from?.id ||
            null;
          const email = payload?.email || payload?.from?.email || null;
          const name =
            payload?.name ||
            payload?.full_name ||
            payload?.from?.name ||
            payload?.sender?.name ||
            null;
          const message =
            payload?.message ||
            payload?.text ||
            payload?.content ||
            payload?.message?.text ||
            null;
          const source = (payload?.source || settings?.default_source || "Tamar Bot") as
            | "Facebook"
            | "WhatsApp"
            | "Zooga Website"
            | "Event"
            | "Tamar Bot"
            | "Manual";

          // Try to match existing contact
          let matched: any = null;
          if (phone) {
            const { data } = await supabaseAdmin
              .from("contacts")
              .select("id")
              .eq("phone", phone)
              .maybeSingle();
            if (data) matched = data;
          }
          if (!matched && facebook_id) {
            const { data } = await supabaseAdmin
              .from("contacts")
              .select("id")
              .eq("facebook_id", facebook_id)
              .maybeSingle();
            if (data) matched = data;
          }
          if (!matched && email) {
            const { data } = await supabaseAdmin
              .from("contacts")
              .select("id")
              .eq("email", email)
              .maybeSingle();
            if (data) matched = data;
          }

          if (matched) {
            await supabaseAdmin.from("interactions").insert({
              contact_id: matched.id,
              type:
                source === "WhatsApp"
                  ? "whatsapp_message"
                  : "facebook_message",
              source: String(source),
              content: message ?? JSON.stringify(payload).slice(0, 500),
            });
            return Response.json({
              ok: true,
              matched: true,
              contact_id: matched.id,
            });
          }

          // Otherwise create intake item
          const { data: intake, error: intakeErr } = await supabaseAdmin
            .from("intake_inbox")
            .insert({
              raw_payload: payload ?? {},
              parsed_name: name,
              parsed_phone: phone,
              parsed_email: email,
              parsed_facebook_id: facebook_id,
              parsed_message: message,
              source,
            })
            .select("id")
            .single();

          if (intakeErr) throw intakeErr;

          return Response.json({ ok: true, matched: false, intake_id: intake?.id });
        } catch (e: any) {
          await supabaseAdmin.from("webhook_logs").insert({
            source: "tamar_bot",
            payload,
            status: "error",
            error: String(e?.message || e),
          });
          return new Response(JSON.stringify({ error: "internal" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});