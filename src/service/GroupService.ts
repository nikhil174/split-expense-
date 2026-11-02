// Groups themselves: creating them, my list, a group's details and
// members, renaming, leaving and deleting.
import type { FriendState, GroupDetail, GroupSummary, Identity } from "../../shared/api-types.ts";
import { PIN_RE } from "../config/constants.ts";
import { cleanName, textField } from "../domain/text.ts";
import { ApiError, conflict, needGroupAdmin } from "../http/ApiError.ts";
import type { FriendshipRepository } from "../repository/FriendshipRepository.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { Transaction } from "../repository/Transaction.ts";
import type { CurrentUser } from "../repository/types.ts";
import type { GroupPinGuard } from "../security/GroupPinGuard.ts";
import type { PasswordHasher } from "../security/PasswordHasher.ts";
import { newId, newUrlToken } from "../security/crypto.ts";
import type { GroupScope } from "./GroupScope.ts";

export class GroupService {
  private readonly tx: Transaction;
  private readonly groups: GroupRepository;
  private readonly friendships: FriendshipRepository;
  private readonly hasher: PasswordHasher;
  private readonly pins: GroupPinGuard;
  constructor(deps: { tx: Transaction; groups: GroupRepository; friendships: FriendshipRepository; hasher: PasswordHasher; pins: GroupPinGuard }) {
    this.tx = deps.tx; this.groups = deps.groups; this.friendships = deps.friendships; this.hasher = deps.hasher; this.pins = deps.pins;
  }

  // Anyone can create a group; they are its first admin.
  async create(u: CurrentUser, b: any): Promise<{ group: Identity }> {
    const name = cleanName(b?.name);
    if (name.length < 2 || name.length > 80) throw new ApiError("Group name must be 2–80 characters.");
    if (!PIN_RE.test(textField(b?.pin))) throw new ApiError("Choose a 4-digit PIN for the group. Members need it to join and to open the group.");
    const gid = newId(), now = Date.now();
    await this.tx.run([
      this.groups.insertStmt(gid, name, now, u.id, await this.hasher.hash(textField(b.pin)), newUrlToken()),
      this.groups.addCreatorStmt(gid, u.id, u.name, now),
      this.pins.unlockStmt(u, gid),
    ]);
    return { group: { id: gid, name } };
  }

  async listMine(u: CurrentUser): Promise<{ groups: GroupSummary[] }> {
    const r = await this.groups.listForUser(u.id, u.tokenHash, Date.now());
    return { groups: r.results.map(x => ({ ...x, hasPin: !!x.hasPin, unlocked: !!x.unlocked })) };
  }

  // The group with its members (and, for admins, who is waiting).
  async detail(s: GroupScope): Promise<GroupDetail> {
    const u = s.user;
    const g = await this.groups.idAndName(s.gid);
    const all = await this.groups.members(s.gid);
    // Where I stand with each person: friends, or a request either way.
    const friends = new Map<string, FriendState>((await this.friendships.standingsOf(u.id)).results
      .map(f => [f.other, f.status === "accepted" ? "friend" : f.requested_by === u.id ? "requested" : "asked_you"]));
    const inviters = new Map(all.map(x => [x.id, x.name]));
    const rows = (await this.groups.invitedByRows(s.gid)).results;
    const invitedBy = new Map(rows.map(r => [r.member_id, r.invited_by ? inviters.get(r.invited_by) || null : null]));
    const pick = (x: (typeof all)[number]) => ({ id: x.id, name: x.name, username: x.username, role: x.role, status: x.status, friend: x.id === u.id ? null : friends.get(x.id) || null, invitedBy: invitedBy.get(x.id) || null });
    return {
      group: { ...g!, hasPin: !!s.pinHash },
      members: all.filter(x => x.active).map(pick),
      // Only admins see who is waiting: asked to join (link/QR), suggested
      // by a member, or invited and not answered yet.
      waiting: s.isAdmin ? all.filter(x => ["pending", "suggested", "invited"].includes(x.status)).map(pick) : [],
      me: { id: u.id, name: u.name, isAdmin: s.isAdmin, role: s.role },
    };
  }

  async leave(s: GroupScope) {
    const admins = await this.groups.adminCount(s.gid);
    const others = await this.groups.otherActiveCount(s.gid, s.user.id);
    if (s.isAdmin && admins <= 1 && others > 0) throw conflict("You're the only admin. Make someone else an admin before you leave.");
    await this.groups.leave(s.gid, s.user.id);
    return { ok: true };
  }

  async rename(s: GroupScope, rawName: () => Promise<unknown>) {
    if (!s.isAdmin) throw needGroupAdmin();
    const name = cleanName(await rawName());
    if (name.length < 2 || name.length > 80) throw new ApiError("Group name must be 2–80 characters.");
    await this.groups.rename(s.gid, name);
    return { ok: true, group: { id: s.gid, name } };
  }

  // Deletes the group and everything in it.
  async delete(s: GroupScope) {
    if (!s.isAdmin) throw needGroupAdmin();
    const g = (await this.groups.name(s.gid))!;
    await this.tx.run(this.groups.deleteAllStmts(s.gid));
    return { ok: true, deletedGroup: g.name };
  }
}
