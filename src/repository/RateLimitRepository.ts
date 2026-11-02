// appx_rate_limits: one fixed-window counter per bucket.

export class RateLimitRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  // Counts one attempt in this window (a new window starts again at 1) and
  // returns the count.
  async increment(bucket: string, windowStart: number): Promise<number> {
    const row = await this.db.prepare("INSERT INTO appx_rate_limits(bucket,window_start,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN appx_rate_limits.window_start=excluded.window_start THEN appx_rate_limits.count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count").bind(bucket, windowStart).first<{ count: number }>();
    return Number(row?.count);
  }

  // This window's count, without counting an attempt.
  async count(bucket: string, windowStart: number): Promise<number> {
    return Number((await this.db.prepare("SELECT count FROM appx_rate_limits WHERE bucket=? AND window_start=?").bind(bucket, windowStart).first<{ count: number }>())?.count || 0);
  }
}
