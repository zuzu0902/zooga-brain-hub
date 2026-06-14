/**
 * RETRY HANDOFFS — B4 operational truthfulness.
 *
 * Finds manager_handoffs rows that are status='open' AND manager_notified=false
 * older than 5 minutes, increments delivery_attempts, and re-fires the alert
 * to Railway. Call from pg_cron or any external scheduler:
 *   POST {published}/api/public/cron/retry-handoffs
 *     header: x-api-token: <api_settings.webhook_token>
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const STALE_MINUTES = 5;
const MAX_ATTEMPTS = 5;

function resolveTamarBackendConfig(api: any) {
  const envUrl = process.env.TAMAR_API_URL?.trim();
  const envToken = process.env.TAMAR_API_TOKEN?.trim();
  const dbUrl = api?.tamar_backend_url ? String(api.tamar_backend_url).trim() : "";
  const dbToken = api?.tamar_backend_api_token ? String(api.tamar_backend_api_token).trim() : "";
  return {
    baseUrl: (envUrl || dbUrl).replace(/\/$/, "") || null,
    bearer: envToken || dbToken || null,
  };
}

export const Route = createFileRoute("/api/public/cron/retry-handoffs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-api-token");
        const { data: settings } = await supabaseAdmin
          .from("api_settings")
          .select("webhook_token, tamar_backend_url, tamar_backend_api_token")
          .eq("id", 1)
          .maybeSingle();
        if (settings?.webhook_token && settings.webhook_token !== provided) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const { baseUrl, bearer } = resolveTamarBackendConfig(settings);
        const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();

        const { data: stale } = await supabaseAdmin
          .from("manager_handoffs" as any)
          .select("id, alert_payload, delivery_attempts, created_at")
          .eq("status", "open")
          .eq("manager_notified", false)
          .lt("created_at", cutoff)
          .lt("delivery_attempts", MAX_ATTEMPTS)
          .limit(50);

        const rows = ((stale as any[]) ?? []);
        const results: any[] = [];

        if (!baseUrl) {
          return Response.json({ ok: false, error: "tamar_backend_url_missing", candidates: rows.length });
        }

        for (const row of rows) {
          const attempts = (row.delivery_attempts ?? 0) + 1;
          let ok = false;
          let alertResponse: any = null;
          let alertError: string | null = null;
          try {
            const res = await fetch(`${baseUrl}/manager-alerts/handoff`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
              },
              body: JSON.stringify({ ...(row.alert_payload ?? {}), retry_attempt: attempts }),
            });
            const txt = await res.text().catch(() => "");
            let parsed: any = null;
            try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = { raw: txt }; }
            alertResponse = { status: res.status, body: parsed };
            ok = res.ok;
            if (!ok) alertError = `railway_${res.status}`;
          } catch (e: any) {
            alertError = `delivery_failed: ${String(e?.message ?? e).slice(0, 200)}`;
          }
          await supabaseAdmin
            .from("manager_handoffs" as any)
            .update({
              delivery_attempts: attempts,
              alert_response: alertResponse,
              alert_error: alertError,
              manager_notified: ok,
              notified_at: ok ? new Date().toISOString() : null,
              status: ok ? "notified" : "open",
            } as any)
            .eq("id", row.id);
          results.push({ id: row.id, attempts, ok, error: alertError });
        }

        return Response.json({ ok: true, candidates: rows.length, results });
      },
    },
  },
});