/**
 * SOURCE SCAN — the banned automatic "welcome back" copy must never reappear.
 *
 * Fails if the exact removed string (or its close canned variants) is found
 * anywhere in the project source, routes, tests, fixtures or migrations.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const BANNED = [
  "שמחים שחזרת! נמשיך לעדכן אותך",
  "שמחה שחזרת",
];

function scan(pattern: string): string[] {
  try {
    const out = execFileSync(
      "rg",
      [
        "--fixed-strings",
        "--line-number",
        "--glob",
        "!node_modules",
        "--glob",
        "!**/no-welcome-back-copy.test.ts",
        pattern,
        ".",
      ],
      { encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean);
  } catch (err: any) {
    // ripgrep exits 1 when there are no matches — that is the passing case.
    if (err?.status === 1) return [];
    throw err;
  }
}

describe("banned welcome-back copy", () => {
  for (const pattern of BANNED) {
    it(`is absent from the whole project: ${pattern.slice(0, 18)}…`, () => {
      expect(scan(pattern)).toEqual([]);
    });
  }
});
