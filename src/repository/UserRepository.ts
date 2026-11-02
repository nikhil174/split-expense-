// appx_users: accounts.
import { cleanName, isEmailLogin, normEmail, normUsername } from "../domain/text.ts";
import type { UserRow } from "./types.ts";

const LOGIN_COLS = "id,username,display_name,email,pin_hash,pin_failures,pin_locked_until,legacy,google_sub";

export class UserRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  // A username or email typed to find someone (sign-in, invites, linking).
  async findByLogin(login: unknown): Promise<UserRow | null> {
    const v = String(login ?? "").trim();
    if (!v) return null;
    if (isEmailLogin(v)) return this.db.prepare(`SELECT ${LOGIN_COLS} FROM appx_users WHERE email=?`).bind(normEmail(v)).first<UserRow>();
    return this.db.prepare(`SELECT ${LOGIN_COLS} FROM appx_users WHERE username=?`).bind(normUsername(v)).first<UserRow>();
  }
  // Accounts from before usernames: found by a group's name and their name in it.
  async findLegacy(groupName: unknown, name: unknown): Promise<UserRow | "ambiguous" | null> {
    const r = await this.db.prepare("SELECT DISTINCT u.id,u.username,u.display_name,u.email,u.pin_hash,u.pin_failures,u.pin_locked_until,u.legacy FROM appx_group_members m JOIN appx_groups g ON g.id=m.group_id JOIN appx_users u ON u.id=m.member_id WHERE lower(trim(g.name))=lower(?) AND lower(m.name)=lower(?) AND m.status IN ('active','pending') AND u.legacy=1 LIMIT 2").bind(cleanName(groupName), cleanName(name)).all<UserRow>();
    return r.results.length === 1 ? r.results[0] : r.results.length ? "ambiguous" : null;
  }
  usernameExists(username: string) { return this.db.prepare("SELECT 1 FROM appx_users WHERE username=?").bind(username).first(); }
  emailExists(email: string) { return this.db.prepare("SELECT 1 FROM appx_users WHERE email=?").bind(email).first(); }
  idByUsername(username: string) { return this.db.prepare("SELECT id FROM appx_users WHERE username=?").bind(username).first<{ id: string }>(); }
  idByEmail(email: string) { return this.db.prepare("SELECT id FROM appx_users WHERE email=?").bind(email).first<{ id: string }>(); }
  idByGoogle(sub: string) { return this.db.prepare("SELECT id FROM appx_users WHERE google_sub=?").bind(sub).first<{ id: string }>(); }
  emailUsedByOther(email: string, uid: string) { return this.db.prepare("SELECT 1 FROM appx_users WHERE email=? AND id<>?").bind(email, uid).first(); }
  findForFriendRequest(id: string) { return this.db.prepare("SELECT id,display_name FROM appx_users WHERE id=?").bind(id).first<{ id: string; display_name: string }>(); }
  displayName(id: string) { return this.db.prepare("SELECT display_name FROM appx_users WHERE id=?").bind(id).first<{ display_name: string }>(); }
  emailVerifiedAt(id: string) { return this.db.prepare("SELECT email_verified_at FROM appx_users WHERE id=?").bind(id).first<{ email_verified_at: number | null }>(); }
  passwordRow(id: string) { return this.db.prepare("SELECT id,pin_hash,pin_failures,pin_locked_until FROM appx_users WHERE id=?").bind(id).first<UserRow>(); }
  passwordHash(id: string) { return this.db.prepare("SELECT pin_hash FROM appx_users WHERE id=?").bind(id).first<{ pin_hash: string | null }>(); }
  siteRole(id: string) { return this.db.prepare("SELECT site_role FROM appx_users WHERE id=?").bind(id).first<{ site_role: string | null }>(); }
  siteOwnerExists() { return this.db.prepare("SELECT 1 FROM appx_users WHERE site_role='admin'").first(); }

  insertWithPassword(uid: string, username: string, name: string, email: string | null, pinHash: string, now: number) {
    return this.db.prepare("INSERT INTO appx_users(id,username,display_name,email,pin_hash,created_at) VALUES(?,?,?,?,?,?)").bind(uid, username, name, email, pinHash, now).run();
  }
  insertWithGoogle(uid: string, username: string, name: string, email: string, sub: string, now: number, verifiedAt: number) {
    return this.db.prepare("INSERT INTO appx_users(id,username,display_name,email,google_sub,created_at,email_verified_at) VALUES(?,?,?,?,?,?,?)").bind(uid, username, name, email, sub, now, verifiedAt).run();
  }

  // ----- Passwords -----
  setPasswordIfUnset(id: string, pinHash: string) { return this.db.prepare("UPDATE appx_users SET pin_hash=?,pin_failures=0,pin_locked_until=NULL WHERE id=? AND pin_hash IS NULL").bind(pinHash, id).run(); }
  setAdminPasswordIfUnset(pinHash: string) { return this.db.prepare("UPDATE appx_users SET pin_hash=?,pin_failures=0,pin_locked_until=NULL WHERE id='admin' AND pin_hash IS NULL").bind(pinHash).run(); }
  clearFailures(id: string) { return this.db.prepare("UPDATE appx_users SET pin_failures=0,pin_locked_until=NULL WHERE id=?").bind(id).run(); }
  setFailures(id: string, failures: number, lockedUntil: number | null) { return this.db.prepare("UPDATE appx_users SET pin_failures=?,pin_locked_until=? WHERE id=?").bind(failures, lockedUntil, id).run(); }
  setPassword(id: string, pinHash: string) { return this.db.prepare("UPDATE appx_users SET pin_hash=?,pin_failures=0,pin_locked_until=NULL WHERE id=?").bind(pinHash, id).run(); }
  setPasswordStmt(id: string, pinHash: string) { return this.db.prepare("UPDATE appx_users SET pin_hash=?,pin_failures=0,pin_locked_until=NULL WHERE id=?").bind(pinHash, id); }

  // ----- Profile -----
  setUsername(id: string, username: string) { return this.db.prepare("UPDATE appx_users SET username=?,legacy=0 WHERE id=?").bind(username, id).run(); }
  setEmail(id: string, email: string | null) { return this.db.prepare("UPDATE appx_users SET email=?,email_verified_at=NULL WHERE id=?").bind(email, id).run(); }
  setDisplayNameStmt(id: string, name: string) { return this.db.prepare("UPDATE appx_users SET display_name=? WHERE id=?").bind(name, id); }
  markEmailVerifiedStmt(id: string, email: string, at: number) { return this.db.prepare("UPDATE appx_users SET email_verified_at=? WHERE id=? AND email=?").bind(at, id, email); }

  // ----- Google -----
  connectGoogleWithEmail(id: string, sub: string, email: string, at: number) { return this.db.prepare("UPDATE appx_users SET google_sub=?,email=?,email_verified_at=? WHERE id=?").bind(sub, email, at, id).run(); }
  connectGoogleSameEmail(id: string, sub: string, at: number) { return this.db.prepare("UPDATE appx_users SET google_sub=?,email_verified_at=COALESCE(email_verified_at,?) WHERE id=?").bind(sub, at, id).run(); }
  connectGoogle(id: string, sub: string) { return this.db.prepare("UPDATE appx_users SET google_sub=? WHERE id=?").bind(sub, id).run(); }
  disconnectGoogle(id: string) { return this.db.prepare("UPDATE appx_users SET google_sub=NULL WHERE id=?").bind(id).run(); }

  // ----- Site owner -----
  claimSiteOwnerStmt(id: string) { return this.db.prepare("UPDATE appx_users SET site_role='admin' WHERE id=? AND NOT EXISTS (SELECT 1 FROM appx_users WHERE site_role='admin')").bind(id); }
  deleteStmt(id: string) { return this.db.prepare("DELETE FROM appx_users WHERE id=?").bind(id); }
}
