// The signed-in person's own account: profile, password, Google, linking
// another account of theirs.
import { EMAIL_RE, USERNAME_RE } from "../config/constants.ts";
import type { AppEnv } from "../config/env.ts";
import { emailEnabled } from "../integration/email.ts";
import { ApiError, conflict, notFound } from "../http/ApiError.ts";
import type { AccountMergeRepository } from "../repository/AccountMergeRepository.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import { cleanName, normEmail, normUsername, type UserRepository } from "../repository/UserRepository.ts";
import type { CurrentUser } from "../repository/types.ts";
import type { AccountPasswordGuard } from "../security/AccountPasswordGuard.ts";
import type { GoogleIdentity } from "../security/GoogleTokenVerifier.ts";
import type { PasswordHasher } from "../security/PasswordHasher.ts";
import { goodPassword, PASSWORD_HINT, passwordOf } from "../security/passwords.ts";
import { USERNAME_HINT } from "./AuthService.ts";
import type { EmailLinkService } from "./EmailLinkService.ts";

export class AccountService {
  private readonly env: AppEnv;
  private readonly db: D1Database;
  private readonly users: UserRepository;
  private readonly groups: GroupRepository;
  private readonly merges: AccountMergeRepository;
  private readonly hasher: PasswordHasher;
  private readonly passwords: AccountPasswordGuard;
  private readonly emailLinks: EmailLinkService;
  constructor(deps: { env: AppEnv; db: D1Database; users: UserRepository; groups: GroupRepository; merges: AccountMergeRepository; hasher: PasswordHasher; passwords: AccountPasswordGuard; emailLinks: EmailLinkService }) {
    this.env = deps.env; this.db = deps.db; this.users = deps.users; this.groups = deps.groups; this.merges = deps.merges;
    this.hasher = deps.hasher; this.passwords = deps.passwords; this.emailLinks = deps.emailLinks;
  }

  // Change my name, username and/or email (each only when given).
  async updateProfile(u: CurrentUser, b: any, origin: string): Promise<void> {
    if (b?.username !== undefined) {
      const username = normUsername(b.username);
      if (!USERNAME_RE.test(username)) throw new ApiError(USERNAME_HINT);
      const taken = await this.users.idByUsername(username);
      if (taken && taken.id !== u.id) throw conflict("That username is taken. Try another.");
      // Choosing a username ends the one-time "group and name" sign-in.
      await this.users.setUsername(u.id, username);
    }
    if (b?.email !== undefined) {
      const email = b.email ? normEmail(b.email) : null;
      if (email && (!EMAIL_RE.test(email) || email.length > 254)) throw new ApiError("Enter a valid email, or leave it empty.");
      const taken = email && await this.users.idByEmail(email);
      if (taken && taken.id !== u.id) throw conflict("That email is already used by another account.");
      if (email !== u.email) {
        await this.users.setEmail(u.id, email);
        if (email && emailEnabled(this.env)) await this.emailLinks.sendQuietly(origin, { id: u.id, name: u.name, email }, "verify", "verify email");
      }
    }
    if (b?.name !== undefined) await this.rename(u.id, b.name);
  }

  // A person changes their name: on their account and in every group they are
  // or were in (so past expenses and payments, stored by id, show it too).
  async rename(uid: string, rawName: unknown): Promise<string> {
    const name = cleanName(rawName);
    if (name.length < 2 || name.length > 60) throw new ApiError("Name must be 2–60 characters.");
    await this.db.batch([this.users.setDisplayNameStmt(uid, name), this.groups.renameMemberEverywhereStmt(uid, name)]);
    return name;
  }

  // Send (again) the link that confirms my email.
  async sendEmailConfirmation(u: CurrentUser, origin: string, limited: () => Promise<boolean>) {
    if (!emailEnabled(this.env)) throw new ApiError("Email isn't set up yet.", 503);
    if (!u.email) throw conflict("Add an email first.");
    if (u.emailVerified) return { ok: true, alreadyVerified: true };
    if (await limited()) throw new ApiError("Too many attempts. Please wait a few minutes and try again.", 429);
    try { await this.emailLinks.send(origin, { id: u.id, name: u.name, email: u.email }, "verify"); } catch (e) { console.error("verify email", String(e)); throw new ApiError("Couldn't send the email right now. Try again later.", 502); }
    return { ok: true, sentTo: u.email };
  }

  // Connect my Google account (then I can sign in with it). It also becomes
  // my (confirmed) email when I have none.
  async connectGoogle(u: CurrentUser, g: GoogleIdentity): Promise<void> {
    const owner = await this.users.idByGoogle(g.sub);
    if (owner && owner.id !== u.id) throw conflict("That Google account is already connected to another Split It account.");
    const emailFree = !u.email && !(await this.users.emailUsedByOther(g.email, u.id));
    if (emailFree) await this.users.connectGoogleWithEmail(u.id, g.sub, g.email, Date.now());
    else if (u.email === g.email) await this.users.connectGoogleSameEmail(u.id, g.sub, Date.now());
    else await this.users.connectGoogle(u.id, g.sub);
  }

  // Disconnect Google, only with a password (so I can still get in).
  async disconnectGoogle(u: CurrentUser): Promise<void> {
    if (!u.hasPin) throw conflict("Add a password first, so you can still sign in without Google.");
    await this.users.disconnectGoogle(u.id);
  }

  // Change my password (the current one is needed, if there is one).
  async changePassword(u: CurrentUser, b: any): Promise<void> {
    const newPin = passwordOf(b, "newPassword");
    if (!goodPassword(newPin)) throw new ApiError(PASSWORD_HINT);
    const row = (await this.users.passwordRow(u.id))!;
    if (row.pin_hash) {
      if (!passwordOf(b, "currentPassword")) throw new ApiError("Enter your current password.");
      await this.passwords.check(row, passwordOf(b, "currentPassword"));
    }
    await this.users.setPassword(u.id, await this.hasher.hash(newPin));
  }

  // "I had another account": prove it with that account's username (or its
  // group and name) and password, then everything of it moves into this one.
  // Returns the other account's name.
  async linkOtherAccount(u: CurrentUser, b: any): Promise<string> {
    const other = b?.login ? await this.users.findByLogin(b.login) : await this.users.findLegacy(b?.group, b?.name);
    if (other === "ambiguous") throw conflict("More than one account matches. Use that account's username instead.");
    if (!other) throw notFound("No account found. Check the username, or the group and name.");
    if (other.id === u.id) throw conflict("That's the account you're signed in to.");
    if (!other.pin_hash) throw conflict("That account has no password yet. Sign in to it once to set one, then link it here.");
    if (!passwordOf(b)) throw new ApiError("Enter that account's password.");
    await this.passwords.check(other, passwordOf(b));
    await this.db.batch(await this.merges.mergeStatements(u.id, other.id));
    return other.display_name;
  }
}
