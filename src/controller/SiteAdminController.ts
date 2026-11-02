// /api/site-admin/*: the site owner's console. To everyone but the site
// owner it doesn't exist (404); the owner opens it with the admin key.
import { RATE_LIMITS } from "../config/constants.ts";
import { cleanName } from "../domain/text.ts";
import { textField } from "../domain/text.ts";
import { ApiError, tooMany } from "../http/ApiError.ts";
import { Router } from "../http/Router.ts";
import { json } from "../http/responses.ts";
import { hidden } from "../service/SiteAdminService.ts";
import type { Authed } from "./context.ts";

type Console = Authed & { q: string };

export class SiteAdminController {
  // Only after the admin key, in this session.
  private readonly unlocked = new Router<Console>()
    .get("/api/site-admin/overview", ({ app }) => app.siteAdmin.overview().then(r => json(r)))
    .get("/api/site-admin/users", async ({ app, q }) => json(await app.siteAdmin.users(q)))
    .get("/api/site-admin/groups", async ({ app, q }) => json(await app.siteAdmin.groupList(q)))
    .post(/^\/api\/site-admin\/groups\/([\w-]+)\/reset-pin$/, async ({ app }, [gid]) => json(await app.siteAdmin.resetGroupPin(gid)));

  async handle(a: Authed): Promise<Response> {
    const { http, app, user } = a;
    if (http.method === "POST" && http.path === "/api/site-admin/unlock") {
      await app.siteAdmin.mayTryKey(user);
      if (await app.limiter.limited("admin-key", user.id, RATE_LIMITS.adminKey) || await app.limiter.limited("admin-key", await http.clientKey(), RATE_LIMITS.adminKey)) {
        throw tooMany();
      }
      return json(await app.siteAdmin.unlock(user, textField((await http.body())?.key)));
    }
    if (!user.siteAdmin) throw hidden();
    if (http.method === "POST" && http.path === "/api/site-admin/lock") return json(await app.siteAdmin.lock(user));
    if (!user.adminUnlocked) throw new ApiError("Enter the admin key to open the Admin tab.", 403, { code: "admin_locked" });
    const q = cleanName(http.query("q")).toLowerCase();
    const res = await this.unlocked.dispatch({ ...a, q }, http.method, http.path);
    if (!res) throw hidden();
    return res;
  }
}
