// Fixed-window counters in D1 (appx_rate_limits), per scope and key.
import type { RateLimit } from "../config/constants.ts";
import { tooMany } from "../http/ApiError.ts";

export class RateLimiter {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  // Counts one attempt; true when the caller is over the limit. Fails open
  // (logged) if the table is missing so a skipped migration does not lock
  // everyone out; apply migration 0006 to enable it.
  async limited(scope: string, key: string, { limit, windowMs }: RateLimit): Promise<boolean> {
    const now = Date.now(), windowStart = now - (now % windowMs);
    try {
      const row = await this.db.prepare("INSERT INTO appx_rate_limits(bucket,window_start,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN appx_rate_limits.window_start=excluded.window_start THEN appx_rate_limits.count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count").bind(scope + ":" + key, windowStart).first<{ count: number }>();
      return Number(row?.count) > limit;
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
    const now = Date.now(), windowStart = now - (now % windowMs);
    try { return Number((await this.db.prepare("SELECT count FROM appx_rate_limits WHERE bucket=? AND window_start=?").bind(scope + ":" + key, windowStart).first<{ count: number }>())?.count || 0); } catch { return 0; }
  }
}
