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
          const rawPhone =
            payload?.phone ||
            payload?.whatsapp_number ||
            payload?.from?.phone ||
            null;
          const phone = rawPhone ? String(rawPhone).trim() : null;
          const whatsapp_number =
            (payload?.whatsapp_number ? String(payload.whatsapp_number).trim() : null) || phone;
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
          const source = (payload?.source || settings?.default_source || "Tamar WhatsApp") as string;
          const intake_status = payload?.intake_status || null;
          const isWhatsApp = /whatsapp/i.test(source);

          // Phone is the master key. Try to match existing contact by phone first.
          let matched: any = null;
          if (phone) {
            const { data } = await supabaseAdmin
              .from("contacts")
              .select("*")
              .or(`phone.eq.${phone},whatsapp_number.eq.${phone}`)
              .maybeSingle();
            if (data) matched = data;
          }
          if (!matched && facebook_id) {
            const { data } = await supabaseAdmin
              .from("contacts")
              .select("*")
              .eq("facebook_id", facebook_id)
              .maybeSingle();
            if (data) matched = data;
          }
          if (!matched && email) {
            const { data } = await supabaseAdmin
              .from("contacts")
              .select("*")
              .eq("email", email)
              .maybeSingle();
            if (data) matched = data;
          }

          const nowIso = new Date().toISOString();

          if (matched) {
            // Fill missing fields only — don't overwrite existing data.
            const nameParts = name ? String(name).trim().split(/\s+/) : [];
            const patch: any = { last_interaction_at: nowIso };
            if (phone && !matched.phone) patch.phone = phone;
            if (whatsapp_number && !matched.whatsapp_number) patch.whatsapp_number = whatsapp_number;
            if (facebook_id && !matched.facebook_id) patch.facebook_id = facebook_id;
            if (email && !matched.email) patch.email = email;
            if (name && !matched.full_name) patch.full_name = name;
            if (nameParts[0] && !matched.first_name) patch.first_name = nameParts[0];
            if (nameParts.length > 1 && !matched.last_name) patch.last_name = nameParts.slice(1).join(" ");
            if (intake_status && !matched.intake_status) patch.intake_status = intake_status;
            if (payload?.preferred_language_style && !matched.preferred_language_style)
              patch.preferred_language_style = payload.preferred_language_style;
            if (payload?.gender && !matched.gender) patch.gender = payload.gender;

            await supabaseAdmin.from("contacts").update(patch).eq("id", matched.id);

            if (message) {
              await supabaseAdmin.from("interactions").insert({
                contact_id: matched.id,
                type: isWhatsApp ? "whatsapp_message" : "facebook_message",
                source: String(source),
                content: message,
              });
            }

            return Response.json({
              ok: true,
              matched: true,
              contact_id: matched.id,
              updated_fields: Object.keys(patch),
            });
          }

          // No matching contact — create a new one keyed by phone.
          const fallbackName = name || "משתמש WhatsApp";
          const newNameParts = String(fallbackName).trim().split(/\s+/);
          const insertRow: any = {
            full_name: fallbackName,
            first_name: newNameParts[0] || fallbackName,
            last_name: newNameParts.length > 1 ? newNameParts.slice(1).join(" ") : null,
            phone: phone,
            whatsapp_number: whatsapp_number,
            facebook_id: facebook_id,
            email: email,
            source: source as any,
            intake_status: intake_status || "new",
            last_interaction_at: nowIso,
            consent_marketing: false,
          };
          if (payload?.preferred_language_style)
            insertRow.preferred_language_style = payload.preferred_language_style;
          if (payload?.gender) insertRow.gender = payload.gender;

          const { data: created, error: createErr } = await supabaseAdmin
            .from("contacts")
            .insert(insertRow)
            .select("id")
            .single();

          if (createErr) throw createErr;

          if (message && created?.id) {
            await supabaseAdmin.from("interactions").insert({
              contact_id: created.id,
              type: isWhatsApp ? "whatsapp_message" : "facebook_message",
              source: String(source),
              content: message,
            });
          }

          // Also log to intake_inbox for visibility, marked as processed.
          await supabaseAdmin.from("intake_inbox").insert({
            raw_payload: payload ?? {},
            parsed_name: fallbackName,
            parsed_phone: phone,
            parsed_email: email,
            parsed_facebook_id: facebook_id,
            parsed_message: message,
            source: source as any,
            status: "processed" as any,
            matched_contact_id: created?.id ?? null,
            processed_at: nowIso,
          });

          return Response.json({ ok: true, matched: false, created: true, contact_id: created?.id });
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