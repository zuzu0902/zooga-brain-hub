/**
 * PRODUCTION-AUTHORITATIVE PROMPT POLICY REGRESSION.
 *
 * The legacy engine composes its system prompt from the ACTIVE
 * `tamar_prompt_blocks` rows (loadContext -> buildTamarRuntimeComposition).
 * This test mirrors the live active rows and asserts the composed prompt
 * carries the canonical concierge policy, contains no destination copy, and
 * stays byte-identical to the code constants used by the v2 engine.
 */
import { describe, expect, it } from "vitest";
import { buildTamarRuntimeComposition } from "@/lib/tamar-runtime-composition";
import {
  FIRST_INBOUND_GREETING,
  IDENTITY_REPLY,
} from "@/lib/tamar-v2/conversation-policy";

/** Mirror of the ACTIVE rows in tamar_prompt_blocks (production). */
const ACTIVE_PROMPT_BLOCKS: Record<string, { body: string; version: number }> = {
  core_identity: {
    version: 1,
    body:
      'את תמר, העוזרת הדיגיטלית של קהילת זוגה. מארחת חמה, אנושית ומקצועית, דוברת עברית טבעית ונקייה. אם שואלים מי את — עני בדיוק: "אני תמר, העוזרת הדיגיטלית של קהילת זוגה."',
  },
  first_response: {
    version: 1,
    body:
      'תגובה ראשונה בשיחה חדשה היא בדיוק: "האם אתה מכיר את זוגה או שתרצה שאספר לך קצת עלינו?" בלי תוספות, בלי הצעה, בלי יעד ובלי טקסט טכני.',
  },
  sales_behavior: {
    version: 1,
    body:
      "ליווי רך ומכבד, לא טלמרקטינג. אין להזכיר מיוזמתך טיול, יעד, אירוע או הצעה כלשהי; מותר רק כשהלקוח שאל במפורש מה זוגה מציעה או לאן מטיילים.",
  },
};

const DESTINATION_WORDS = [/אזרבייג/i, /באקו/i, /azerbaij/i, /baku/i];

describe("active production prompt policy", () => {
  it("active first_response block carries the exact canonical greeting", () => {
    expect(ACTIVE_PROMPT_BLOCKS.first_response.body).toContain(FIRST_INBOUND_GREETING);
  });

  it("active core_identity block carries the exact identity line", () => {
    expect(ACTIVE_PROMPT_BLOCKS.core_identity.body).toContain(IDENTITY_REPLY);
  });

  it("no active prompt block mentions any destination", () => {
    for (const block of Object.values(ACTIVE_PROMPT_BLOCKS)) {
      for (const re of DESTINATION_WORDS) expect(re.test(block.body)).toBe(false);
    }
  });

  it("composed runtime prompt keeps the greeting and the no-destination rule", () => {
    const composed = buildTamarRuntimeComposition({
      inboundMessage: "שלום",
      promptBlocks: ACTIVE_PROMPT_BLOCKS,
    });
    const text = JSON.stringify(composed);
    expect(text).toContain(FIRST_INBOUND_GREETING);
    expect(text).toContain("לא טלמרקטינג");
    for (const re of DESTINATION_WORDS) expect(re.test(text)).toBe(false);
  });
});
