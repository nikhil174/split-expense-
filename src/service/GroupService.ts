// Groups: creating them, invitations and invite links, joining, the group's
// PIN, renaming, leaving and deleting.
import type { FriendState, GroupDetail, GroupSummary, Identity, Invitation } from "../../shared/api-types.ts";
import { PIN_RE } from "../config/constants.ts";
import { cleanName } from "../domain/text.ts";
import { textField } from "../domain/text.ts";
import { ApiError, conflict, needGroupAdmin, notFound } from "../http/ApiError.ts";
import type { FriendshipRepository } from "../repository/FriendshipRepository.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { SessionRepository } from "../repository/SessionRepository.ts";
import type { Transaction } from "../repository/Transaction.ts";
import type { CurrentUser, Role } from "../repository/types.ts";
import type { GroupPinGuard } from "../security/GroupPinGuard.ts";
import type { PasswordHasher } from "../security/PasswordHasher.ts";
import { newId, newUrlToken } from "../security/crypto.ts";
import type { Notifier } from "./Notifier.ts";

// A group as seen by one of its members (see GroupAccess).
export type GroupScope = { gid: string; user: CurrentUser; role: Role; isAdmin: boolean; name: string; pinHash: string | null };

export class GroupService {
  private readonly tx: Transaction;
  private readonly groups: GroupRepository;
  private readonly friendships: FriendshipRepository;
  private readonly sessions: SessionRepository;
  private readonly hasher: PasswordHasher;
  private readonly pins: GroupPinGuard;
  private readonly notify: Notifier;
  constructor(deps: { tx: Transaction; groups: GroupRepository; friendships: FriendshipRepository; sessions: SessionRepository; hasher: PasswordHasher; pins: GroupPinGuard; notify: Notifier }) {
    this.tx = deps.tx; this.groups = deps.groups; this.friendships = deps.friendships; this.sessions = deps.sessions;
    this.hasher = deps.hasher; this.pins = deps.pins; this.notify = deps.notify;
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

  // Groups I've been invited to and haven't answered yet.
  async invitations(u: CurrentUser): Promise<{ invitations: Invitation[] }> {
    const r = await this.groups.invitationsFor(u.id);
    return { invitations: r.results.map(x => ({ ...x, hasPin: !!x.hasPin })) };
  }

  // Accept an invitation (with the group's PIN, read only if it has one).
  async acceptInvitation(u: CurrentUser, gid: string, pin: () => Promise<unknown>) {
    const row = await this.groups.membershipWithGroup(gid, u.id);
    if (!row || row.status !== "invited") throw notFound("This invitation is no longer open.");
    if (row.pin_hash) await this.pins.check(u, gid, row.pin_hash, await pin());
    const admins = await this.groups.adminIds(gid);
    await this.tx.run([
      this.groups.acceptInvitationStmt(gid, u.id, u.name, Date.now()),
      this.pins.unlockStmt(u, gid),
      ...admins.filter(a => a !== u.id).map(to => this.notify.stmt({ to, groupId: gid, kind: "member_joined", title: `${u.name} joined “${row.name}”`, body: "They accepted your invitation.", link: `#/g/${gid}`, actor: u.name })),
    ]);
    return { ok: true, groupId: gid };
  }

  async declineInvitation(u: CurrentUser, gid: string) {
    const row = await this.groups.membershipWithGroup(gid, u.id);
    if (!row || row.status !== "invited") throw notFound("This invitation is no longer open.");
    await this.groups.declineInvitation(gid, u.id);
    return { ok: true };
  }

  // ----- Joining with an invite link / QR -----
  // Which group a link is for, and where I stand with it.
  async joinLink(u: CurrentUser, code: string) {
    const g = await this.groups.byInviteCode(code);
    if (!g) throw notFound("This invite link doesn't work any more. Ask someone in the group for a new one.");
    const mine = await this.groups.membership(g.id, u.id);
    const status = mine && mine.status !== "removed" ? mine.status : null;
    const memberCount = await this.groups.activeCount(g.id);
    return { g, status, memberCount };
  }

  // Ask to join with a link (with the group's PIN). A group admin then
  // approves; someone already invited joins straight away.
  async join(u: CurrentUser, link: Awaited<ReturnType<GroupService["joinLink"]>>, rateLimited: () => Promise<boolean>, pin: () => Promise<unknown>) {
    const { g, status } = link;
    if (status === "active") return { ok: true, groupId: g.id, status: "active" };
    if (status === "pending") throw conflict("You've already asked to join. A group admin will let you in.");
    if (await rateLimited()) throw new ApiError("Too many attempts. Please wait a few minutes and try again.", 429);
    if (g.pin_hash) await this.pins.check(u, g.id, g.pin_hash, await pin());
    const now = Date.now();
    if (status === "invited") {
      await this.tx.run([this.groups.joinAsInvitedStmt(g.id, u.id, u.name, now), this.pins.unlockStmt(u, g.id)]);
      return { ok: true, groupId: g.id, status: "active" };
    }
    const admins = await this.groups.adminIds(g.id);
    await this.tx.run([
      this.groups.askToJoinStmt(g.id, u.id, u.name),
      this.pins.unlockStmt(u, g.id),
      ...admins.map(to => this.notify.stmt({ to, groupId: g.id, kind: "join_request", title: `${u.name} asked to join “${g.name}”`, body: "Let them in from Members → Waiting.", link: `#/g/${g.id}`, actor: u.name })),
    ]);
    return { ok: true, groupId: g.id, status: "pending" };
  }

  // ----- Inside a group -----
  // Opening a group with its PIN (remembered for a day on this device).
  async unlock(s: GroupScope, pin: () => Promise<unknown>) {
    if (!s.pinHash) return { ok: true };
    await this.pins.check(s.user, s.gid, s.pinHash, await pin());
    await this.tx.run([this.pins.unlockStmt(s.user, s.gid), this.sessions.deleteExpiredUnlocksStmt(Date.now())]);
    return { ok: true };
  }

  // An admin sets or changes the group's PIN. Everyone else then enters the
  // new one next time they open the group.
  async setPin(s: GroupScope, pinValue: () => Promise<unknown>) {
    if (!s.isAdmin) throw needGroupAdmin();
    const pin = textField(await pinValue());
    if (!PIN_RE.test(pin)) throw new ApiError("Choose a 4-digit PIN.");
    const others = await this.groups.otherActiveIds(s.gid, s.user.id);
    const u = s.user;
    await this.tx.run([
      this.groups.setPinStmt(s.gid, await this.hasher.hash(pin)),
      this.sessions.deleteUnlocksForGroupStmt(s.gid),
      this.pins.unlockStmt(u, s.gid),
      ...others.map(to => this.notify.stmt({ to, groupId: s.gid, kind: "group_pin", title: `${u.name} ${s.pinHash ? "changed" : "set"} the PIN of “${s.name}”`, body: "Ask them for it: you'll need it to open the group.", link: `#/g/${s.gid}`, actor: u.name })),
    ]);
    return { ok: true };
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

  // The group's invite link / QR (#/join/<code>). Everyone in the group can
  // see and share it; the first admin to look makes it if there is none.
  async inviteLink(s: GroupScope) {
    let code = (await this.groups.inviteCode(s.gid))?.invite_code || null;
    if (!code && s.isAdmin) { code = newUrlToken(); await this.groups.setInviteCodeIfNone(s.gid, code); }
    return { code: (await this.groups.inviteCode(s.gid))?.invite_code || null, canManage: s.isAdmin };
  }
  // Admins replace the link (old ones stop working) or turn it off.
  async changeInviteLink(s: GroupScope, action: "reset" | "off") {
    if (!s.isAdmin) throw needGroupAdmin();
    const code = action === "reset" ? newUrlToken() : null;
    await this.groups.setInviteCode(s.gid, code);
    return { code, canManage: true };
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
