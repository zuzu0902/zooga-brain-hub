import { createFileRoute } from "@tanstack/react-router";
import { runExtraction } from "@/lib/intelligence-extractor.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/intelligence/extract")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const contactId = body?.contact_id;
          if (!contactId) {
            return new Response(JSON.stringify({ error: "contact_id required" }), {
              status: 400, headers: { "Content-Type": "application/json" },
            });
          }
          const result = await runExtraction(String(contactId));
          return Response.json(result);
        } catch (e: any) {
          await supabaseAdmin.from("webhook_logs").insert({
            source: "intelligence_extractor",
            payload: null,
            status: "error",
            error: String(e?.message || e),
          });
          return new Response(JSON.stringify({ error: String(e?.message || e) }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});