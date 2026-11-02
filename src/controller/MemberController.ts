// /api/groups/:id/members/*: inviting people and managing who is in a group.
import { RATE_LIMITS } from "../config/constants.ts";
import type { Router } from "../http/Router.ts";
import { json } from "../http/responses.ts";
import type { MemberAction } from "../service/MembershipService.ts";
import type { InGroup } from "./context.ts";

export class MemberController {
  registerInGroup(r: Router<InGroup>) {
    r.post("members/invite", this.invite);
    r.post(/^members\/([\w-]+)\/(approve|reject|remove|cancel-invite|make-admin|make-member)$/, this.manage);
  }

  // Invite by username or email (admins), or suggest a friend (members).
  async invite({ http, app, user, scope }: InGroup) {
    await app.limiter.check("invite", user.id, RATE_LIMITS.invite);
    return json(await app.members.invite(scope, (await http.body())?.login));
  }

  async manage({ app, scope }: InGroup, [mid, action]: string[]) {
    return json(await app.members.manage(scope, mid, action as MemberAction));
  }
}
