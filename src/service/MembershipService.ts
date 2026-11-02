// Who is in a group: inviting people, members suggesting friends, admins
// approving, removing, and making admins.
import { loginKind, textField } from "../domain/text.ts";
import { ApiError, conflict, forbidden, needGroupAdmin, notFound } from "../http/ApiError.ts";
import type { FriendshipRepository } from "../repository/FriendshipRepository.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { UserRepository } from "../repository/UserRepository.ts";
import type { GroupScope } from "./GroupService.ts";
import type { Notifier } from "./Notifier.ts";

export type MemberAction = "approve" | "reject" | "remove" | "cancel-invite" | "make-admin" | "make-member";

export class MembershipService {
  private readonly db: D1Database;
  private readonly groups: GroupRepository;
  private readonly users: UserRepository;
  private readonly friendships: FriendshipRepository;
  private readonly notify: Notifier;
  constructor(deps: { db: D1Database; groups: GroupRepository; users: UserRepository; friendships: FriendshipRepository; notify: Notifier }) {
    this.db = deps.db; this.groups = deps.groups; this.users = deps.users; this.friendships = deps.friendships; this.notify = deps.notify;
  }

  // Invite someone already on Split It by their username or email. They join
  // when they accept. Someone who asked to join is let in straight away.
  // Members (not admins) may suggest one of their friends: an admin then
  // approves, and only then is the friend invited.
  async invite(s: GroupScope, rawLogin: unknown) {
    const u = s.user, gid = s.gid;
    const login = textField(rawLogin).trim();
    if (!login) throw new ApiError("Enter a username or email.");
    const who = await this.users.findByLogin(login);
    if (!who) throw notFound(`No one on Split It has the ${loginKind(login)} “${login}”. Check it, or ask them to create an account first.`);
    const g = (await this.groups.name(gid))!;
    const row = await this.groups.membership(gid, who.id);
    if (row?.status === "active") throw conflict(`${who.display_name} is already in this group.`);
    if (row?.status === "invited") throw conflict(`${who.display_name} is already invited. They'll see it when they open Split It.`);
    if (!s.isAdmin) {
      if (!await this.friendships.areFriends(u.id, who.id)) throw forbidden("You can suggest your friends. Add them as a friend first, or ask a group admin to invite them.");
      if (row?.status === "suggested" || row?.status === "pending") throw conflict(`${who.display_name} is already waiting for an admin to approve.`);
      const admins = await this.groups.adminIds(gid);
      await this.db.batch([
        this.groups.suggestStmt(gid, who.id, who.display_name, u.id),
        ...admins.map(to => this.notify.stmt({ to, groupId: gid, kind: "member_suggested", title: `${u.name} wants to add ${who.display_name} to “${g.name}”`, body: "Approve it in Members → Waiting.", link: `#/g/${gid}`, actor: u.name })),
      ]);
      return { ok: true, status: "suggested", name: who.display_name };
    }
    if (row?.status === "pending") {
      await this.db.batch([
        this.groups.letInPendingStmt(gid, who.id, Date.now()),
        this.notify.stmt({ to: who.id, groupId: gid, kind: "approved", title: `You're in “${g.name}”`, body: `${u.name} let you in. Add expenses and settle up here.`, link: `#/g/${gid}`, actor: u.name }),
      ]);
      return { ok: true, status: "active", name: who.display_name };
    }
    await this.db.batch([
      this.groups.inviteStmt(gid, who.id, who.display_name, u.id),
      this.notify.stmt({ to: who.id, groupId: gid, kind: "group_invite", title: `${u.name} invited you to “${g.name}”`, body: "Open Split It to accept or decline.", link: "#/", actor: u.name }),
    ]);
    return { ok: true, status: "invited", name: who.display_name };
  }

  // An admin acts on one person: approve or reject (a join request or a
  // member's suggestion), cancel an invitation, remove, make admin or member.
  async manage(s: GroupScope, mid: string, action: MemberAction) {
    if (!s.isAdmin) throw needGroupAdmin();
    const u = s.user, gid = s.gid;
    const row = await this.groups.memberWithGroupName(gid, mid);
    if (!row) throw notFound("That person is not in this group.");
    const admins = await this.groups.adminCount(gid);
    const lastAdmin = row.role === "admin" && row.status === "active" && admins <= 1;
    const set = (sql: string, ...args: unknown[]) => this.groups.updateMemberStmt(gid, mid, sql, ...args);
    if ((action === "approve" || action === "reject") && row.status === "suggested") {
      // A member's suggestion: approving invites the person (they still accept).
      await this.db.batch(action === "approve"
        ? [set("status='invited'"), this.notify.stmt({ to: mid, groupId: gid, kind: "group_invite", title: `You're invited to “${row.groupName}”`, body: "Open Split It to accept or decline.", link: "#/", actor: u.name })]
        : [set("status='removed'")]);
      return { ok: true, status: action === "approve" ? "invited" : "removed" };
    }
    if (action === "approve" || action === "reject") {
      if (row.status !== "pending") throw conflict("This person isn't waiting to join.");
      await this.db.batch(action === "approve"
        ? [set("status='active',joined_at=?", Date.now()), this.notify.stmt({ to: mid, groupId: gid, kind: "approved", title: `You're in “${row.groupName}”`, body: `${u.name} approved you. Add expenses and settle up here.`, link: `#/g/${gid}`, actor: u.name })]
        : [set("status='removed'")]);
      return { ok: true };
    }
    if (action === "cancel-invite") {
      if (row.status !== "invited") throw conflict("This person has no open invitation.");
      await this.db.batch([set("status='removed'")]);
      return { ok: true };
    }
    if (row.status !== "active") throw conflict(`${row.name} is not in the group right now.`);
    if (action === "remove") {
      if (mid === u.id) throw conflict("To leave the group yourself, use Leave group.");
      if (lastAdmin) throw conflict("Make someone else an admin first.");
      // Their expenses and payments stay; balances with them can still be settled by an admin.
      await this.db.batch([set("status='removed',role='member'"), this.notify.stmt({ to: mid, groupId: gid, kind: "removed", title: `You were removed from “${row.groupName}”`, body: `${u.name} removed you from the group.`, link: "#/", actor: u.name })]);
      return { ok: true };
    }
    if (action === "make-admin") {
      if (row.role === "admin") return { ok: true };
      await this.db.batch([set("role='admin'"), this.notify.stmt({ to: mid, groupId: gid, kind: "made_admin", title: `You're now an admin of “${row.groupName}”`, body: `${u.name} made you an admin. You can manage members and edit anything in the group.`, link: `#/g/${gid}`, actor: u.name })]);
      return { ok: true };
    }
    // make-member
    if (lastAdmin) throw conflict("A group needs at least one admin. Make someone else an admin first.");
    await this.db.batch([set("role='member'")]);
    return { ok: true };
  }
}
