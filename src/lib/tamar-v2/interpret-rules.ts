/**
 * TAMAR BRAIN V2 — deterministic interpreter (pure).
 * Used as the model fallback AND as the interpreter in the offline
 * scenario suite, so policy tests never depend on a live model.
 */
import {
  classifyConsent,
  detectSafetySignal,
  isConfusion,
  isExplicitOptIn,
  isExplicitOptOut,
  isGreeting,
  isUserQuestion,
  wantsExplanation,
  wantsHuman,
} from "./classify";
import type { Interpretation } from "./types";

const REGION_RE = /(צפון|מרכז|דרום|ירושלים|שרון|שפלה)/;
const PARTNER_RE = /(זוג|בן\s?זוג|בת\s?זוג|ביחד|שנינו)/;
const SOLO_RE = /(לבד|יחיד|בעצמי|סולו)/;

export function interpretDeterministic(message: string | null | undefined): Interpretation {
  const raw = String(message ?? "").trim();
  const signal = detectSafetySignal(raw);
  const entities: Record<string, string> = {};
  const region = raw.match(REGION_RE)?.[1];
  if (region) entities["region"] = region;
  if (PARTNER_RE.test(raw)) entities["travel_party"] = "couple";
  else if (SOLO_RE.test(raw)) entities["travel_party"] = "solo";

  let intent = "unknown";
  let confidence = 55;
  if (!raw) {
    intent = "empty";
    confidence = 40;
  } else if (isExplicitOptOut(raw)) {
    intent = "opt_out";
    confidence = 95;
  } else if (isExplicitOptIn(raw)) {
    intent = "opt_in";
    confidence = 92;
  } else if (wantsHuman(raw)) {
    intent = "human_request";
    confidence = 95;
  } else if (isGreeting(raw)) {
    intent = "greeting";
    confidence = 95;
  } else if (isConfusion(raw)) {
    intent = "clarification_request";
    confidence = 90;
  } else if (wantsExplanation(raw)) {
    intent = "explain_request";
    confidence = 85;
  } else if (/(מחיר|כמה\s+עולה|עלות|תקציב)/.test(raw)) {
    intent = "price_question";
    confidence = 85;
  } else if (/(טיול|טיולים|חופשה|אירוע|הצעה|הצעות|מה\s+יש)/.test(raw)) {
    intent = "browse_offers";
    confidence = 82;
  } else if (isUserQuestion(raw)) {
    intent = "question";
    confidence = 75;
  } else if (raw.length > 2) {
    intent = "statement";
    confidence = 70;
  }

  const consent = classifyConsent(raw);
  return {
    intent,
    consent_answer: consent === "explain" ? "unknown" : consent,
    wants_human: wantsHuman(raw),
    confusion: isConfusion(raw),
    sentiment: signal.reason_codes.includes("distress")
      ? "distress"
      : signal.reason_codes.includes("complaint")
        ? "negative"
        : "neutral",
    entities,
    confidence,
    rationale: "deterministic rules",
    source: "deterministic",
  };
}
