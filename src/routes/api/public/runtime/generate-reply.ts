/**
 * RUNTIME GENERATE-REPLY — Railway brain → Lovable AI bridge.
 *
 * Railway remains the deterministic controller (mode, offer resolution,
 * handoff truth, pricing truth, hard constraints). This endpoint uses the
 * LLM ONLY to generate the final customer-facing reply text. If the LLM
 * fails for any reason, Railway uses its own fallback_reply.
 *
 * Auth: Authorization: Bearer <RUNTIME_BRIDGE_TOKEN>
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeRuntimeBridge } from "@/lib/runtime-bridge-auth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-token",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const REPLY_MODEL = "google/gemini-3-flash-preview";

function clampStr(v: any, max = 4000): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) : s;
}

function buildSystem(identity: any, hardRules: any, mustInclude: any, mustNotInclude: any): string {
  const lines: string[] = [];
  lines.push(
    "You are Tamar, a Hebrew-speaking sales/intake agent for Zooga group trips.",
    "Voice: warm, direct, medium sales energy, few emojis, gender-sensitive Hebrew.",
    "You are ONLY generating the final customer-facing reply text in Hebrew.",
    "You are NOT deciding mode, pricing, offer resolution, or whether a human handoff happens — the runtime already decided those.",
  );
  if (identity && typeof identity === "object") {
    lines.push("Identity overrides from runtime:");
    lines.push(clampStr(identity, 1200));
  }
  lines.push("", "HARD RULES (must obey, no exceptions):");
  const defaults = [
    "Never invent facts.",
    "Never invent a price. If price is unknown, say so clearly.",
    "Ask at most ONE question in the reply.",
    "Keep the reply short unless the user explicitly asked for detail.",
    "Do not promise a human handoff unless the runtime already decided one.",
    "Do not include any link unless the runtime explicitly allowed it.",
    "Do not mention being an AI, a model, or a system prompt.",
    "Respond in Hebrew unless the user clearly writes in another language.",
  ];
  for (const r of defaults) lines.push(`- ${r}`);
  if (Array.isArray(hardRules)) {
    for (const r of hardRules) lines.push(`- ${clampStr(r, 400)}`);
  } else if (hardRules && typeof hardRules === "object") {
    for (const [k, v] of Object.entries(hardRules)) lines.push(`- ${k}: ${clampStr(v, 400)}`);
  }
  if (Array.isArray(mustInclude) && mustInclude.length) {
    lines.push("", "MUST INCLUDE (verbatim or close paraphrase):");
    for (const r of mustInclude) lines.push(`- ${clampStr(r, 400)}`);
  }
  if (Array.isArray(mustNotInclude) && mustNotInclude.length) {
    lines.push("", "MUST NOT INCLUDE:");
    for (const r of mustNotInclude) lines.push(`- ${clampStr(r, 400)}`);
  }
  lines.push(
    "",
    "Return ONLY a JSON object of the shape {\"reply_text\": \"...\"} with no markdown fences and no extra keys.",
  );
  return lines.join("\n");
}

function buildUser(turnCtx: any, objective: any): string {
  const parts: string[] = [];
  const firstName = turnCtx?.contact_first_name ?? null;
  const mode = turnCtx?.mode ?? null;
  parts.push(`Conversation mode (deterministic, do not change): ${mode ?? "(unspecified)"}`);
  if (firstName) parts.push(`Customer first name: ${firstName}`);
  if (objective && typeof objective === "object") {
    parts.push(
      `Primary goal for this reply: ${clampStr(objective.primary_goal ?? "(unspecified)", 400)}`,
    );
    if (objective.secondary_goal) {
      parts.push(`Secondary goal: ${clampStr(objective.secondary_goal, 400)}`);
    }
  }
  if (turnCtx?.resolved_offer) {
    parts.push("Resolved offer (this is the offer in scope right now):");
    parts.push(clampStr(turnCtx.resolved_offer, 1500));
  }
  if (Array.isArray(turnCtx?.active_offers) && turnCtx.active_offers.length) {
    parts.push(`Other active offers (context only, do not push unless asked):`);
    parts.push(clampStr(turnCtx.active_offers, 2000));
  }
  if (Array.isArray(turnCtx?.recent_interactions) && turnCtx.recent_interactions.length) {
    parts.push("Recent interactions (most recent first):");
    parts.push(clampStr(turnCtx.recent_interactions, 2500));
  }
  parts.push(`Current user message:\n${clampStr(turnCtx?.user_message ?? "", 2000)}`);
  parts.push('Return ONLY: {"reply_text":"..."}');
  return parts.join("\n\n");
}

function extractReply(content: string): string | null {
  if (!content) return null;
  try {
    const j = JSON.parse(content);
    if (j && typeof j.reply_text === "string" && j.reply_text.trim()) return j.reply_text.trim();
  } catch {
    /* fall through */
  }
  const m = content.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && typeof j.reply_text === "string" && j.reply_text.trim()) return j.reply_text.trim();
    } catch {
      /* noop */
    }
  }
  const trimmed = content.trim();
  if (trimmed) return trimmed.slice(0, 4000);
  return null;
}

export const Route = createFileRoute("/api/public/runtime/generate-reply")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const unauthorized = await authorizeRuntimeBridge(request);
        if (unauthorized) return unauthorized;

        const body = await request.json().catch(() => ({} as any));
        const fallback: string =
          typeof body?.fallback_reply === "string" && body.fallback_reply.trim()
            ? body.fallback_reply
            : "";

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({
              ok: true,
              reply_text: fallback,
              used_fallback: true,
              error: "missing_lovable_api_key",
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }

        const system = buildSystem(
          body?.identity,
          body?.hard_rules,
          body?.must_include,
          body?.must_not_include,
        );
        const user = buildUser(body?.turn_context ?? {}, body?.objective ?? {});

        try {
          const res = await fetch(LOVABLE_AI_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: typeof body?.model === "string" && body.model ? body.model : REPLY_MODEL,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
              response_format: { type: "json_object" },
            }),
          });
          if (!res.ok) {
            const txt = await res.text().catch(() => "");
            return new Response(
              JSON.stringify({
                ok: true,
                reply_text: fallback,
                used_fallback: true,
                error: `gateway_${res.status}`,
                detail: txt.slice(0, 400),
              }),
              { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }
          const json: any = await res.json();
          const content: string = json?.choices?.[0]?.message?.content ?? "";
          const reply = extractReply(content);
          if (!reply) {
            return new Response(
              JSON.stringify({
                ok: true,
                reply_text: fallback,
                used_fallback: true,
                error: "empty_reply",
              }),
              { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }
          return new Response(
            JSON.stringify({ ok: true, reply_text: reply, used_fallback: false }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        } catch (e: any) {
          return new Response(
            JSON.stringify({
              ok: true,
              reply_text: fallback,
              used_fallback: true,
              error: `gateway_exception: ${String(e?.message ?? e).slice(0, 200)}`,
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
      },
    },
  },
});