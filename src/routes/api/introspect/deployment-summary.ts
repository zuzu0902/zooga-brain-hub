import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards, envPresenceMap } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/deployment-summary")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    const env = envPresenceMap();
    return jsonResponse({
      generated_at: new Date().toISOString(),
      runtime: "cloudflare-workers (nodejs_compat)",
      framework: "TanStack Start v1 + Vite 7",
      node_env: process.env.NODE_ENV ?? "unknown",
      domains: {
        production: "https://zooga-brain-hub.lovable.app",
        preview: "https://id-preview--63da89d1-c593-41f4-9c3f-89806f28874d.lovable.app",
        stable_published: "https://project--63da89d1-c593-41f4-9c3f-89806f28874d.lovable.app",
        stable_preview: "https://project--63da89d1-c593-41f4-9c3f-89806f28874d-dev.lovable.app",
        custom: [],
      },
      env_vars: { present: env.present, missing: env.missing },
      build: { compatibility_date: "2025-09-24", nodejs_compat: true },
    });
  })},
});