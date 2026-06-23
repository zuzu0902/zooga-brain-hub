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
import {
  claimInbound,
  extractInboundMessageId,
  recordReply,
} from "@/lib/runtime-inbound-dedupe";

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

/**
 * BROWSE LIST LOCK
 *
 * When the runtime is in browse mode it MUST hand us the exact numbered list
 * it intends to present (and later persist as last_presented_offers). The LLM
 * is not allowed to add/remove/reorder items or rename titles, because the
 * next-turn numeric resolution ("3" → offer X) depends on the user seeing the
 * exact same list that was written back. We:
 *   1. Render a deterministic Hebrew block from the provided list.
 *   2. Either bypass the LLM (deterministic mode) or wrap the LLM reply so
 *      the numbered block is appended verbatim and validated.
 *   3. Echo `presented_offers` back so Railway writes back the rendered list,
 *      not a pre-LLM draft.
 */
type BrowseItem = { index: number; offer_id: string; title: string };

function normalizeBrowseList(raw: any): BrowseItem[] {
  if (!Array.isArray(raw)) return [];
  const out: BrowseItem[] = [];
  raw.forEach((it: any, i: number) => {
    const offer_id = it?.offer_id ?? it?.id ?? null;
    const title = it?.title ?? it?.name ?? null;
    if (!offer_id || !title) return;
    out.push({ index: Number(it?.index ?? i + 1), offer_id: String(offer_id), title: String(title) });
  });
  // Re-number sequentially to guarantee 1..N with no gaps.
  return out.map((it, i) => ({ ...it, index: i + 1 }));
}

function renderBrowseBlock(items: BrowseItem[]): string {
  return items.map((it) => `${it.index}. ${it.title}`).join("\n");
}

function isBrowseMode(mode: any, objective: any): boolean {
  const m = String(mode ?? "").toLowerCase();
  if (m.includes("browse") || m === "list" || m === "catalog") return true;
  const g = String(objective?.primary_goal ?? "").toLowerCase();
  return g.includes("browse") || g.includes("list") || g.includes("numbered");
}

function browseListMatches(reply: string, items: BrowseItem[]): boolean {
  // Reply must contain every numbered line (index. title) in order.
  let cursor = 0;
  for (const it of items) {
    const needle = `${it.index}. ${it.title}`;
    const found = reply.indexOf(needle, cursor);
    if (found < 0) return false;
    cursor = found + needle.length;
  }
  return true;
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

        // ---------- Strict inbound-message idempotency ----------
        // If Railway tells us the inbound wamid, we MUST short-circuit any
        // duplicate so the same Tamar reply is never generated/sent twice
        // for the same user turn. Cached reply is returned verbatim.
        const inboundMessageId =
          extractInboundMessageId(body) ??
          extractInboundMessageId(body?.turn_context) ??
          null;
        let dedupeClaim: Awaited<ReturnType<typeof claimInbound>> | null = null;
        if (inboundMessageId) {
          dedupeClaim = await claimInbound({
            inboundMessageId,
            contactId: body?.contact_id ?? body?.turn_context?.contact_id ?? null,
            phone: body?.phone ?? body?.turn_context?.phone ?? null,
            source: "runtime_generate_reply",
          });
          if (dedupeClaim.duplicate) {
            return new Response(
              JSON.stringify({
                ok: true,
                reply_text: dedupeClaim.cached_reply_text ?? fallback,
                used_fallback: !dedupeClaim.cached_reply_text,
                inbound_message_id: inboundMessageId,
                duplicate_detected: true,
                reply_sent: false,
                dedupe_source: dedupeClaim.dedupe_source,
                hit_count: dedupeClaim.hit_count,
                first_seen_at: dedupeClaim.first_seen_at,
              }),
              { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }
        }

        const traceMarker = {
          inbound_message_id: inboundMessageId,
          duplicate_detected: false,
          dedupe_source: dedupeClaim?.dedupe_source ?? (inboundMessageId ? "first_seen" : "no_inbound_id"),
        };
        const finalize = async (reply: string | null, extra: Record<string, any>) => {
          if (inboundMessageId && typeof reply === "string") {
            await recordReply(inboundMessageId, reply).catch(() => {});
          }
          return new Response(
            JSON.stringify({
              ok: true,
              reply_text: reply ?? fallback,
              ...traceMarker,
              reply_sent: true,
              ...extra,
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        };

        // ---------- Browse-mode list lock ----------
        const turnCtx = body?.turn_context ?? {};
        const objective = body?.objective ?? {};
        const browseList = normalizeBrowseList(
          turnCtx?.browse_list ?? turnCtx?.last_presented_offers ?? body?.browse_list,
        );
        const browseMode = isBrowseMode(turnCtx?.mode, objective);
        const browseLockRequested =
          browseMode || body?.lock_browse_list === true || browseList.length > 0 && browseMode;
        const deterministicBrowse =
          body?.deterministic_browse === true || (browseMode && body?.allow_llm_browse !== true);

        if (browseMode && browseList.length > 0 && deterministicBrowse) {
          // Bypass LLM entirely — return canonical numbered list.
          const intro =
            typeof body?.browse_intro === "string" && body.browse_intro.trim()
              ? body.browse_intro.trim()
              : "הנה כמה אפשרויות שיכולות להתאים לך:";
          const outro =
            typeof body?.browse_outro === "string" && body.browse_outro.trim()
              ? body.browse_outro.trim()
              : "איזה מהם מעניין אותך? אפשר לענות עם המספר.";
          const reply_text = `${intro}\n\n${renderBrowseBlock(browseList)}\n\n${outro}`;
          return finalize(reply_text, {
            used_fallback: false,
            source: "deterministic_browse",
            presented_offers: browseList,
          });
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return finalize(fallback, {
            used_fallback: true,
            error: "missing_lovable_api_key",
            presented_offers: browseLockRequested ? browseList : undefined,
          });
        }

        // If browse-mode + LLM is explicitly allowed, inject a hard lock rule.
        const extraMustInclude = Array.isArray(body?.must_include) ? [...body.must_include] : [];
        const extraHardRules = Array.isArray(body?.hard_rules) ? [...body.hard_rules] : [];
        if (browseMode && browseList.length > 0) {
          const block = renderBrowseBlock(browseList);
          extraHardRules.push(
            "BROWSE LIST LOCK: include the following numbered list VERBATIM (same items, same order, same numbering, same titles). Do NOT add, remove, reorder, rename, translate, or merge items.",
            `Canonical list (verbatim):\n${block}`,
          );
          extraMustInclude.push(block);
        }
        const system = buildSystem(
          body?.identity,
          extraHardRules,
          extraMustInclude,
          body?.must_not_include,
        );
        const user = buildUser(turnCtx, objective);

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
            return finalize(fallback, {
              used_fallback: true,
              error: `gateway_${res.status}`,
              detail: txt.slice(0, 400),
            });
          }
          const json: any = await res.json();
          const content: string = json?.choices?.[0]?.message?.content ?? "";
          let reply = extractReply(content);
          if (!reply) {
            return finalize(fallback, {
              used_fallback: true,
              error: "empty_reply",
              presented_offers: browseLockRequested ? browseList : undefined,
            });
          }
          // Browse lock validation — if the LLM mangled the numbered list,
          // fall back to deterministic render so the user sees exactly what
          // Railway will write back as last_presented_offers.
          if (browseMode && browseList.length > 0 && !browseListMatches(reply, browseList)) {
            const intro =
              typeof body?.browse_intro === "string" && body.browse_intro.trim()
                ? body.browse_intro.trim()
                : "הנה כמה אפשרויות שיכולות להתאים לך:";
            const outro =
              typeof body?.browse_outro === "string" && body.browse_outro.trim()
                ? body.browse_outro.trim()
                : "איזה מהם מעניין אותך? אפשר לענות עם המספר.";
            reply = `${intro}\n\n${renderBrowseBlock(browseList)}\n\n${outro}`;
            return finalize(reply, {
              used_fallback: false,
              source: "deterministic_browse_after_llm_mismatch",
              presented_offers: browseList,
            });
          }
          return finalize(reply, {
            used_fallback: false,
            presented_offers: browseLockRequested ? browseList : undefined,
          });
        } catch (e: any) {
          return finalize(fallback, {
            used_fallback: true,
            error: `gateway_exception: ${String(e?.message ?? e).slice(0, 200)}`,
            presented_offers: browseLockRequested ? browseList : undefined,
          });
        }
      },
    },
  },
});