// ----- Email links -----
// "Confirm your email" (24 h) and "reset your password" (30 min, only to a
// confirmed email). The link carries a random token; only its hash is kept,
// a new link replaces older unused ones, and each works once.
import { EMAIL_LINK_MS } from "../config/constants.ts";
import type { AppEnv } from "../config/env.ts";
import { linkEmail, sendEmail } from "../integration/email.ts";
import type { EmailTokenRepository } from "../repository/EmailTokenRepository.ts";
import type { EmailTokenRow } from "../repository/types.ts";
import { newUrlToken, sha256Hex } from "../security/crypto.ts";

export type LinkPurpose = "verify" | "reset";

export class EmailLinkService {
  private readonly env: AppEnv;
  private readonly db: D1Database;
  private readonly tokens: EmailTokenRepository;
  constructor(env: AppEnv, db: D1Database, tokens: EmailTokenRepository) { this.env = env; this.db = db; this.tokens = tokens; }

  async send(origin: string, user: { id: string; name: string; email: string }, purpose: LinkPurpose): Promise<void> {
    const token = newUrlToken() + newUrlToken(), now = Date.now();
    await this.db.batch([
      this.tokens.deleteUnusedStmt(user.id, purpose),
      this.tokens.insertStmt(await sha256Hex(token), user.id, purpose, user.email, now + EMAIL_LINK_MS[purpose]),
    ]);
    const url = origin + (purpose === "reset" ? "/#/reset/" : "/#/verify-email/") + token;
    const mail = purpose === "reset"
      ? linkEmail({ name: user.name, intro: "Someone (hopefully you) asked to reset your Split It password. Tap the button to choose a new one. The link works once, for 30 minutes.", button: "Choose a new password", url, outro: "Didn't ask? Ignore this email: your password stays the same." })
      : linkEmail({ name: user.name, intro: "Please confirm this is your email for Split It. Then you can use it to reset your password if you ever forget it.", button: "Confirm my email", url, outro: "Didn't sign up for Split It? Ignore this email." });
    await sendEmail(this.env, { to: user.email, toName: user.name, subject: purpose === "reset" ? "Reset your Split It password" : "Confirm your email for Split It", ...mail });
  }

  // Sends a link, logging (not failing) when the email service is down.
  async sendQuietly(origin: string, user: { id: string; name: string; email: string }, purpose: LinkPurpose, what: string): Promise<void> {
    try { await this.send(origin, user, purpose); } catch (e) { console.error(what, String(e)); }
  }

  // The token's row, if it's for this purpose, unused, unexpired, and the
  // account still has that email.
  async find(token: unknown, purpose: LinkPurpose): Promise<EmailTokenRow | null> {
    const t = await this.tokens.find(await sha256Hex(String(token || "")), purpose);
    if (!t || t.used_at || t.expires_at < Date.now() || t.email !== t.currentEmail) return null;
    return t;
  }
}
