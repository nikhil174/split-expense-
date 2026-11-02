// appx_user_sessions (signed-in devices) and appx_group_unlocks (groups
// opened with their PIN on a device).

export type SessionWithUser = {
  expires_at: number; admin_until: number | null; id: string; display_name: string; username: string; email: string | null; legacy: number;
  site_role: string | null; google: number; emailVerified: number; hasPin: number;
};

export class SessionRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  findWithUser(tokenHash: string) {
    return this.db.prepare("SELECT s.expires_at,s.admin_until,u.id,u.display_name,u.username,u.email,u.legacy,u.site_role,u.google_sub IS NOT NULL AS google,u.email_verified_at IS NOT NULL AS emailVerified,u.pin_hash IS NOT NULL AS hasPin FROM appx_user_sessions s JOIN appx_users u ON u.id=s.user_id WHERE s.token_hash=?").bind(tokenHash).first<SessionWithUser>();
  }
  delete(tokenHash: string) { return this.db.prepare("DELETE FROM appx_user_sessions WHERE token_hash=?").bind(tokenHash).run(); }
  insert(tokenHash: string, userId: string, expiresAt: number) { return this.db.prepare("INSERT INTO appx_user_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(tokenHash, userId, expiresAt).run(); }
  deleteExpired(now: number) { return this.db.prepare("DELETE FROM appx_user_sessions WHERE expires_at<?").bind(now).run(); }
  deleteStmt(tokenHash: string) { return this.db.prepare("DELETE FROM appx_user_sessions WHERE token_hash=?").bind(tokenHash); }
  deleteForUserStmt(userId: string) { return this.db.prepare("DELETE FROM appx_user_sessions WHERE user_id=?").bind(userId); }
  setAdminUntilStmt(tokenHash: string, until: number) { return this.db.prepare("UPDATE appx_user_sessions SET admin_until=? WHERE token_hash=?").bind(until, tokenHash); }
  clearAdminUntil(tokenHash: string) { return this.db.prepare("UPDATE appx_user_sessions SET admin_until=NULL WHERE token_hash=?").bind(tokenHash).run(); }

  // ----- Group unlocks -----
  unlockStmt(sessionHash: string, groupId: string, until: number) {
    return this.db.prepare("INSERT INTO appx_group_unlocks(session_hash,group_id,until) VALUES(?1,?2,?3) ON CONFLICT(session_hash,group_id) DO UPDATE SET until=?3").bind(sessionHash, groupId, until);
  }
  isUnlocked(sessionHash: string, groupId: string, now: number) { return this.db.prepare("SELECT 1 FROM appx_group_unlocks WHERE session_hash=? AND group_id=? AND until>?").bind(sessionHash, groupId, now).first(); }
  deleteExpiredUnlocksStmt(now: number) { return this.db.prepare("DELETE FROM appx_group_unlocks WHERE until<?").bind(now); }
  deleteUnlocksForGroupStmt(groupId: string) { return this.db.prepare("DELETE FROM appx_group_unlocks WHERE group_id=?").bind(groupId); }
  deleteUnlocksForSessionStmt(sessionHash: string) { return this.db.prepare("DELETE FROM appx_group_unlocks WHERE session_hash=?").bind(sessionHash); }
  deleteUnlocksForUserStmt(userId: string) { return this.db.prepare("DELETE FROM appx_group_unlocks WHERE session_hash IN (SELECT token_hash FROM appx_user_sessions WHERE user_id=?)").bind(userId); }
}
