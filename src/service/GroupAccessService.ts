// Who may be inside a group, and its PIN: opening a group (the caller must
// be in it now), the PIN asked when opening it (remembered for a day on a
// device), and admins setting or changing that PIN.
import { PIN_RE } from "../config/constants.ts";
import { textField } from "../domain/text.ts";
import { ApiError, needGroupAdmin, notFound } from "../http/ApiError.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { SessionRepository } from "../repository/SessionRepository.ts";
import type { Transaction } from "../repository/Transaction.ts";
import type { CurrentUser } from "../repository/types.ts";
import type { GroupPinGuard } from "../security/GroupPinGuard.ts";
import type { PasswordHasher } from "../security/PasswordHasher.ts";
import type { GroupScope } from "./GroupScope.ts";
import type { Notifier } from "./Notifier.ts";

export class GroupAccessService {
  private readonly tx: Transaction;
  private readonly groups: GroupRepository;
  private readonly sessions: SessionRepository;
  private readonly hasher: PasswordHasher;
  private readonly pins: GroupPinGuard;
  private readonly notify: Notifier;
  constructor(deps: { tx: Transaction; groups: GroupRepository; sessions: SessionRepository; hasher: PasswordHasher; pins: GroupPinGuard; notify: Notifier }) {
    this.tx = deps.tx; this.groups = deps.groups; this.sessions = deps.sessions; this.hasher = deps.hasher; this.pins = deps.pins; this.notify = deps.notify;
  }

  // The group as this person sees it. Every group route requires the caller
  // to be in the group now. Admins of the group may edit or delete anything
  // in it, decide any payment, and manage who is in it; being admin is per
  // group.
  async open(user: CurrentUser, gid: string): Promise<GroupScope> {
    const member = await this.groups.activeRole(gid, user.id);
    if (!member) throw notFound("Group not found or you do not have access.");
    const gp = (await this.groups.nameAndPin(gid))!;
    return { gid, user, role: member.role, isAdmin: member.role === "admin", name: gp.name, pinHash: gp.pin_hash };
  }

  // Everything in a group waits until it is opened with its PIN on this device.
  async requireUnlocked(s: GroupScope): Promise<void> {
    if (s.pinHash && !await this.pins.isUnlocked(s.user, s.gid)) {
      throw new ApiError(`Enter the PIN for “${s.name}” to open it.`, 423, { code: "group_locked", groupId: s.gid, groupName: s.name });
    }
  }

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
}
