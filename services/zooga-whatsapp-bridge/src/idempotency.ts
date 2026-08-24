/**
 * Compact persistent idempotency ledger (JSON file under DATA_DIR).
 * Retains entries for at least 7 days so retries cannot duplicate a group send.
 * Stores no chat ids, no phone numbers and no message bodies — only a hash.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type LedgerEntry = { at: number; message_id: string | null; timestamp: number | null };

export function ledgerKey(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);
}

export class IdempotencyLedger {
  private entries = new Map<string, LedgerEntry>();

  constructor(
    private readonly filePath: string,
    private readonly ttlMs: number,
  ) {
    this.load();
  }

  static atDataDir(dataDir: string, ttlMs: number): IdempotencyLedger {
    return new IdempotencyLedger(join(dataDir, "idempotency.json"), ttlMs);
  }

  private load() {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as Record<string, LedgerEntry>;
      for (const [k, v] of Object.entries(raw)) this.entries.set(k, v);
      this.prune();
    } catch {
      this.entries.clear();
    }
  }

  private persist() {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.entries)), "utf8");
      renameSync(tmp, this.filePath);
    } catch {
      // Ledger persistence failure must not leak paths or crash a send.
    }
  }

  prune(now = Date.now()): number {
    let removed = 0;
    for (const [k, v] of this.entries) {
      if (now - v.at > this.ttlMs) {
        this.entries.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  get(idempotencyKey: string, now = Date.now()): LedgerEntry | null {
    const entry = this.entries.get(ledgerKey(idempotencyKey));
    if (!entry) return null;
    if (now - entry.at > this.ttlMs) return null;
    return entry;
  }

  record(idempotencyKey: string, result: Omit<LedgerEntry, "at">, now = Date.now()): LedgerEntry {
    const entry: LedgerEntry = { at: now, ...result };
    this.entries.set(ledgerKey(idempotencyKey), entry);
    this.prune(now);
    this.persist();
    return entry;
  }

  get size(): number {
    return this.entries.size;
  }
}
