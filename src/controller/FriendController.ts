// /api/friends/*.
import { RATE_LIMITS } from "../config/constants.ts";
import { json } from "../http/responses.ts";
import type { Router } from "../http/Router.ts";
import type { Authed } from "./context.ts";

export class FriendController {
  register(r: Router<Authed>) {
    r.get("/api/friends", this.list);
    r.post("/api/friends/request", this.request);
    r.post(/^\/api\/friends\/([\w-]+)\/(accept|decline|remove)$/, this.act);
  }

  async list({ app, user }: Authed) { return json(await app.friends.list(user)); }

  async request({ http, app, user }: Authed) {
    await app.limiter.check("friend", user.id, RATE_LIMITS.invite);
    return json(await app.friends.request(user, await http.body()));
  }

  async act({ app, user }: Authed, [other, action]: string[]) {
    return json(await app.friends.act(user, other, action as "accept" | "decline" | "remove"));
  }
}
