// /api/groups, /api/invitations, /api/join/:code, and a group's own
// settings: opening it with its PIN, the PIN, invite link, leaving,
// renaming, deleting.
import { RATE_LIMITS } from "../config/constants.ts";
import { notFound } from "../http/ApiError.ts";
import { json } from "../http/responses.ts";
import type { Router } from "../http/Router.ts";
import type { Authed, InGroup } from "./context.ts";

export class GroupController {
  register(r: Router<Authed>) {
    r.post("/api/groups", this.create);
    r.get("/api/invitations", this.invitations);
    r.post(/^\/api\/groups\/([\w-]+)\/invitation\/(accept|decline)$/, this.answerInvitation);
    r.get("/api/groups", this.list);
    r.any(/^\/api\/join\/([\w-]{10,40})$/, this.joinLink);
  }

  // Inside a group (paths relative to /api/groups/:id/).
  registerInGroup(r: Router<InGroup>) {
    r.post("pin", this.setPin);
    r.get("", this.detail);
    r.any(/^invite-link(?:\/(reset|off))?$/, this.inviteLink);
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

  // Groups I've been invited to and haven't answered yet.
  async invitations({ app, user }: Authed) { return json(await app.groups.invitations(user)); }

  // Accept (with the group's PIN) or decline an invitation.
  async answerInvitation({ http, app, user }: Authed, [gid, action]: string[]) {
    return json(action === "decline"
      ? await app.groups.declineInvitation(user, gid)
      : await app.groups.acceptInvitation(user, gid, async () => (await http.body())?.pin));
  }

  // An invite link / QR: GET shows which group it is; POST asks to join
  // (with the group's PIN). A group admin then approves.
  async joinLink({ http, app, user }: Authed, [code]: string[]) {
    const link = await app.groups.joinLink(user, code);
    if (http.method === "GET") return json({ groupId: link.g.id, groupName: link.g.name, memberCount: link.memberCount, hasPin: !!link.g.pin_hash, status: link.status });
    if (http.method !== "POST") throw notFound();
    return json(await app.groups.join(user, link, () => app.limiter.limited("join", user.id, RATE_LIMITS.invite), async () => (await http.body())?.pin));
  }

  // ----- Inside a group -----
  async setPin({ http, app, scope }: InGroup) {
    return json(await app.groups.setPin(scope, async () => (await http.body())?.pin));
  }

  async detail({ app, scope }: InGroup) { return json(await app.groups.detail(scope)); }

  // GET: the link (everyone in the group); POST reset|off: admins replace
  // it or turn it off.
  async inviteLink({ http, app, scope }: InGroup, [action]: string[]) {
    if (http.method === "GET" && !action) return json(await app.groups.inviteLink(scope));
    if (http.method !== "POST") throw notFound();
    return json(await app.groups.changeInviteLink(scope, action === "reset" ? "reset" : "off"));
  }

  async leave({ app, scope }: InGroup) { return json(await app.groups.leave(scope)); }

  async rename({ http, app, scope }: InGroup) {
    return json(await app.groups.rename(scope, async () => (await http.body())?.name));
  }

  async delete({ app, scope }: InGroup) { return json(await app.groups.delete(scope)); }
}
