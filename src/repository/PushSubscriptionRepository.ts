// appx_push_subscriptions: phones/browsers that turned notifications on.

export class PushSubscriptionRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  // Saves this browser for this person, and keeps at most 10 per person.
  saveStmts(uid: string, sub: { endpoint: string; p256dh: string; auth: string }, now: number) {
    return [
      this.db.prepare("INSERT INTO appx_push_subscriptions(endpoint,member_id,p256dh,auth,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(endpoint) DO UPDATE SET member_id=excluded.member_id,p256dh=excluded.p256dh,auth=excluded.auth,created_at=excluded.created_at").bind(sub.endpoint, uid, sub.p256dh, sub.auth, now),
      // At most 10 devices per person: forget the oldest.
      this.db.prepare("DELETE FROM appx_push_subscriptions WHERE member_id=?1 AND endpoint NOT IN (SELECT endpoint FROM appx_push_subscriptions WHERE member_id=?1 ORDER BY created_at DESC LIMIT 10)").bind(uid),
    ];
  }
  delete(endpoint: string, uid: string) { return this.db.prepare("DELETE FROM appx_push_subscriptions WHERE endpoint=? AND member_id=?").bind(endpoint, uid).run(); }
}
