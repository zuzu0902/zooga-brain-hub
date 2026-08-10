/**
 * CONVERSATION PROGRESS GUARD — pure logic, no I/O.
 *
 * One rule governs every Tamar reply path (deterministic intake, LLM,
 * fallback, menu/button reply, campaign reply): a turn may only be sent when
 * it moves the conversation forward. The same question is never asked twice
 * in a row, may be rephrased exactly once, and never a third time.
 */

/** A previously recorded Tamar turn, newest first. */
export type TurnRecord = {
  asked_field: string | null;
  question_signature: string | null;
  response_signature?: string | null;
  normalized_intent?: string | null;
  progress_made: boolean;
  repeat_count?: number;
  created_at?: string;
  /** Route that produced the turn. Loop detection is route-AGNOSTIC. */
  route?: string | null;
};

const NIQQUD = /[\u0591-\u05C7]/g;
const PUNCT = /[.,!?;:'"״׳()\[\]{}\-–—…]/g;
const STOPWORDS = new Set([
  "את", "אתה", "אני", "של", "עם", "כדי", "מה", "האם", "יש", "לך", "לי", "על",
  "אותך", "הכי", "גם", "או", "זה", "זו", "הוא", "היא", "כן", "לא", "ה", "ב", "ל",
]);

/** Gender-neutral Hebrew forms ("את/ה", "גר/ה") collapse to one token. */
export function normalizeText(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(NIQQUD, "")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/([\u0590-\u05FF])\/[\u0590-\u05FF]{1,2}(?![\u0590-\u05FF])/gu, "$1")
    .replace(PUNCT, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function contentWords(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Stable signature of a question: sorted content words. */
export function questionSignature(text: string | null | undefined): string {
  const words = Array.from(new Set(contentWords(String(text ?? ""))));
  if (!words.length) return normalizeText(text).slice(0, 60);
  return words.sort().join("|").slice(0, 300);
}

export function responseSignature(text: string | null | undefined): string {
  return questionSignature(text);
}

/** Two questions are equivalent when they ask for the same thing. */
export function semanticallyEquivalent(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const A = new Set(a.split("|").filter(Boolean));
  const B = new Set(b.split("|").filter(Boolean));
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union > 0 && inter / union >= 0.6;
}

// ---------------------------------------------------------------- signals

const LOOP_SIGNAL_RE =
  /(כבר\s*(עניתי|אמרתי|ענית[יי]?|כתבתי|סיפרתי)|אמרתי\s*לך|לא\s*הבנת|את\s*חוזרת|שוב\s*אותה\s*שאלה|שאלת\s*כבר|זה\s*אותו\s*דבר|למה\s*את\s*שואלת\s*שוב|תפסיקי\s*לחזור)/;

/** "You already asked me that" — the highest-priority loop signal. */
export function detectLoopSignal(text: string | null | undefined): boolean {
  return LOOP_SIGNAL_RE.test(normalizeText(text));
}

const DONT_KNOW_RE =
  /(לא\s*מכיר|לא\s*יודע|לא\s*ידוע|אין\s*לי\s*מושג|לא\s*בטוח|לא\s*הבנתי|מה\s*זאת\s*אומרת|לא\s*ברור|לא\s*יודעת|לא\s*מכירה|לא\s*מבין|לא\s*מבינה)/;

/** Not a refusal and not an answer — the customer needs help, not a re-ask. */
export function isDontKnowAnswer(text: string | null | undefined): boolean {
  return DONT_KNOW_RE.test(normalizeText(text));
}

// -------------------------------------------------------------- invariant

export type ProgressFlags = {
  answered_user_intent?: boolean;
  saved_new_fact?: boolean;
  advanced_state?: boolean;
  clarified_ambiguity?: boolean;
  provided_requested_info?: boolean;
  performed_handoff?: boolean;
  valid_policy_close?: boolean;
};

export function progressMade(flags: ProgressFlags | null | undefined): boolean {
  if (!flags) return false;
  return Object.values(flags).some(Boolean);
}

// ------------------------------------------------------------- evaluation

export type GuardVerdict = "send" | "rephrase" | "recovery";

export type GuardResult = {
  verdict: GuardVerdict;
  reason: string;
  repeat_count: number;
  question_signature: string;
  loop_signal: boolean;
  text: string;
  /** Distinct routes among the repeats that produced this verdict. */
  routes_involved?: string[];
  /** True when the repeats came from more than one reply route. */
  cross_route?: boolean;
};

export const OPEN_QUESTION = "מה הכי חשוב לך שנדבר עליו עכשיו?";

export function buildRephrase(question: string, purpose?: string | null): string {
  const why = purpose ? ` (${purpose})` : "";
  return `רק כדי שאתאים לך נכון${why} — ${question}\nואם לא מתאים לענות עכשיו, כתבי/כתוב "דלג" ונמשיך הלאה.`;
}

export function buildRecovery(summary?: string | null): string {
  const head = summary ? `הבנתי — ${summary}. ` : "סליחה, לא רוצה לחזור על עצמי. ";
  return `${head}${OPEN_QUESTION}`;
}

export function buildLoopApology(summary?: string | null): string {
  const head = summary ? `צודק/ת, כבר אמרת: ${summary}. ` : "צודק/ת, סליחה שחזרתי על עצמי. ";
  return `${head}${OPEN_QUESTION}`;
}

/**
 * Decide whether a candidate outbound reply may be sent as-is.
 *
 * @param recentTurns last Tamar turns, NEWEST FIRST (only the last 3 count).
 */
export function evaluateOutbound(args: {
  candidateText: string;
  askedField?: string | null;
  inboundText?: string | null;
  recentTurns?: TurnRecord[];
  progress?: ProgressFlags | null;
  summary?: string | null;
  purpose?: string | null;
}): GuardResult {
  const sig = questionSignature(args.candidateText);
  // Session/contact level: the last 3 Tamar turns of this contact from ALL
  // routes together. A loop that alternates baseline_intake -> tamar_engine
  // -> relationship_intake is therefore still detected.
  const recent = (args.recentTurns ?? []).slice(0, 3);
  const loop = detectLoopSignal(args.inboundText);

  const repeats = recent.filter(
    (t) =>
      (args.askedField && t.asked_field && t.asked_field === args.askedField) ||
      semanticallyEquivalent(t.question_signature ?? null, sig),
  );
  const repeat = repeats.length;
  const routesInvolved = Array.from(
    new Set(repeats.map((t) => String(t.route ?? "unknown"))),
  );

  const base = {
    repeat_count: repeat,
    question_signature: sig,
    loop_signal: loop,
    routes_involved: routesInvolved,
    cross_route: routesInvolved.length > 1,
  };

  if (loop) {
    return { ...base, verdict: "recovery", reason: "loop_signal_from_user", text: buildLoopApology(args.summary) };
  }

  // Two consecutive Tamar turns without progress => hand control back.
  const stalled = recent.length >= 2 && recent.slice(0, 2).every((t) => !t.progress_made);
  if (stalled && !progressMade(args.progress)) {
    return { ...base, verdict: "recovery", reason: "no_progress_two_turns", text: buildRecovery(args.summary) };
  }

  if (repeat >= 2) {
    return { ...base, verdict: "recovery", reason: "question_exhausted", text: buildRecovery(args.summary) };
  }
  if (repeat === 1) {
    return {
      ...base,
      verdict: "rephrase",
      reason: "second_and_final_attempt",
      text: buildRephrase(args.candidateText, args.purpose ?? null),
    };
  }

  if (!progressMade(args.progress) && recent.length && !recent[0]!.progress_made) {
    return { ...base, verdict: "recovery", reason: "progress_invariant_violated", text: buildRecovery(args.summary) };
  }

  return { ...base, verdict: "send", reason: "ok", text: args.candidateText };
}
