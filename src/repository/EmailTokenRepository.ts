// appx_email_tokens: one-time email links (only their hashes are stored).
import type { EmailTokenRow } from "./types.ts";

export class EmailTokenRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  deleteUnusedStmt(uid: string, purpose: string) { return this.db.prepare("DELETE FROM appx_email_tokens WHERE user_id=? AND purpose=? AND used_at IS NULL").bind(uid, purpose); }
  insertStmt(tokenHash: string, uid: string, purpose: string, email: string, expiresAt: number) {
    return this.db.prepare("INSERT INTO appx_email_tokens(token_hash,user_id,purpose,email,expires_at) VALUES(?,?,?,?,?)").bind(tokenHash, uid, purpose, email, expiresAt);
  }
  find(tokenHash: string, purpose: string) {
    return this.db.prepare("SELECT t.token_hash,t.user_id,t.email,t.expires_at,t.used_at,u.email AS currentEmail,u.username,u.display_name FROM appx_email_tokens t JOIN appx_users u ON u.id=t.user_id WHERE t.token_hash=? AND t.purpose=?").bind(tokenHash, purpose).first<EmailTokenRow>();
  }
  // Marks it used if it wasn't (the number of rows changed says which).
  useOnce(tokenHash: string, now: number) { return this.db.prepare("UPDATE appx_email_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL").bind(now, tokenHash).run(); }
  markUsedStmt(tokenHash: string, now: number) { return this.db.prepare("UPDATE appx_email_tokens SET used_at=? WHERE token_hash=?").bind(now, tokenHash); }
  deleteUnusedResetsStmt(uid: string) { return this.db.prepare("DELETE FROM appx_email_tokens WHERE user_id=? AND purpose='reset' AND used_at IS NULL").bind(uid); }
}
