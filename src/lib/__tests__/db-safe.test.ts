import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { quiet } from "@/lib/db-safe";

/** supabase-js builders: thenable, no `catch` — exactly like production. */
function fakeQuery<T>(value: T, fail = false): PromiseLike<T> {
  return {
    then(onOk: any, onErr: any) {
      return fail ? Promise.resolve().then(() => onErr(new Error("boom"))) : Promise.resolve(value).then(onOk);
    },
  } as PromiseLike<T>;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe("db-safe", () => {
  it("resolves a thenable query", async () => {
    expect(await quiet(fakeQuery({ data: 1 }))).toEqual({ data: 1 });
  });

  it("swallows a rejecting query instead of throwing", async () => {
    expect(await quiet(fakeQuery(null, true))).toBeNull();
  });

  it("a builder has no .catch — the pattern that broke the reply pipeline", () => {
    expect((fakeQuery(1) as any).catch).toBeUndefined();
  });

  it("no source file calls .catch() directly on a supabase query builder", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (file.includes("db-safe")) continue; // helper + this test document the bad pattern
      const src = readFileSync(file, "utf8");
      const re =
        /(?:db\(\)|supabaseAdmin|supabase)\s*\r?\n?\s*\.from\((?:[^;]|\n){0,1200}?\)\s*\r?\n?\s*\.catch\(/g;
      if (re.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
