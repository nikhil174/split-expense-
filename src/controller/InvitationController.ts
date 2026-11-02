// Getting into a group: /api/invitations, answering an invitation,
// /api/join/:code (invite link / QR), and a group's invite link.
import { RATE_LIMITS } from "../config/constants.ts";
import { notFound } from "../http/ApiError.ts";
import type { Router } from "../http/Router.ts";
import { json } from "../http/responses.ts";
import type { Authed, InGroup } from "./context.ts";

export class InvitationController {
  register(r: Router<Authed>) {
    r.get("/api/invitations", this.invitations);
    r.post(/^\/api\/groups\/([\w-]+)\/invitation\/(accept|decline)$/, this.answerInvitation);
    r.any(/^\/api\/join\/([\w-]{10,40})$/, this.joinLink);
  }

  // Inside a group (paths relative to /api/groups/:id/).
  registerInGroup(r: Router<InGroup>) {
    r.any(/^invite-link(?:\/(reset|off))?$/, this.inviteLink);
  }

  // Groups I've been invited to and haven't answered yet.
  async invitations({ app, user }: Authed) { return json(await app.invitations.invitations(user)); }

  // Accept (with the group's PIN) or decline an invitation.
  async answerInvitation({ http, app, user }: Authed, [gid, action]: string[]) {
    return json(action === "decline"
      ? await app.invitations.declineInvitation(user, gid)
      : await app.invitations.acceptInvitation(user, gid, async () => (await http.body())?.pin));
  }

  // An invite link / QR: GET shows which group it is; POST asks to join
  // (with the group's PIN). A group admin then approves.
  async joinLink({ http, app, user }: Authed, [code]: string[]) {
    const link = await app.invitations.joinLink(user, code);
    if (http.method === "GET") return json({ groupId: link.g.id, groupName: link.g.name, memberCount: link.memberCount, hasPin: !!link.g.pin_hash, status: link.status });
    if (http.method !== "POST") throw notFound();
    return json(await app.invitations.join(user, link, () => app.limiter.limited("join", user.id, RATE_LIMITS.invite), async () => (await http.body())?.pin));
  }

  // GET: the link (everyone in the group); POST reset|off: admins replace
  // it or turn it off.
  async inviteLink({ http, app, scope }: InGroup, [action]: string[]) {
    if (http.method === "GET" && !action) return json(await app.invitations.inviteLink(scope));
    if (http.method !== "POST") throw notFound();
    return json(await app.invitations.changeInviteLink(scope, action === "reset" ? "reset" : "off"));
  }
}
