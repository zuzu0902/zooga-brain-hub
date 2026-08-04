/**
 * TAMAR BRAIN v1 — community knowledge retrieval (grounding only).
 * Tamar may only state business facts that come from an APPROVED source.
 * No aggressive crawling: sources are added/approved by an admin.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const KNOWLEDGE_DOMAIN_ALLOWLIST = ["zooga.co.il", "www.zooga.co.il", "facebook.com/zooga"];

export function isAllowedKnowledgeUrl(url: string | null | undefined): boolean {
  if (!url) return true; // manual/uploaded material has no URL
  try {
    const host = new URL(url).hostname.toLowerCase();
    return KNOWLEDGE_DOMAIN_ALLOWLIST.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export type KnowledgeHit = {
  source_id: string;
  source_title: string;
  source_url: string | null;
  verified_at: string | null;
  content: string;
};

function tokenize(q: string): string[] {
  return String(q ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Lexical retrieval over approved chunks. Returns [] when nothing matches. */
export async function retrieveKnowledge(query: string, limit = 3): Promise<KnowledgeHit[]> {
  const words = tokenize(query);
  if (!words.length) return [];
  const { data } = await supabaseAdmin
    .from("community_knowledge_chunks" as any)
    .select("content,tags,source_id,community_knowledge_sources(title,source_url,verified_at,status)")
    .eq("status", "approved")
    .limit(200);

  const rows = ((data as any[]) ?? []).filter(
    (r) => r?.community_knowledge_sources?.status === "approved",
  );

  const scored = rows.map((r) => {
    const hay = `${String(r.content ?? "").toLowerCase()} ${(r.tags ?? []).join(" ").toLowerCase()}`;
    const score = words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
    return { r, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => ({
      source_id: r.source_id,
      source_title: r.community_knowledge_sources?.title ?? "מקור",
      source_url: r.community_knowledge_sources?.source_url ?? null,
      verified_at: r.community_knowledge_sources?.verified_at ?? null,
      content: r.content,
    }));
}

export function knowledgeBlock(hits: KnowledgeHit[]): string | null {
  if (!hits.length) return null;
  const lines = hits.map(
    (h, i) =>
      `[K${i + 1}] ${h.content}\n    מקור: ${h.source_title}${h.verified_at ? ` (אומת ${String(h.verified_at).slice(0, 10)})` : ""}`,
  );
  return [
    "COMMUNITY KNOWLEDGE (grounding only — do NOT state community/business facts that are not here):",
    ...lines,
  ].join("\n");
}