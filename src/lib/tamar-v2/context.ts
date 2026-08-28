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

export const CONTEXT_VERSION = "v2.ctx.4" as const;

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

/** The one authoritative pointer of what this conversation is about. */
export type ContextFocus = {
  topic: string | null;
  offer_id: string | null;
  provenance: string;
  updated_at: string | null;
};

/** The FULL current record of the active event/offer — never a shallow match. */
export type ContextActiveOffer = {
  id: string;
  title: string;
  status: string | null;
  category: string | null;
  event_date: string | null;
  event_end_date: string | null;
  price: number | null;
  currency: string | null;
  pricing_status: string | null;
  url: string | null;
  summary: string | null;
  description: string | null;
  itinerary: string | null;
  included: string[];
  not_included: string[];
  audience: string[];
  accessibility: string | null;
  facts: Record<string, string>;
  faqs: Array<{ q: string; a: string }>;
  sellable: boolean;
};

export type ContextCommitment = { kind: string; ref: string | null; text: string | null; at: string | null };

/**
 * THE CURRENT INBOUND TURN — the message this very decision is about.
 *
 * The recent verbatim history is NOT a substitute: without this block the
 * persisted snapshot cannot prove what the runtime actually reasoned over.
 * The raw transcript is preserved verbatim and stays distinguishable from
 * the normalized (voice-corrected) text that the model was given.
 */
export type ContextInbound = {
  message_id: string | null;
  at: string;
  source: string;
  is_voice: boolean;
  /** exactly what arrived (voice transcript kept raw) */
  raw_text: string;
  /** the text actually used for reasoning when it differs from raw */
  normalized_text: string | null;
  /** audit of the normalization decision, null when nothing was normalized */
  normalization: {
    changed: boolean;
    ambiguous: boolean;
    reason: string | null;
    confidence: number | null;
  } | null;
};

export const INBOUND_RAW_CHARS = 1500;

export type ContextPackage = {
  version: typeof CONTEXT_VERSION;
  contact: { id: string | null; first_name: string | null; state: string; language: string };
  /** the inbound turn being decided (never omitted, never budgeted away) */
  inbound: ContextInbound;
  /** current journey stage (canonical conversation state) */
  journey_stage: string;
  active: ContextFocus;
  active_offer: ContextActiveOffer | null;
  summary: string | null;
  transcript: ContextTurn[];
  facts: ContextFact[];
  memories: ContextMemory[];
  intake: { answered: Record<string, string>; missing: string[] };
  commitments: ContextCommitment[];
  recent_changes: ContextChange[];
  decisions: ContextDecision[];
  offers_presented: string[];
  offers_sent: string[];
  handoff: {
    open: boolean;
    reason: string | null;
    manager_summary: string | null;
    manager_outcome: string | null;
    manager_contacted_at: string | null;
  };
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
  handoff?: {
    open: boolean;
    reason?: string | null;
    manager_summary?: string | null;
    manager_outcome?: string | null;
    manager_contacted_at?: string | null;
  } | null;
  knowledge?: string[];
  focus?: ContextFocus | null;
  activeOffer?: Record<string, any> | null;
  intakeAnswered?: Record<string, string>;
  intakeMissing?: string[];
  commitments?: ContextCommitment[];
  inbound?: RawInbound | null;
};

/** The current inbound as the runtime knows it, before packaging. */
export type RawInbound = {
  messageId?: string | null;
  at?: string | null;
  source?: string | null;
  rawText: string;
  normalizedText?: string | null;
  normalization?: { changed: boolean; ambiguous: boolean; reason?: string | null; confidence?: number | null } | null;
};

/**
 * Package the current inbound turn. The raw text is preserved verbatim (only
 * length-bounded); the normalized text is recorded separately and only when
 * it really differs, so "what arrived" and "what was reasoned over" can never
 * be confused in the audit snapshot.
 */
export function buildInbound(raw: RawInbound | null | undefined): ContextInbound {
  const source = String(raw?.source ?? "unknown");
  const rawText = String(raw?.rawText ?? "").slice(0, INBOUND_RAW_CHARS);
  const normalized = raw?.normalizedText ? String(raw.normalizedText).slice(0, INBOUND_RAW_CHARS) : null;
  const n = raw?.normalization ?? null;
  return {
    message_id: raw?.messageId ? String(raw.messageId) : null,
    at: raw?.at ?? new Date().toISOString(),
    source,
    is_voice: /voice|audio/i.test(source),
    raw_text: rawText,
    normalized_text: normalized && normalized !== rawText ? normalized : null,
    normalization: n
      ? {
          changed: !!n.changed,
          ambiguous: !!n.ambiguous,
          reason: n.reason ? String(n.reason).slice(0, 120) : null,
          confidence: typeof n.confidence === "number" ? n.confidence : null,
        }
      : null,
  };
}

/** Build the FULL current record of the active offer (bounded, sanitized). */
export function buildActiveOffer(offer: Record<string, any> | null | undefined): ContextActiveOffer | null {
  if (!offer?.id) return null;
  const list = (v: unknown, max = 12): string[] =>
    Array.isArray(v) ? v.map((x) => clip(x, 120)).filter(Boolean).slice(0, max) : [];
  const facts: Record<string, string> = {};
  const gf = (offer["grounded_facts"] ?? {}) as Record<string, unknown>;
  if (gf && typeof gf === "object") {
    for (const [k, v] of Object.entries(gf).slice(0, 25)) {
      if (isSecretContextKey(k)) continue;
      facts[clip(k, 60)] = clip(v, 200);
    }
  }
  const faqs = Array.isArray(offer["faq_bundle"])
    ? (offer["faq_bundle"] as Array<Record<string, any>>)
        .slice(0, 8)
        .map((f) => ({ q: clip(f?.["q"], 160), a: clip(f?.["a"], 240) }))
        .filter((f) => !!f.q)
    : [];
  const accessibility =
    clip(offer["accessibility_notes"] ?? facts["נגישות"] ?? facts["accessibility"] ?? "", 240) || null;
  return {
    id: String(offer["id"]),
    title: clip(offer["title"], 160),
    status: offer["status"] ?? null,
    category: offer["category"] ?? null,
    event_date: offer["event_date"] ?? null,
    event_end_date: offer["event_end_date"] ?? null,
    price: num(offer["base_price_per_person"]),
    currency: offer["currency"] ?? null,
    pricing_status: offer["pricing_status"] ?? null,
    url: offer["offer_url"] ?? null,
    summary: clip(offer["ai_summary"], 400) || null,
    description: clip(offer["description"], 400) || null,
    itinerary: clip(offer["itinerary_summary"], 600) || null,
    included: list(offer["included"]),
    not_included: list(offer["not_included"]),
    audience: list(offer["matching_tags"]),
    accessibility,
    facts,
    faqs,
    sellable: offer["status"] === "active",
  };
}

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
    inbound: buildInbound(raw.inbound),
    journey_stage: raw.state,
    active: raw.focus ?? { topic: null, offer_id: null, provenance: "none", updated_at: null },
    active_offer: buildActiveOffer(raw.activeOffer),
    summary: raw.summary ? clip(raw.summary, CONTEXT_LIMITS.summaryChars) : null,
    transcript,
    facts,
    memories,
    intake: {
      answered: Object.fromEntries(
        Object.entries(raw.intakeAnswered ?? {}).slice(0, 30).map(([k, v]) => [k, clip(v, 120)]),
      ),
      missing: (raw.intakeMissing ?? []).map(String).slice(0, 12),
    },
    commitments: (raw.commitments ?? []).slice(0, 10).map((c) => ({
      kind: String(c.kind ?? ""),
      ref: c.ref ? String(c.ref) : null,
      text: c.text ? clip(c.text, 160) : null,
      at: c.at ?? null,
    })),
    recent_changes,
    decisions,
    offers_presented: (raw.offersPresented ?? []).slice(0, CONTEXT_LIMITS.offers).map(String),
    offers_sent: (raw.offersSent ?? []).slice(0, CONTEXT_LIMITS.offers).map(String),
    handoff: {
      open: !!raw.handoff?.open,
      reason: raw.handoff?.reason ?? null,
      manager_summary: raw.handoff?.manager_summary ? clip(raw.handoff.manager_summary, 600) : null,
      manager_outcome: raw.handoff?.manager_outcome ?? null,
      manager_contacted_at: raw.handoff?.manager_contacted_at ?? null,
    },
    knowledge: (raw.knowledge ?? []).slice(0, CONTEXT_LIMITS.knowledge).map((k) => clip(k, 400)),
  };
}

/**
 * Token budget guard. Trims the OLDEST material first and never drops the
 * last customer/agent turns, the active focus or the active offer record.
 */
export const CONTEXT_TOKEN_BUDGET = 3000;
export const CONTEXT_MIN_TURNS = 6;

export function budgetContext(ctx: ContextPackage, budget = CONTEXT_TOKEN_BUDGET): ContextPackage {
  let out = ctx;
  if (estimateTokens(out) <= budget) return out;
  out = { ...out, knowledge: [] };
  if (estimateTokens(out) <= budget) return out;
  out = { ...out, recent_changes: [], decisions: out.decisions.slice(0, 2) };
  if (estimateTokens(out) <= budget) return out;
  out = { ...out, memories: out.memories.slice(0, 10) };
  while (estimateTokens(out) > budget && out.transcript.length > CONTEXT_MIN_TURNS) {
    out = { ...out, transcript: out.transcript.slice(1) };
  }
  return out;
}

/** Counts of the source records that fed the package (audit, no PII). */
export function contextSourceCounts(ctx: ContextPackage) {
  return {
    inbound: ctx.inbound?.raw_text ? 1 : 0,
    inbound_normalized: ctx.inbound?.normalized_text ? 1 : 0,
    transcript: ctx.transcript.length,
    facts: ctx.facts.length,
    memories: ctx.memories.length,
    intake_answered: Object.keys(ctx.intake?.answered ?? {}).length,
    intake_missing: (ctx.intake?.missing ?? []).length,
    commitments: (ctx.commitments ?? []).length,
    active_offer: ctx.active_offer ? 1 : 0,
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
