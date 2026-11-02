// Fixed-window rate limits, per scope (what is limited) and key (who).
import type { Clock } from "../config/Clock.ts";
import type { RateLimit } from "../config/constants.ts";
import { tooMany } from "../http/ApiError.ts";
import type { RateLimitRepository } from "../repository/RateLimitRepository.ts";

export class RateLimiter {
  private readonly counters: RateLimitRepository;
  private readonly clock: Clock;
  constructor(counters: RateLimitRepository, clock: Clock) { this.counters = counters; this.clock = clock; }

  // The start of the current fixed window.
  private windowStart(windowMs: number): number { const now = this.clock.now(); return now - (now % windowMs); }

  // Counts one attempt; true when the caller is over the limit. Fails open
  // (logged) if the table is missing so a skipped migration does not lock
  // everyone out; apply migration 0006 to enable it.
  async limited(scope: string, key: string, { limit, windowMs }: RateLimit): Promise<boolean> {
    try {
      return await this.counters.increment(scope + ":" + key, this.windowStart(windowMs)) > limit;
    } catch (error) {
      console.error("Rate limiting unavailable:", String(error));
      return false;
    }
  }

  // Counts one attempt and refuses (429) when over the limit.
  async check(scope: string, key: string, limit: RateLimit): Promise<void> {
    if (await this.limited(scope, key, limit)) throw tooMany();
  }

  // How many attempts this window already has, without counting one.
  async count(scope: string, key: string, { windowMs }: RateLimit): Promise<number> {
    try { return await this.counters.count(scope + ":" + key, this.windowStart(windowMs)); } catch { return 0; }
  }
}
