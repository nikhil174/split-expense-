// Sign-in sessions: an HttpOnly cookie holding a random token; the database
// keeps only its hash, with the account and an expiry.
import type { User } from "../../shared/api-types.ts";
import { SESSION_COOKIE, SESSION_MS } from "../config/constants.ts";
import { setCookie, type RequestContext } from "../http/RequestContext.ts";
import { json } from "../http/responses.ts";
import type { SessionRepository } from "../repository/SessionRepository.ts";
import type { CurrentUser } from "../repository/types.ts";
import { newId, sha256Hex } from "./crypto.ts";

// What the app is told about the signed-in person. siteAdmin: may open the
// Admin tab (the site owner); adminUnlocked: this session entered the admin
// key. Nobody else learns the Admin tab exists.
export const userOut = (u: CurrentUser): User => ({ id: u.id, name: u.name, username: u.username, email: u.email, legacy: u.legacy, hasPin: u.hasPin, google: u.google, emailVerified: !!(u.email && u.emailVerified), ...(u.siteAdmin && { siteAdmin: true, adminUnlocked: u.adminUnlocked }) });

export class SessionManager {
  private readonly sessions: SessionRepository;
  constructor(sessions: SessionRepository) { this.sessions = sessions; }

  // The signed-in person, from their session cookie, or null.
  async currentUser(ctx: RequestContext): Promise<CurrentUser | null> {
    const raw = ctx.cookie(SESSION_COOKIE);
    if (!raw) return null;
    const tokenHash = await sha256Hex(raw);
    const s = await this.sessions.findWithUser(tokenHash);
    if (!s || s.expires_at < Date.now()) {
      if (s) await this.sessions.delete(tokenHash);
      return null;
    }
    const siteAdmin = s.site_role === "admin";
    return { id: s.id, name: s.display_name, username: s.username, email: s.email || null, legacy: !!s.legacy, hasPin: !!s.hasPin, google: !!s.google, emailVerified: !!s.emailVerified,
      siteAdmin, adminUnlocked: siteAdmin && Number(s.admin_until) > Date.now(), tokenHash };
  }

  // Starts a session for an account: the response that sets its cookie.
  async start(userId: string, data: unknown = { ok: true }, status = 200): Promise<Response> {
    const token = newId() + newId(), expires = Date.now() + SESSION_MS;
    await this.sessions.insert(await sha256Hex(token), userId, expires);
    try { await this.sessions.deleteExpired(Date.now()); } catch {}
    return json(data, status, { "set-cookie": setCookie(SESSION_COOKIE, token, SESSION_MS / 1000) });
  }

  // Signs this device out (and forgets the groups it had open).
  async end(ctx: RequestContext): Promise<Response> {
    const raw = ctx.cookie(SESSION_COOKIE);
    if (raw) {
      const h = await sha256Hex(raw);
      await ctx.db.batch([this.sessions.deleteStmt(h), this.sessions.deleteUnlocksForSessionStmt(h)]);
    }
    return json({ ok: true }, 200, { "set-cookie": setCookie(SESSION_COOKIE, "", 0) });
  }
}
