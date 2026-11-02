// Getting into a group: invitations (accept or decline), the group's invite
// link / QR (see it, replace it, turn it off), and asking to join with it.
import type { Invitation } from "../../shared/api-types.ts";
import type { Clock } from "../config/Clock.ts";
import { conflict, needGroupAdmin, notFound, tooMany } from "../http/ApiError.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { Transaction } from "../repository/Transaction.ts";
import type { CurrentUser } from "../repository/types.ts";
import type { GroupPinGuard } from "../security/GroupPinGuard.ts";
import { newUrlToken } from "../security/crypto.ts";
import type { GroupScope } from "./GroupScope.ts";
import type { Notifier } from "./Notifier.ts";

export type JoinLink = Awaited<ReturnType<InvitationService["joinLink"]>>;

export class InvitationService {
  private readonly tx: Transaction;
  private readonly groups: GroupRepository;
  private readonly pins: GroupPinGuard;
  private readonly notify: Notifier;
  private readonly clock: Clock;
  constructor(deps: { clock: Clock; tx: Transaction; groups: GroupRepository; pins: GroupPinGuard; notify: Notifier }) {
    this.clock = deps.clock;
    this.tx = deps.tx; this.groups = deps.groups; this.pins = deps.pins; this.notify = deps.notify;
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
      this.groups.acceptInvitationStmt(gid, u.id, u.name, this.clock.now()),
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
  async join(u: CurrentUser, link: JoinLink, rateLimited: () => Promise<boolean>, pin: () => Promise<unknown>) {
    const { g, status } = link;
    if (status === "active") return { ok: true, groupId: g.id, status: "active" };
    if (status === "pending") throw conflict("You've already asked to join. A group admin will let you in.");
    if (await rateLimited()) throw tooMany();
    if (g.pin_hash) await this.pins.check(u, g.id, g.pin_hash, await pin());
    const now = this.clock.now();
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
}
