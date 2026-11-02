// /api/groups (create, my list) and a group's own settings: its details,
// PIN, leaving, renaming and deleting.
import { RATE_LIMITS } from "../config/constants.ts";
import type { Router } from "../http/Router.ts";
import { json } from "../http/responses.ts";
import type { Authed, InGroup } from "./context.ts";

export class GroupController {
  register(r: Router<Authed>) {
    r.post("/api/groups", this.create);
    r.get("/api/groups", this.list);
  }

  // Inside a group (paths relative to /api/groups/:id/).
  registerInGroup(r: Router<InGroup>) {
    r.post("pin", this.setPin);
    r.get("", this.detail);
    r.post("leave", this.leave);
    r.post("rename", this.rename);
    r.post("delete", this.delete);
  }

  // Anyone can create a group; they are its first admin.
  async create({ http, app, user }: Authed) {
    await app.limiter.check("group", user.id, RATE_LIMITS.groupWrite);
    return json(await app.groups.create(user, await http.body()), 201);
  }

  async list({ app, user }: Authed) { return json(await app.groups.listMine(user)); }

  async detail({ app, scope }: InGroup) { return json(await app.groups.detail(scope)); }

  // An admin sets or changes the group's PIN.
  async setPin({ http, app, scope }: InGroup) {
    return json(await app.groupAccess.setPin(scope, async () => (await http.body())?.pin));
  }

  async leave({ app, scope }: InGroup) { return json(await app.groups.leave(scope)); }

  async rename({ http, app, scope }: InGroup) {
    return json(await app.groups.rename(scope, async () => (await http.body())?.name));
  }

  async delete({ app, scope }: InGroup) { return json(await app.groups.delete(scope)); }
}
