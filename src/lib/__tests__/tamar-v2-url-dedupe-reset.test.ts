/**
 * Narrow production corrections:
 *  A. the same verified URL may appear only ONCE in one outbound envelope.
 *  B. the reset control path returns the clean acknowledgement, first, with
 *     no intake lead-in.
 */
import { describe, expect, it } from "vitest";
import { canonicalUrl, dedupeUrlsInBody, planOutbound } from "@/lib/tamar-v2/envelope";
import { RESET_ACK_TEXT } from "@/lib/tamar-v2/reset";
import { controlPathResponse, detectControlPath } from "@/lib/tamar-v2/control-path";

const BAKU = "https://www.zooga.co.il/baku-2026";

describe("URL deduplication at the envelope boundary", () => {
  it("keeps exactly one occurrence of the Baku link in one outbound body", () => {
    const res = planOutbound({
      messages: [
        { kind: "text", body: `הטיול לבאקו כולל טיסות ומלון.\n${BAKU}` },
        { kind: "text", body: `לפרטים והרשמה: ${BAKU}` },
      ],
      grounding: { allowedUrls: [BAKU], groundedPerks: [] },
    });
    expect(res.messages).toHaveLength(1);
    const body = String((res.messages[0] as any).body);
    expect(body.split(BAKU).length - 1).toBe(1);
    expect(body).toContain("באקו");
    expect(body).toContain("לפרטים והרשמה");
  });

  it("preserves the first occurrence and order, and treats trailing slash as the same URL", () => {
    const out = dedupeUrlsInBody(`א ${BAKU}\nב ${BAKU}/\nג`);
    expect(out.split("://").length - 1).toBe(1);
    expect(out.indexOf(BAKU)).toBeLessThan(out.indexOf("ג"));
    expect(canonicalUrl(`${BAKU}/`)).toBe(canonicalUrl(BAKU));
  });

  it("keeps two DIFFERENT verified URLs", () => {
    const other = "https://www.zooga.co.il/vietnam";
    const out = dedupeUrlsInBody(`${BAKU}\n${other}`);
    expect(out).toContain(BAKU);
    expect(out).toContain(other);
  });
});

describe("reset control path copy", () => {
  it("is detected and answers with the clean acknowledgement", () => {
    const path = detectControlPath({ resetRequested: true, state: "value_delivered", wantsHuman: false });
    expect(path).toBe("conversation_reset");
    const body = controlPathResponse(path, "רק כדי שאתאים לך נכון — מאיזה אזור את/ה?")!;
    expect(body.startsWith("בשמחה, מתחילים מחדש")).toBe(true);
    expect(body).toBe(RESET_ACK_TEXT);
    expect(body).not.toContain("רק כדי שאתאים לך נכון");
    expect(body).not.toContain("דלג");
  });
});
