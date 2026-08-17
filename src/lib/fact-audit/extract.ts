/**
 * DETERMINISTIC + AI FACT PROPOSAL (PURE).
 *
 * Identical for typed text and voice transcripts. Deterministic facts are
 * explicit; AI facts are merged in as inferred and can never overwrite an
 * explicit value (enforced downstream by the truth hierarchy).
 */
import { extractConversationFacts } from "@/lib/offer-catalog/facts";
import type { ProposedFact } from "./audit";

const BUDGET_RE = /(?:עד|תקציב\s*(?:של)?|סביב|כ-?)\s*([\d,]{3,7})\s*(?:₪|שקל|שח|\$|דולר|אירו|€)?/;
const DATE_RANGE_RE = /(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s*(?:-|עד|–)\s*(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/;
const CORRECTION_RE = /(לא\s*אמרתי|זו\s*טעות|תמחקי?|כבר\s*לא|התכוונתי\s*ל|בעצם\s*לא)/i;

export type ExtractInput = {
  text: string;
  sourceType: "text" | "voice" | "interactive";
  /** optional AI-proposed facts (always merged as inferred) */
  aiFacts?: Record<string, string | null>;
};

export function proposeFacts(input: ExtractInput): ProposedFact[] {
  const text = String(input.text ?? "");
  const det = extractConversationFacts(text);
  const correction = CORRECTION_RE.test(text);
  const out: ProposedFact[] = [];
  const push = (field_key: string, value: string | null, confidence: number) => {
    if (value == null) return;
    out.push({ field_key, value, kind: "explicit", confidence, correction, evidence: text.slice(0, 240) });
  };

  push("destination", det.destination, 95);
  push("holiday", det.holiday, 90);
  if (det.months.length) push("travel_month", det.months.join(","), 85);
  push("travel_party", det.travel_party, 90);
  if (det.mobility_limit) push("mobility_limit", "true", 95);
  if (det.preferences.length) push("preferences", det.preferences.join(","), 80);

  const range = DATE_RANGE_RE.exec(text);
  if (range) push("travel_date_range", `${range[1]}-${range[2]}`, 90);

  const budget = BUDGET_RE.exec(text);
  if (budget) push("budget_signal", budget[1]!.replace(/,/g, ""), 75);

  for (const [field_key, value] of Object.entries(input.aiFacts ?? {})) {
    if (value == null || String(value).trim() === "") continue;
    if (out.some((p) => p.field_key === field_key)) continue; // deterministic wins
    out.push({
      field_key,
      value: String(value),
      kind: "inferred",
      confidence: 60,
      correction: false,
      evidence: `ai:${input.sourceType}`,
    });
  }

  return out;
}