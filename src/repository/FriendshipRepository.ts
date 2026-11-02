// appx_friendships: one row per pair (user_a < user_b), pending or accepted.

export const pairOf = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

export class FriendshipRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async areFriends(x: string, y: string): Promise<boolean> {
    const [a, b] = pairOf(x, y);
    return !!(await this.db.prepare("SELECT 1 FROM appx_friendships WHERE user_a=? AND user_b=? AND status='accepted'").bind(a, b).first());
  }
  find(a: string, b: string) { return this.db.prepare("SELECT status,requested_by FROM appx_friendships WHERE user_a=? AND user_b=?").bind(a, b).first<{ status: string; requested_by: string }>(); }
  // Everyone I'm friends with or have a request with, by name.
  listFor(uid: string) {
    return this.db.prepare("SELECT f.status,f.requested_by AS requestedBy,f.created_at AS createdAt,u.id,u.display_name AS name,u.username FROM appx_friendships f JOIN appx_users u ON u.id=CASE WHEN f.user_a=?1 THEN f.user_b ELSE f.user_a END WHERE f.user_a=?1 OR f.user_b=?1 ORDER BY lower(u.display_name)").bind(uid).all<{ status: string; requestedBy: string; createdAt: number; id: string; name: string; username: string }>();
  }
  // Where I stand with everyone: the other person, status and who asked.
  standingsOf(uid: string) {
    return this.db.prepare("SELECT CASE WHEN user_a=?1 THEN user_b ELSE user_a END AS other,status,requested_by FROM appx_friendships WHERE user_a=?1 OR user_b=?1").bind(uid).all<{ other: string; status: string; requested_by: string }>();
  }
  acceptStmt(a: string, b: string) { return this.db.prepare("UPDATE appx_friendships SET status='accepted' WHERE user_a=? AND user_b=?").bind(a, b); }
  requestStmt(a: string, b: string, by: string, now: number) { return this.db.prepare("INSERT INTO appx_friendships(user_a,user_b,requested_by,status,created_at) VALUES(?,?,?,'pending',?)").bind(a, b, by, now); }
  delete(a: string, b: string) { return this.db.prepare("DELETE FROM appx_friendships WHERE user_a=? AND user_b=?").bind(a, b).run(); }
}
