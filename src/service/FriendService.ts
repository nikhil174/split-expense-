// Friends: ask by username or email; the other person accepts. Only exact
// matches: there is no browsing of people.
import type { Friends } from "../../shared/api-types.ts";
import { ApiError, conflict, notFound } from "../http/ApiError.ts";
import { pairOf, type FriendshipRepository } from "../repository/FriendshipRepository.ts";
import type { UserRepository } from "../repository/UserRepository.ts";
import type { CurrentUser } from "../repository/types.ts";
import { textField } from "../security/passwords.ts";
import type { Notifier } from "./Notifier.ts";

export class FriendService {
  private readonly db: D1Database;
  private readonly friendships: FriendshipRepository;
  private readonly users: UserRepository;
  private readonly notify: Notifier;
  constructor(deps: { db: D1Database; friendships: FriendshipRepository; users: UserRepository; notify: Notifier }) {
    this.db = deps.db; this.friendships = deps.friendships; this.users = deps.users; this.notify = deps.notify;
  }

  async list(u: CurrentUser): Promise<Friends> {
    const r = await this.friendships.listFor(u.id);
    const out = (x: (typeof r.results)[number]) => ({ id: x.id, name: x.name, username: x.username, since: x.createdAt });
    return {
      friends: r.results.filter(x => x.status === "accepted").map(out),
      incoming: r.results.filter(x => x.status === "pending" && x.requestedBy !== u.id).map(out),
      outgoing: r.results.filter(x => x.status === "pending" && x.requestedBy === u.id).map(out),
    };
  }

  // Ask someone (by account id, or username or email) to be friends. If they
  // had asked me, asking back accepts.
  async request(u: CurrentUser, b: any) {
    const login = textField(b?.login).trim();
    const who = b?.userId ? await this.users.findForFriendRequest(textField(b.userId)) : login ? await this.users.findByLogin(login) : null;
    if (!who) throw new ApiError(login ? `No one on Split It has the ${login.includes("@") && !login.startsWith("@") ? "email" : "username"} “${login}”.` : "Enter a username or email.", login ? 404 : 400);
    if (who.id === u.id) throw conflict("That's you.");
    const [a, bb] = pairOf(u.id, who.id);
    const row = await this.friendships.find(a, bb);
    if (row?.status === "accepted") throw conflict(`You and ${who.display_name} are already friends.`);
    if (row && row.requested_by === u.id) throw conflict(`You've already asked ${who.display_name}.`);
    if (row) {
      // They had asked me: asking back accepts.
      await this.db.batch([this.friendships.acceptStmt(a, bb),
        this.notify.stmt({ to: who.id, kind: "friend_accepted", title: `${u.name} accepted your friend request`, body: "You can now invite each other to groups.", link: "#/friends", actor: u.name })]);
      return { ok: true, status: "friends", name: who.display_name };
    }
    await this.db.batch([this.friendships.requestStmt(a, bb, u.id, Date.now()),
      this.notify.stmt({ to: who.id, kind: "friend_request", title: `${u.name} wants to be friends`, body: "Accept it in Friends.", link: "#/friends", actor: u.name })]);
    return { ok: true, status: "requested", name: who.display_name };
  }

  // accept (their request), decline (their request), or remove: cancel my
  // request or end a friendship.
  async act(u: CurrentUser, other: string, action: "accept" | "decline" | "remove") {
    const [a, bb] = pairOf(u.id, other);
    const row = await this.friendships.find(a, bb);
    if (!row) throw notFound("No friend request with that person.");
    if (action === "accept") {
      if (row.status !== "pending" || row.requested_by === u.id) throw conflict("There's no request from them to accept.");
      await this.db.batch([this.friendships.acceptStmt(a, bb),
        this.notify.stmt({ to: other, kind: "friend_accepted", title: `${u.name} accepted your friend request`, body: "You can now invite each other to groups.", link: "#/friends", actor: u.name })]);
      return { ok: true };
    }
    // decline (their request), cancel (mine) or remove (friends): the row goes.
    if (action === "decline" && (row.status !== "pending" || row.requested_by === u.id)) throw conflict("There's no request from them to decline.");
    await this.friendships.delete(a, bb);
    return { ok: true };
  }
}
