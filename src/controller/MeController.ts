// /api/me/*: the signed-in person's own account.
import { RATE_LIMITS } from "../config/constants.ts";
import { ApiError } from "../http/ApiError.ts";
import type { Router } from "../http/Router.ts";
import { json } from "../http/responses.ts";
import { verifyGoogleToken } from "../security/GoogleTokenVerifier.ts";
import { userOut } from "../security/SessionManager.ts";
import type { Authed } from "./context.ts";

// The account as the app sees it, read again after a change.
const freshUser = async ({ http, app }: Authed) => json({ user: userOut((await app.sessions.currentUser(http))!) });

export class MeController {
  register(r: Router<Authed>) {
    r.post("/api/me/profile", this.updateProfile);
    r.post("/api/me/name", this.rename);
    r.post("/api/me/email/verify", this.sendEmailConfirmation);
    r.post("/api/me/google", this.connectGoogle);
    r.post("/api/me/google/disconnect", this.disconnectGoogle);
    r.post(/^\/api\/me\/(?:password|pin)$/, this.changePassword);
    r.post("/api/me/link", this.linkOtherAccount);
  }

  // Change my name, username and/or email.
  async updateProfile(a: Authed) {
    await a.app.limiter.check("profile", a.user.id, RATE_LIMITS.paymentMethodWrite);
    await a.app.account.updateProfile(a.user, await a.http.body(), a.http.url.origin);
    return freshUser(a);
  }

  // Kept for older app versions: change only my name.
  async rename({ http, app, user }: Authed) {
    await app.limiter.check("profile", user.id, RATE_LIMITS.paymentMethodWrite);
    const name = await app.account.rename(user.id, (await http.body())?.name);
    return json({ ok: true, id: user.id, name });
  }

  // Send (again) the link that confirms my email.
  async sendEmailConfirmation({ http, app, user }: Authed) {
    return json(await app.account.sendEmailConfirmation(user, http.url.origin, () => app.limiter.limited("verify-send", user.id, RATE_LIMITS.emailPerAccount)));
  }

  // Connect my Google account (then I can sign in with it).
  async connectGoogle(a: Authed) {
    if (!a.http.env.GOOGLE_CLIENT_ID) throw new ApiError("Google sign-in isn't set up yet.", 503);
    await a.app.limiter.check("link", a.user.id, RATE_LIMITS.link);
    const g = await verifyGoogleToken((await a.http.body())?.credential, a.http.env);
    await a.app.account.connectGoogle(a.user, g);
    return freshUser(a);
  }

  // Disconnect it (only if I have a password, so I can still get in).
  async disconnectGoogle(a: Authed) {
    await a.app.account.disconnectGoogle(a.user);
    return freshUser(a);
  }

  // Change my password (the current one is needed, if there is one).
  async changePassword({ http, app, user }: Authed) {
    await app.limiter.check("signin", user.id, RATE_LIMITS.signin);
    await app.account.changePassword(user, await http.body());
    return json({ ok: true });
  }

  // "I had another account": everything of it moves into this one.
  async linkOtherAccount({ http, app, user }: Authed) {
    await app.limiter.check("link", user.id, RATE_LIMITS.link);
    const merged = await app.account.linkOtherAccount(user, await http.body());
    return json({ ok: true, merged });
  }
}
