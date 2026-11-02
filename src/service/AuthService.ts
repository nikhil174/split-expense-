// Creating accounts and proving who you are: sign-up, sign-in (username,
// email, or group and name for old accounts), Google, and email links.
import { EMAIL_RE, USERNAME_RE } from "../config/constants.ts";
import type { AppEnv } from "../config/env.ts";
import { cleanName, normEmail, normUsername } from "../domain/text.ts";
import { ApiError, conflict, notFound, tooMany } from "../http/ApiError.ts";
import { emailEnabled } from "../integration/email.ts";
import type { EmailTokenRepository } from "../repository/EmailTokenRepository.ts";
import type { SessionRepository } from "../repository/SessionRepository.ts";
import type { Transaction } from "../repository/Transaction.ts";
import type { UserRepository } from "../repository/UserRepository.ts";
import { changesOf } from "../repository/db.ts";
import type { UserRow } from "../repository/types.ts";
import type { AccountPasswordGuard } from "../security/AccountPasswordGuard.ts";
import type { GoogleIdentity } from "../security/GoogleTokenVerifier.ts";
import type { PasswordHasher } from "../security/PasswordHasher.ts";
import { newId } from "../security/crypto.ts";
import { goodPassword, PASSWORD_HINT, passwordOf } from "../security/passwords.ts";
import type { EmailLinkService } from "./EmailLinkService.ts";

export const USERNAME_HINT = "Usernames are 3–30 characters: letters, numbers, _ or ., starting with a letter.";
const LINK_GONE = "This reset link has expired or was already used. Ask for a new one.";

export class AuthService {
  private readonly env: AppEnv;
  private readonly tx: Transaction;
  private readonly users: UserRepository;
  private readonly sessions: SessionRepository;
  private readonly tokens: EmailTokenRepository;
  private readonly hasher: PasswordHasher;
  private readonly passwords: AccountPasswordGuard;
  private readonly emailLinks: EmailLinkService;
  constructor(deps: { env: AppEnv; tx: Transaction; users: UserRepository; sessions: SessionRepository; tokens: EmailTokenRepository; hasher: PasswordHasher; passwords: AccountPasswordGuard; emailLinks: EmailLinkService }) {
    this.env = deps.env; this.tx = deps.tx; this.users = deps.users; this.sessions = deps.sessions; this.tokens = deps.tokens;
    this.hasher = deps.hasher; this.passwords = deps.passwords; this.emailLinks = deps.emailLinks;
  }

  // Create an account: name, username (unique), optional email, password.
  // Returns the new account's id.
  async signUp(b: any, origin: string): Promise<string> {
    const name = cleanName(b?.name), username = normUsername(b?.username), email = b?.email ? normEmail(b.email) : null, pin = passwordOf(b);
    if (name.length < 2 || name.length > 60) throw new ApiError("Enter your name (2–60 characters).");
    if (!USERNAME_RE.test(username)) throw new ApiError(USERNAME_HINT);
    if (email && (!EMAIL_RE.test(email) || email.length > 254)) throw new ApiError("Enter a valid email, or leave it empty.");
    if (!goodPassword(pin)) throw new ApiError(PASSWORD_HINT);
    if (await this.users.usernameExists(username)) throw conflict("That username is taken. Try another.");
    if (email && await this.users.emailExists(email)) throw conflict("That email is already used by another account. Sign in instead.");
    const uid = newId();
    try {
      await this.users.insertWithPassword(uid, username, name, email, await this.hasher.hash(pin), Date.now());
    } catch (e) {
      // Someone took the username or email a moment earlier.
      if (String(e).toLowerCase().includes("unique")) throw conflict("That username or email was just taken. Try again.");
      throw e;
    }
    if (email && emailEnabled(this.env)) await this.emailLinks.sendQuietly(origin, { id: uid, name, email }, "verify", "verify email");
    return uid;
  }

  // Is this username free (for the sign-up and profile forms)? Free also when
  // it's the asker's own; `me` is asked only for valid, existing usernames.
  async usernameAvailability(raw: unknown, me: () => Promise<{ id: string } | null>) {
    const username = normUsername(raw);
    if (!USERNAME_RE.test(username)) return { username, valid: false, available: false };
    const taken = await this.users.idByUsername(username);
    const u = await me();
    return { username, valid: true, available: !taken || taken.id === u?.id };
  }

  // Sign in with username or email + password. Returns the account.
  async signIn(b: any): Promise<UserRow> {
    const user = await this.users.findByLogin(b?.login);
    if (!user) throw notFound("No account with that username or email. Check it, or create an account.");
    await this.passwords.checkSignIn(user, b);
    return user;
  }

  // Accounts from before usernames: sign in with the group's name and your
  // name in it (then choose a username in your profile).
  async legacySignIn(b: any): Promise<UserRow> {
    if (!cleanName(b?.group) || !cleanName(b?.name)) throw new ApiError("Enter the group's name and your name in it.");
    const user = await this.users.findLegacy(b?.group, b?.name);
    if (user === "ambiguous") throw conflict("More than one account matches. Sign in with your username instead, or ask a group admin for it.");
    if (!user) throw notFound("No one with that name in a group with that name. Check both, or sign in with your username.");
    await this.passwords.checkSignIn(user, b);
    return user;
  }

  // Forgot password: a reset link to the account's confirmed email (at most 3
  // an hour per account). The caller answers the same either way.
  async forgot(login: unknown, origin: string, accountLimited: (uid: string) => Promise<boolean>): Promise<void> {
    const who = await this.users.findByLogin(login);
    if (who?.email && (await this.users.emailVerifiedAt(who.id))?.email_verified_at && !await accountLimited(who.id)) {
      await this.emailLinks.sendQuietly(origin, { id: who.id, name: who.display_name, email: who.email }, "reset", "reset email");
    }
  }

  async resetLink(token: string) {
    const t = await this.emailLinks.find(token, "reset");
    if (!t) throw new ApiError(LINK_GONE, 410);
    return { ok: true, username: t.username, name: t.display_name };
  }

  // Choose a new password with a reset link: signs out every device.
  // Returns the account to sign in on this one.
  async reset(b: any): Promise<string> {
    const t = await this.emailLinks.find(b?.token, "reset");
    if (!t) throw new ApiError(LINK_GONE, 410);
    const next = passwordOf(b);
    if (!goodPassword(next)) throw new ApiError(PASSWORD_HINT);
    const done = await this.tokens.useOnce(t.token_hash, Date.now());
    if (changesOf(done) !== 1) throw new ApiError("This reset link was already used.", 410);
    await this.tx.run([
      this.users.setPasswordStmt(t.user_id, await this.hasher.hash(next)),
      this.sessions.deleteUnlocksForUserStmt(t.user_id),
      this.sessions.deleteForUserStmt(t.user_id),
      this.tokens.deleteUnusedResetsStmt(t.user_id),
    ]);
    return t.user_id;
  }

  // Confirm an email with the link we sent (works signed in or out).
  async verifyEmail(token: unknown) {
    const t = await this.emailLinks.find(token, "verify");
    if (!t) throw new ApiError("This link has expired or was already used. Send a new one from your profile.", 410);
    await this.tx.run([
      this.tokens.markUsedStmt(t.token_hash, Date.now()),
      this.users.markEmailVerifiedStmt(t.user_id, t.email, Date.now()),
    ]);
    return { ok: true, email: t.email };
  }

  // Continue with Google: the account connected to this Google account, or a
  // new one if its email is new. An existing account with that email isn't
  // taken over (emails on password accounts aren't verified): they sign in
  // with their password and connect Google in Profile.
  async google(g: GoogleIdentity, signupLimited: () => Promise<boolean>): Promise<{ id: string; created: boolean }> {
    const known = await this.users.idByGoogle(g.sub);
    if (known) return { id: known.id, created: false };
    if (await this.users.emailExists(g.email)) {
      throw conflict(`An account already uses ${g.email}. Sign in with its username and password, then connect Google in your profile.`, { code: "email_taken" });
    }
    if (await signupLimited()) throw tooMany();
    const uid = newId();
    try {
      await this.users.insertWithGoogle(uid, await this.freeUsername(g.name), g.name.length >= 2 ? g.name : "Split It user", g.email, g.sub, Date.now(), Date.now());
    } catch (e) {
      if (String(e).toLowerCase().includes("unique")) throw conflict("Something changed at the same moment. Try again.");
      throw e;
    }
    return { id: uid, created: true };
  }

  // A free username from a name: "Vicky Rao" -> "vickyrao", or "vickyrao_4821".
  private async freeUsername(name: string): Promise<string> {
    let base = String(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "").slice(0, 20);
    if (!/^[a-z]/.test(base)) base = "user" + base;
    if (base.length < 3) base = base.padEnd(3, "0");
    for (let i = 0; i < 20; i++) {
      const u = i ? base + "_" + String(1000 + Math.floor(Math.random() * 9000)) : base;
      if (!await this.users.usernameExists(u)) return u;
    }
    return "user_" + newId().replace(/-/g, "").slice(0, 10);
  }
}
