import { describe, it, expect } from "vitest";
import { parseRows, parsePasted, mergeResults, renderScript } from "../campaign-audience";

describe("campaign-audience", () => {
  it("uses Hebrew headers", () => {
    const r = parseRows([["טלפון", "שם מלא"], ["054-1234567", "דנה"], ["0541234567", "כפול"], ["xx", "רע"]]);
    expect(r.valid).toEqual([{ phone: "972541234567", name: "דנה" }]);
    expect(r.duplicates).toBe(1);
    expect(r.invalid.length).toBe(1);
  });
  it("uses English headers", () => {
    const r = parseRows([["Name", "Mobile"], ["Ron", "+972 52 111 2222"]]);
    expect(r.valid).toEqual([{ phone: "972521112222", name: "Ron" }]);
  });
  it("parses pasted without headers and merges", () => {
    const a = parsePasted("דנה, 0541234567\n0521112222");
    expect(a.valid).toEqual([{ phone: "972541234567", name: "דנה" }, { phone: "972521112222", name: "" }]);
    const m = mergeResults(a, parsePasted("0541234567"));
    expect(m.valid.length).toBe(2);
    expect(m.duplicates).toBe(1);
  });
  it("renders placeholder", () => expect(renderScript("היי [שם]!", "דנה")).toBe("היי דנה!"));
});
