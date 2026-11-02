// The daily cleanup of rows that have expired and are never read again.
// Nothing about money or history is touched.
import { DAY, NOTIFICATION_KEEP_MS } from "../config/constants.ts";

export class HousekeepingRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async removeExpired(now: number) {
    const results = await this.db.batch([
      this.db.prepare("DELETE FROM appx_user_sessions WHERE expires_at < ?").bind(now),
      this.db.prepare("DELETE FROM appx_group_unlocks WHERE until < ?").bind(now),
      // The longest rate-limit window or lockout is an hour.
      this.db.prepare("DELETE FROM appx_rate_limits WHERE window_start < ?").bind(now - DAY),
      this.db.prepare("DELETE FROM appx_email_tokens WHERE expires_at < ? OR used_at < ?").bind(now - DAY, now - DAY),
      // Notifications already read and older than 90 days.
      this.db.prepare("DELETE FROM appx_notifications WHERE read_at IS NOT NULL AND created_at < ?").bind(now - NOTIFICATION_KEEP_MS),
    ]);
    const [sessions, unlocks, rateLimits, emailLinks, notifications] = results.map(r => r.meta?.changes ?? 0);
    return { sessions, unlocks, rateLimits, emailLinks, notifications };
  }
}
