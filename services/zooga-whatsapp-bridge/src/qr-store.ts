/**
 * Memory-only QR holder with a short TTL.
 * The QR payload is NEVER written to disk, database or logs.
 */

export type QrSnapshot = { text: string; dataUrl: string | null; expiresAt: number };

export class QrStore {
  private current: QrSnapshot | null = null;

  constructor(private readonly ttlMs: number) {}

  set(text: string, dataUrl: string | null, now = Date.now()): void {
    this.current = { text, dataUrl, expiresAt: now + this.ttlMs };
  }

  clear(): void {
    this.current = null;
  }

  get(now = Date.now()): QrSnapshot | null {
    if (!this.current) return null;
    if (this.current.expiresAt <= now) {
      this.current = null;
      return null;
    }
    return this.current;
  }

  available(now = Date.now()): boolean {
    return this.get(now) !== null;
  }
}
