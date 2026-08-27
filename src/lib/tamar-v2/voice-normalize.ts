/**
 * TAMAR V2 — domain-aware voice transcript normalization (PURE, no I/O).
 *
 * Production evidence: a transcription produced "בקבוק" inside a travel
 * conversation whose active focus was "טיול לבאקו". The engine combined the
 * bad token with stale travel context instead of resolving or clarifying.
 *
 * Rules:
 *   - the RAW transcript is never mutated; a NORMALIZED copy is produced.
 *   - a token is corrected only when a domain term from the ACTIVE focus or
 *     the live catalogue is a near-match AND confidence is high.
 *   - low confidence never silently rewrites speech: the caller must ask one
 *     concise clarification instead.
 *   - every correction carries reason + confidence for the audit row.
 */

export type VoiceNormalization = {
  raw: string;
  normalized: string;
  changed: boolean;
  ambiguous: boolean;
  reason: string | null;
  confidence: number;
  corrections: Array<{ from: string; to: string; confidence: number }>;
};

/** Confidence at/above which a correction is applied silently. */
export const NORMALIZE_APPLY_THRESHOLD = 0.8;
/** Below this a near-match is ignored entirely (plain speech, not a term). */
export const NORMALIZE_MIN_THRESHOLD = 0.6;

const HEB_WORD_RE = /[\p{L}\p{N}']+/gu;

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n]!;
}

/** Hebrew inseparable prefixes ("לבאקו" -> "באקו"). */
function stripPrefix(token: string): string {
  return token.replace(/^(ל|ב|כ|מ|ה|ו|ש)(?=[\u0590-\u05FF]{3,})/u, "");
}

/**
 * A Hebrew token is ambiguous by construction: "באקו" both IS a term and
 * LOOKS like ב + "אקו". Both readings are kept so a bare term is never
 * mangled into its own stripped form.
 */
function forms(token: string): string[] {
  const stripped = stripPrefix(token);
  return stripped === token ? [token] : [token, stripped];
}

/**
 * Build the domain vocabulary from the active focus title first (strongest
 * signal) and then the rest of the catalogue.
 */
export function domainVocabulary(args: {
  focusTitle?: string | null;
  catalogTitles?: string[];
  recentText?: string[];
}): Array<{ term: string; weight: number }> {
  const out = new Map<string, number>();
  const add = (text: string | null | undefined, weight: number) => {
    for (const raw of String(text ?? "").match(HEB_WORD_RE) ?? []) {
      for (const t of forms(raw)) {
        if (t.length < 3) continue;
        out.set(t, Math.max(out.get(t) ?? 0, weight));
      }
    }
  };
  add(args.focusTitle, 1);
  for (const line of args.recentText ?? []) add(line, 0.85);
  for (const title of args.catalogTitles ?? []) add(title, 0.7);
  return Array.from(out.entries()).map(([term, weight]) => ({ term, weight }));
}

export function normalizeVoiceTranscript(args: {
  raw: string;
  focusTitle?: string | null;
  catalogTitles?: string[];
  recentText?: string[];
}): VoiceNormalization {
  const raw = String(args.raw ?? "");
  const base: VoiceNormalization = {
    raw,
    normalized: raw,
    changed: false,
    ambiguous: false,
    reason: null,
    confidence: 1,
    corrections: [],
  };
  if (!raw.trim()) return base;

  const vocab = domainVocabulary(args);
  if (!vocab.length) return base;

  const corrections: VoiceNormalization["corrections"] = [];
  let ambiguous = false;
  let lowest = 1;

  const normalized = raw.replace(HEB_WORD_RE, (token) => {
    const stems = forms(token).filter((f) => f.length >= 4);
    if (!stems.length) return token;
    // Already a known domain term — never touch it.
    if (forms(token).some((f) => vocab.some((v) => v.term === f))) return token;

    let best: { term: string; score: number; stem: string } | null = null;
    let runnerUp = 0;
    for (const stem of stems) {
      for (const { term, weight } of vocab) {
        if (Math.abs(term.length - stem.length) > 2) continue;
        const dist = levenshtein(term, stem);
        if (dist === 0 || dist > 2) continue;
        const similarity = 1 - dist / Math.max(term.length, stem.length);
        const score = similarity * weight;
        // Two spellings of the SAME domain term (with/without a Hebrew
        // prefix) are not competing candidates.
        const sameFamily = (a: string, b: string) => stripPrefix(a) === stripPrefix(b);
        if (!best || score > best.score) {
          if (best && !sameFamily(best.term, term)) runnerUp = Math.max(runnerUp, best.score);
          best = { term, score, stem };
        } else if (score > runnerUp && !sameFamily(best.term, term)) runnerUp = score;
      }
    }
    if (!best || best.score < NORMALIZE_MIN_THRESHOLD) return token;
    // Two equally plausible domain terms => do not guess.
    if (runnerUp > 0 && best.score - runnerUp < 0.05) {
      ambiguous = true;
      lowest = Math.min(lowest, best.score);
      return token;
    }
    if (best.score < NORMALIZE_APPLY_THRESHOLD) {
      ambiguous = true;
      lowest = Math.min(lowest, best.score);
      return token;
    }
    corrections.push({ from: token, to: best.term, confidence: Number(best.score.toFixed(3)) });
    lowest = Math.min(lowest, best.score);
    return token.replace(best.stem, best.term);
  });

  if (!corrections.length) {
    return { ...base, ambiguous, reason: ambiguous ? "low_confidence_domain_match" : null, confidence: ambiguous ? lowest : 1 };
  }
  return {
    raw,
    normalized,
    changed: true,
    ambiguous,
    reason: `domain_entity_correction:${corrections.map((c) => `${c.from}->${c.to}`).join(",")}`,
    confidence: Number(lowest.toFixed(3)),
    corrections,
  };
}

/** One concise clarification when speech could not be resolved safely. */
export function voiceClarificationText(): string {
  return "לא הצלחתי לשמוע במדויק את מה שאמרת. אפשר לכתוב לי במילה אחת על איזה טיול או אירוע מדובר?";
}
