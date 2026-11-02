// /api/auth/*, /api/me, /api/logout: everything before (and including)
// signing in. These work signed out.
import { RATE_LIMITS } from "../config/constants.ts";
import { ApiError } from "../http/ApiError.ts";
import type { Router } from "../http/Router.ts";
import { json } from "../http/responses.ts";
import { emailEnabled } from "../integration/email.ts";
import { verifyGoogleToken } from "../security/GoogleTokenVerifier.ts";
import { userOut } from "../security/SessionManager.ts";
import type { Web } from "./context.ts";

export class AuthController {
  // Like @RequestMapping: which method handles which request.
  register(r: Router<Web>) {
    r.post("/api/auth/signup", this.signUp);
    r.get("/api/auth/username", this.usernameAvailable);
    r.post("/api/auth/signin", this.signIn);
    r.post("/api/auth/legacy-signin", this.legacySignIn);
    r.get("/api/auth/config", this.config);
    r.post("/api/auth/forgot", this.forgot);
    r.get(/^\/api\/auth\/reset\/([\w-]{20,80})$/, this.resetLink);
    r.post("/api/auth/reset", this.reset);
    r.post("/api/auth/verify-email", this.verifyEmail);
    r.post("/api/auth/google", this.google);
    r.get("/api/me", this.me);
    r.post("/api/logout", this.logout);
  }

  // Create an account: name, username (unique), optional email, password.
  async signUp({ http, app }: Web) {
    await app.limiter.check("signup", await http.clientKey(), RATE_LIMITS.signup);
    const uid = await app.auth.signUp(await http.body(), http.url.origin);
    return app.sessions.start(uid, { ok: true, id: uid }, 201);
  }

  // Is this username free? (For the sign-up and profile forms.)
  async usernameAvailable({ http, app }: Web) {
    return json(await app.auth.usernameAvailability(http.query("u"), () => app.sessions.currentUser(http)));
  }

  // Sign in with username or email + password.
  async signIn({ http, app }: Web) {
    await app.limiter.check("signin", await http.clientKey(), RATE_LIMITS.signin);
    const user = await app.auth.signIn(await http.body());
    return app.sessions.start(user.id, { ok: true, id: user.id, legacy: !!user.legacy });
  }

  // Accounts from before usernames: the group's name and their name in it.
  async legacySignIn({ http, app }: Web) {
    await app.limiter.check("signin", await http.clientKey(), RATE_LIMITS.signin);
    const user = await app.auth.legacySignIn(await http.body());
    return app.sessions.start(user.id, { ok: true, id: user.id, legacy: true });
  }

  // What the sign-in screen needs: the Google client id, if Google sign-in is set up.
  config({ http }: Web) {
    return json({ googleClientId: http.env.GOOGLE_CLIENT_ID || null, emailEnabled: emailEnabled(http.env) });
  }

  // Forgot password: the answer is the same whether or not the account
  // exists or has a confirmed email, so nobody can probe accounts with it.
  async forgot({ http, app }: Web) {
    if (!emailEnabled(http.env)) throw new ApiError("Password reset by email isn't set up yet.", 503);
    await app.limiter.check("forgot", await http.clientKey(), RATE_LIMITS.signup);
    await app.auth.forgot((await http.body())?.login, http.url.origin, uid => app.limiter.limited("forgot-user", uid, RATE_LIMITS.emailPerAccount));
    return json({ ok: true, message: "If that account has a confirmed email, we've sent it a link to reset the password. It works for 30 minutes. Check spam too." });
  }

  async resetLink({ app }: Web, [token]: string[]) {
    return json(await app.auth.resetLink(token));
  }

  // Choose a new password with a reset link: signs out every device, then
  // signs in here.
  async reset({ http, app }: Web) {
    await app.limiter.check("reset", await http.clientKey(), RATE_LIMITS.signin);
    const uid = await app.auth.reset(await http.body());
    return app.sessions.start(uid, { ok: true });
  }

  async verifyEmail({ http, app }: Web) {
    await app.limiter.check("verify", await http.clientKey(), RATE_LIMITS.signin);
    return json(await app.auth.verifyEmail((await http.body())?.token));
  }

  // Continue with Google: sign in, or create an account.
  async google({ http, app }: Web) {
    if (!http.env.GOOGLE_CLIENT_ID) throw new ApiError("Google sign-in isn't set up yet.", 503);
    await app.limiter.check("signin", await http.clientKey(), RATE_LIMITS.signin);
    const g = await verifyGoogleToken((await http.body())?.credential, http.env);
    const r = await app.auth.google(g, async () => app.limiter.limited("signup", await http.clientKey(), RATE_LIMITS.signup));
    return app.sessions.start(r.id, { ok: true, id: r.id, created: r.created }, r.created ? 201 : 200);
  }

  async me({ http, app }: Web) {
    const me = await app.sessions.currentUser(http);
    return json({ user: me ? userOut(me) : null });
  }

  logout({ http, app }: Web) {
    return app.sessions.end(http);
  }
}
