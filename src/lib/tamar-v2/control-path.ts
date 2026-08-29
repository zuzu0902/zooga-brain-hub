/**
 * TAMAR V2 — DETERMINISTIC CONTROL PATHS (PURE, no I/O).
 *
 * Some turns are NOT generative. A conversation reset, the consent step, an
 * opt-out and a human handoff are control instructions: they are decided
 * before the Single Response Orchestrator, before any LLM plan, and they
 * always produce exactly one non-empty deterministic Hebrew envelope.
 *
 * Production defect this repairs: "נתחיל מחדש" selected an orchestrator
 * answer, the deterministic reset acknowledgement was then dropped by the
 * history deduplicator (`deduped_1`), the outbound body became empty and a
 * generic recovery fallback was sent instead.
 */
import { RESET_ACK_TEXT } from "./reset";

export const CONTROL_PATHS = ["conversation_reset", "consent", "opt_out", "handoff"] as const;
export type ControlPath = (typeof CONTROL_PATHS)[number];

/** Concise, honest reply used when nothing else can be produced safely. */
export const SAFE_ERROR_TEXT =
  "לא הצלחתי לנסח תשובה מדויקת כרגע. אפשר לכתוב לי שוב במשפט אחד מה חשוב לך, ואם תרצה/י אעביר אותך לאדם מהצוות.";

/** One concise clarification, used when no grounded answer is possible. */
export const SAFE_CLARIFY_TEXT =
  "רוצה לוודא שאני עונה בדיוק לעניין 🙂 על איזה טיול או אירוע מדובר, ומה בדיוק חשוב לך לדעת?";

export function detectControlPath(args: {
  resetRequested: boolean;
  state: string;
  wantsHuman: boolean;
  optOut?: boolean;
}): ControlPath | null {
  if (args.optOut) return "opt_out";
  if (args.state === "new_inbound" || args.state === "consent_asked") return "consent";
  if (args.state === "human_owned" || args.state === "human_handoff_queued") return "handoff";
  if (args.resetRequested) return "conversation_reset";
  if (args.wantsHuman) return "handoff";
  return null;
}

/**
 * Deterministic body for a control path. `consent` and `handoff` keep their
 * canonical copy inside the pure engine, so only the reset acknowledgement
 * is owned here; the others fall back to the engine copy through `fallback`.
 */
export function controlPathResponse(path: ControlPath | null, fallback?: string | null): string | null {
  if (path === "conversation_reset") return RESET_ACK_TEXT;
  const f = String(fallback ?? "").trim();
  return f || null;
}

export function isBlankBody(text: string | null | undefined): boolean {
  return !String(text ?? "").trim();
}

/**
 * FINAL INVARIANT: no send path may accept an empty/whitespace body.
 * A known control action reuses its deterministic response, anything else
 * gets the concise safe-error text with an explicit trace reason.
 */
export function finalBodyGuard(args: {
  bodies: string[];
  controlPath?: ControlPath | null;
  controlText?: string | null;
  safeText?: string | null;
}): { ok: boolean; replacement: string | null; reason: string | null } {
  const nonEmpty = args.bodies.filter((b) => !isBlankBody(b));
  if (nonEmpty.length) return { ok: true, replacement: null, reason: null };
  const control = controlPathResponse(args.controlPath ?? null, args.controlText ?? null);
  if (control) {
    return { ok: false, replacement: control, reason: `empty_body_control_${args.controlPath}` };
  }
  return {
    ok: false,
    replacement: String(args.safeText ?? "").trim() || SAFE_ERROR_TEXT,
    reason: "empty_body_safe_error",
  };
}

/**
 * Completeness guard: prose that OPENS with a dangling anaphora ("הוא כולל…")
 * lost its subject — typically because a destructive guard fallback removed
 * the first line. Such a fragment must never be sent.
 */
const DANGLING_RE =
  /^\s*(?:אז\s+|ו|כן,?\s*)?(הוא|היא|זה|זאת|הם|הן)\s+(כולל|כוללת|כוללים|כוללות|מתקיים|מתקיימת|מתאים|מתאימה|עולה|יוצא|יוצאת|נמשך|נמשכת|מיועד|מיועדת)/;

export function hasDanglingAnaphora(text: string | null | undefined): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return DANGLING_RE.test(t);
}
