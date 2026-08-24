/** Per-process/per-session send rate limiting. */

export type RateDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; code: "min_interval" | "per_minute_cap" };

export class SendRateLimiter {
  private lastSendAt: number | null = null;
  private window: number[] = [];

  constructor(
    private readonly minIntervalMs: number,
    private readonly maxPerMinute: number,
  ) {}

  check(now = Date.now()): RateDecision {
    if (this.lastSendAt !== null) {
      const sinceLast = now - this.lastSendAt;
      if (sinceLast < this.minIntervalMs) {
        return {
          allowed: false,
          code: "min_interval",
          retryAfterSeconds: Math.max(1, Math.ceil((this.minIntervalMs - sinceLast) / 1000)),
        };
      }
    }

    this.window = this.window.filter((t) => now - t < 60_000);
    if (this.window.length >= this.maxPerMinute) {
      const oldest = this.window[0] ?? now;
      return {
        allowed: false,
        code: "per_minute_cap",
        retryAfterSeconds: Math.max(1, Math.ceil((60_000 - (now - oldest)) / 1000)),
      };
    }
    return { allowed: true };
  }

  commit(now = Date.now()): void {
    this.lastSendAt = now;
    this.window.push(now);
  }
}

/** Bounded jitter, 500–1500ms. */
export function jitterMs(random: () => number = Math.random): number {
  return 500 + Math.floor(random() * 1000);
}
