/**
 * TAMAR BRAIN V2 — canonical context package (PURE, no I/O).
 *
 * One bounded, token-efficient, structured JSON package is assembled before
 * interpretation/decision on EVERY v2 turn. It is deliberately compact:
 * references, short values and counts — never raw payloads, never secrets.
 *
 * The raw inbound payload stays in `inbound_event_vault`; the canonical
 * transcript stays in `interactions` / `messages`. This package is a
 * bounded VIEW over them, plus the audit snapshot that proves what the
 * runtime actually saw.
 */

export const CONTEXT_VERSION = "v2.ctx.1" as const;

export const CONTEXT_LIMITS = {
  transcript: 30,
  facts: 40,
  memories: 25,
  changes: 10,
  decisions: 5,
  offers: 10,
  knowledge: 3,
  /** per-item text budget */
  chars: 280,
  summaryChars: 600,
} as const;

export type ContextTurn = { dir: "in" | "out"; at: string | null; text: string };
export type ContextFact = {
  key: string;
  value: string | null;
  provenance: "explicit" | "inferred";
  confidence: number | null;
};
export type ContextMemory = {
  key: string;
  type: string | null;
  value: string | null;
  confidence: number | null;
  at: string | null;
};
export type ContextChange = { field: string; from: string | null; to: string | null; at: string | null };
export type ContextDecision = { action: string | null; reason_codes: string[]; at: string | null };

export type ContextPackage = {
  version: typeof CONTEXT_VERSION;
  contact: { id: string | null; first_name: string | null; state: string; language: string };
  summary: string | null;
  transcript: ContextTurn[];
  facts: ContextFact[];
  memories: ContextMemory[];
  recent_changes: ContextChange[];
  decisions: ContextDecision[];
  offers_presented: string[];
  offers_sent: string[];
  handoff: { open: boolean; reason: string | null };
  knowledge: string[];
};

/** Keys that must never leave the server inside a context package. */
const SECRET_KEY_RE =
  /(secret|token|password|passwd|authorization|api[_-]?key|bearer|credential|private[_-]?key|prompt|payload|input_signals|env(ironment)?)/i;

export function isSecretContextKey(key: string): boolean {
  return SECRET_KEY_RE.test(String(key ?? ""));
}

/** Deep-strip secret-like keys from anything we are about to persist/send. */
export function redactContext<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactContext(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretContextKey(k)) continue;
      out[k] = redactContext(v);
    }
    return out as unknown as T;
  }
  return value;
}

function clip(v: unknown, max: number = CONTEXT_LIMITS.chars): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Memories are deduplicated by memory key: the most confident CURRENT entry
 * wins, ties broken by recency. A superseded/older duplicate never reaches
 * the model.
 */
export function dedupeMemories(rows: ContextMemory[]): ContextMemory[] {
  const best = new Map<string, ContextMemory>();
  for (const m of rows) {
    if (!m.key) continue;
    const prev = best.get(m.key);
    if (!prev) {
      best.set(m.key, m);
      continue;
    }
    const pc = prev.confidence ?? 0;
    const mc = m.confidence ?? 0;
    if (mc > pc || (mc === pc && String(m.at ?? "") > String(prev.at ?? ""))) best.set(m.key, m);
  }
  return Array.from(best.values()).slice(0, CONTEXT_LIMITS.memories);
}

export type RawContext = {
  contact?: Record<string, any> | null;
  state: string;
  summary?: string | null;
  interactions?: Array<{ source?: string | null; content?: string | null; timestamp?: string | null }>;
  facts?: Array<Record<string, any>>;
  memories?: Array<Record<string, any>>;
  history?: Array<Record<string, any>>;
  decisions?: Array<Record<string, any>>;
  offersPresented?: string[];
  offersSent?: string[];
  handoff?: { open: boolean; reason?: string | null } | null;
  knowledge?: string[];
};

/** Assemble the bounded package. Deterministic ordering, deterministic trims. */
export function buildContextPackage(raw: RawContext): ContextPackage {
  const transcript: ContextTurn[] = (raw.interactions ?? [])
    .slice(0, CONTEXT_LIMITS.transcript)
    .map((r) => ({
      dir: String(r.source ?? "").includes("outbound") ? ("out" as const) : ("in" as const),
      at: r.timestamp ?? null,
      text: clip(r.content),
    }))
    .filter((t) => !!t.text)
    // oldest -> newest so ordering is readable by the model
    .reverse();

  const facts: ContextFact[] = (raw.facts ?? []).slice(0, CONTEXT_LIMITS.facts).map((f) => ({
    key: String(f.field_key ?? ""),
    value: clip(f.value_text ?? f.value),
    provenance: f.explicit_or_inferred === "inferred" ? "inferred" : "explicit",
    confidence: num(f.confidence_score),
  }));

  const memories = dedupeMemories(
    (raw.memories ?? []).map((m) => ({
      key: String(m.memory_key ?? ""),
      type: m.memory_type ?? null,
      value: clip(m.memory_value),
      confidence: num(m.confidence_score),
      at: m.updated_at ?? m.created_at ?? null,
    })),
  );

  const recent_changes: ContextChange[] = (raw.history ?? []).slice(0, CONTEXT_LIMITS.changes).map((h) => ({
    field: String(h.field_name ?? ""),
    from: clip(h.old_value, 80) || null,
    to: clip(h.new_value, 80) || null,
    at: h.created_at ?? null,
  }));

  const decisions: ContextDecision[] = (raw.decisions ?? []).slice(0, CONTEXT_LIMITS.decisions).map((d) => ({
    action: d.selected_action ?? null,
    reason_codes: Array.isArray(d.reason_codes) ? d.reason_codes.map(String).slice(0, 6) : [],
    at: d.created_at ?? null,
  }));

  return {
    version: CONTEXT_VERSION,
    contact: {
      id: raw.contact?.id ?? null,
      first_name: raw.contact?.first_name ?? null,
      state: raw.state,
      language: "he",
    },
    summary: raw.summary ? clip(raw.summary, CONTEXT_LIMITS.summaryChars) : null,
    transcript,
    facts,
    memories,
    recent_changes,
    decisions,
    offers_presented: (raw.offersPresented ?? []).slice(0, CONTEXT_LIMITS.offers).map(String),
    offers_sent: (raw.offersSent ?? []).slice(0, CONTEXT_LIMITS.offers).map(String),
    handoff: { open: !!raw.handoff?.open, reason: raw.handoff?.reason ?? null },
    knowledge: (raw.knowledge ?? []).slice(0, CONTEXT_LIMITS.knowledge).map((k) => clip(k, 400)),
  };
}

/** Counts of the source records that fed the package (audit, no PII). */
export function contextSourceCounts(ctx: ContextPackage) {
  return {
    transcript: ctx.transcript.length,
    facts: ctx.facts.length,
    memories: ctx.memories.length,
    recent_changes: ctx.recent_changes.length,
    decisions: ctx.decisions.length,
    offers_presented: ctx.offers_presented.length,
    offers_sent: ctx.offers_sent.length,
    knowledge: ctx.knowledge.length,
  };
}

/** Cheap deterministic token estimate (≈4 chars/token) for budget guards. */
export function estimateTokens(ctx: unknown): number {
  return Math.ceil(JSON.stringify(ctx ?? {}).length / 4);
}

/** Compact history lines (oldest first) for the existing interpreter input. */
export function transcriptLines(ctx: ContextPackage, limit = 12): string[] {
  return ctx.transcript.slice(-limit).map((t) => `${t.dir === "out" ? "תמר" : "לקוח"}: ${t.text}`);
}

/**
 * Turn complexity drives model routing: normal turns run on the cheapest
 * capable model, only genuinely hard turns escalate.
 */
export function turnComplexity(args: {
  message: string;
  ctx: ContextPackage;
  wantsHuman?: boolean;
  confidence?: number | null;
}): "simple" | "complex" {
  const msg = String(args.message ?? "");
  if (args.wantsHuman) return "complex";
  if ((args.confidence ?? 100) < 60) return "complex";
  if (msg.length > 320) return "complex";
  if (args.ctx.handoff.open) return "complex";
  if (/(תלונה|החזר|כסף|תשלום|עורך\s*דין|משפטי|ביטול|הונאה)/.test(msg)) return "complex";
  return "simple";
}
