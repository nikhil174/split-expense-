// appx_groups and appx_group_members: groups and who is in them.
import { FORMER_MEMBER } from "../config/constants.ts";
import type { GroupMember, MemberStatus, Role } from "./types.ts";

// A member who is in the group now (may be chosen for expenses and payments).
// People who left or were removed keep their appx_group_members row (status
// 'removed') so history still shows their name. Expects the row aliased `m`.
const ACTIVE_MEMBER_SQL = "(m.status='active')";

// id → name for a group's members (anyone not found is a former member).
export function nameLookup(members: { id: string; name: string }[]): (memberId: string) => string {
  const names = new Map(members.map(m => [m.id, m.name]));
  return memberId => names.get(memberId) || FORMER_MEMBER;
}

export class GroupRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  // ----- Groups -----
  insertStmt(gid: string, name: string, now: number, createdBy: string, pinHash: string, inviteCode: string) {
    return this.db.prepare("INSERT INTO appx_groups(id,name,created_at,created_by,pin_hash,invite_code) VALUES(?,?,?,?,?,?)").bind(gid, name, now, createdBy, pinHash, inviteCode);
  }
  nameAndPin(gid: string) { return this.db.prepare("SELECT name,pin_hash FROM appx_groups WHERE id=?").bind(gid).first<{ name: string; pin_hash: string | null }>(); }
  idAndName(gid: string) { return this.db.prepare("SELECT id,name FROM appx_groups WHERE id=?").bind(gid).first<{ id: string; name: string }>(); }
  name(gid: string) { return this.db.prepare("SELECT name FROM appx_groups WHERE id=?").bind(gid).first<{ name: string }>(); }
  byInviteCode(code: string) { return this.db.prepare("SELECT id,name,pin_hash FROM appx_groups WHERE invite_code=?").bind(code).first<{ id: string; name: string; pin_hash: string | null }>(); }
  inviteCode(gid: string) { return this.db.prepare("SELECT invite_code FROM appx_groups WHERE id=?").bind(gid).first<{ invite_code: string | null }>(); }
  setInviteCodeIfNone(gid: string, code: string) { return this.db.prepare("UPDATE appx_groups SET invite_code=? WHERE id=? AND invite_code IS NULL").bind(code, gid).run(); }
  setInviteCode(gid: string, code: string | null) { return this.db.prepare("UPDATE appx_groups SET invite_code=? WHERE id=?").bind(code, gid).run(); }
  setPinStmt(gid: string, pinHash: string | null) { return this.db.prepare("UPDATE appx_groups SET pin_hash=? WHERE id=?").bind(pinHash, gid); }
  rename(gid: string, name: string) { return this.db.prepare("UPDATE appx_groups SET name=? WHERE id=?").bind(name, gid).run(); }
  // Everything in a group, children first (D1 enforces foreign keys).
  deleteAllStmts(gid: string) {
    return [
      this.db.prepare("DELETE FROM appx_payment_proofs WHERE settlement_id IN (SELECT id FROM appx_settlements WHERE group_id=?)").bind(gid),
      this.db.prepare("DELETE FROM appx_settlements WHERE group_id=?").bind(gid),
      this.db.prepare("DELETE FROM appx_splits WHERE expense_id IN (SELECT id FROM appx_expenses WHERE group_id=?)").bind(gid),
      this.db.prepare("DELETE FROM appx_expenses WHERE group_id=?").bind(gid),
      this.db.prepare("DELETE FROM appx_group_members WHERE group_id=?").bind(gid),
      this.db.prepare("DELETE FROM appx_history WHERE group_id=?").bind(gid),
      this.db.prepare("DELETE FROM appx_notifications WHERE group_id=?").bind(gid),
      this.db.prepare("DELETE FROM appx_group_unlocks WHERE group_id=?").bind(gid),
      this.db.prepare("DELETE FROM appx_groups WHERE id=?").bind(gid),
    ];
  }

  // My groups with my balance in each, my role, size, and whether this device has it open.
  listForUser(uid: string, tokenHash: string, now: number) {
    return this.db.prepare("SELECT g.id,g.name,"
      + "COALESCE((SELECT SUM(amount_cents) FROM appx_expenses WHERE group_id=g.id AND paid_by=?1),0)"
      + "-COALESCE((SELECT SUM(s.amount_cents) FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=g.id AND s.member_id=?1),0)"
      + "+COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=g.id AND from_member_id=?1 AND status='confirmed'),0)"
      + "-COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=g.id AND to_member_id=?1 AND status='confirmed'),0) AS myBalanceCents"
      + ",m.role,(SELECT COUNT(*) FROM appx_group_members x WHERE x.group_id=g.id AND x.status='active') AS memberCount"
      + ",g.pin_hash IS NOT NULL AS hasPin,(g.pin_hash IS NULL OR EXISTS(SELECT 1 FROM appx_group_unlocks k WHERE k.group_id=g.id AND k.session_hash=?2 AND k.until>?3)) AS unlocked "
      + "FROM appx_groups g JOIN appx_group_members m ON m.group_id=g.id WHERE m.member_id=?1 AND m.status='active' ORDER BY g.created_at DESC").bind(uid, tokenHash, now)
      .all<{ id: string; name: string; myBalanceCents: number; role: Role; memberCount: number; hasPin: number; unlocked: number }>();
  }
  activeGroupsOf(uid: string) {
    return this.db.prepare("SELECT g.id,g.name FROM appx_groups g JOIN appx_group_members m ON m.group_id=g.id WHERE m.member_id=? AND " + ACTIVE_MEMBER_SQL + " ORDER BY g.created_at DESC").bind(uid).all<{ id: string; name: string }>();
  }
  invitationsFor(uid: string) {
    return this.db.prepare("SELECT g.id AS groupId,g.name AS groupName,g.pin_hash IS NOT NULL AS hasPin,COALESCE(i.name,'Someone') AS invitedBy,(SELECT COUNT(*) FROM appx_group_members x WHERE x.group_id=g.id AND x.status='active') AS memberCount FROM appx_group_members m JOIN appx_groups g ON g.id=m.group_id LEFT JOIN appx_group_members i ON i.group_id=m.group_id AND i.member_id=m.invited_by WHERE m.member_id=? AND m.status='invited' ORDER BY g.created_at DESC").bind(uid)
      .all<{ groupId: string; groupName: string; hasPin: number; invitedBy: string; memberCount: number }>();
  }

  // ----- Members -----
  // Every member row ever added to the group (including people who left or
  // were removed, so history keeps their names), with role and status.
  async members(gid: string): Promise<GroupMember[]> {
    const r = await this.db.prepare("SELECT m.member_id AS id,m.name,m.role,m.status,u.username FROM appx_group_members m LEFT JOIN appx_users u ON u.id=m.member_id WHERE m.group_id=? ORDER BY lower(m.name)").bind(gid).all<{ id: string; name: string; role: Role; status: MemberStatus; username: string | null }>();
    return r.results.map(x => ({ id: x.id, name: x.name, role: x.role, status: x.status, username: x.username || null, active: x.status === "active" }));
  }
  activeRole(gid: string, uid: string) { return this.db.prepare("SELECT m.role FROM appx_group_members m WHERE m.group_id=? AND m.member_id=? AND " + ACTIVE_MEMBER_SQL).bind(gid, uid).first<{ role: Role }>(); }
  membership(gid: string, uid: string) { return this.db.prepare("SELECT status FROM appx_group_members WHERE group_id=? AND member_id=?").bind(gid, uid).first<{ status: MemberStatus }>(); }
  membershipWithGroup(gid: string, uid: string) { return this.db.prepare("SELECT m.status,g.name,g.pin_hash FROM appx_group_members m JOIN appx_groups g ON g.id=m.group_id WHERE m.group_id=? AND m.member_id=?").bind(gid, uid).first<{ status: MemberStatus; name: string; pin_hash: string | null }>(); }
  memberWithGroupName(gid: string, mid: string) { return this.db.prepare("SELECT m.member_id,m.name,m.role,m.status,g.name AS groupName FROM appx_group_members m JOIN appx_groups g ON g.id=m.group_id WHERE m.group_id=? AND m.member_id=?").bind(gid, mid).first<{ member_id: string; name: string; role: string; status: MemberStatus; groupName: string }>(); }
  invitedByRows(gid: string) { return this.db.prepare("SELECT member_id,invited_by FROM appx_group_members WHERE group_id=?").bind(gid).all<{ member_id: string; invited_by: string | null }>(); }
  async adminIds(gid: string): Promise<string[]> {
    return (await this.db.prepare("SELECT member_id FROM appx_group_members WHERE group_id=? AND role='admin' AND status='active'").bind(gid).all<{ member_id: string }>()).results.map(r => r.member_id);
  }
  async adminCount(gid: string): Promise<number> { return Number((await this.db.prepare("SELECT COUNT(*) AS n FROM appx_group_members WHERE group_id=? AND role='admin' AND status='active'").bind(gid).first<{ n: number }>())!.n); }
  async activeCount(gid: string): Promise<number> { return Number((await this.db.prepare("SELECT COUNT(*) AS n FROM appx_group_members WHERE group_id=? AND status='active'").bind(gid).first<{ n: number }>())!.n); }
  async otherActiveCount(gid: string, uid: string): Promise<number> { return Number((await this.db.prepare("SELECT COUNT(*) AS n FROM appx_group_members WHERE group_id=? AND status='active' AND member_id<>?").bind(gid, uid).first<{ n: number }>())!.n); }
  async otherActiveIds(gid: string, uid: string): Promise<string[]> {
    return (await this.db.prepare("SELECT member_id FROM appx_group_members WHERE group_id=? AND status='active' AND member_id<>?").bind(gid, uid).all<{ member_id: string }>()).results.map(r => r.member_id);
  }

  addCreatorStmt(gid: string, uid: string, name: string, now: number) {
    return this.db.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status,joined_at) VALUES(?,?,?,'admin','active',?)").bind(gid, uid, name, now);
  }
  acceptInvitationStmt(gid: string, uid: string, name: string, now: number) {
    return this.db.prepare("UPDATE appx_group_members SET status='active',name=?,joined_at=? WHERE group_id=? AND member_id=? AND status='invited'").bind(name, now, gid, uid);
  }
  joinAsInvitedStmt(gid: string, uid: string, name: string, now: number) {
    return this.db.prepare("UPDATE appx_group_members SET status='active',name=?,joined_at=? WHERE group_id=? AND member_id=?").bind(name, now, gid, uid);
  }
  declineInvitation(gid: string, uid: string) { return this.db.prepare("UPDATE appx_group_members SET status='removed' WHERE group_id=? AND member_id=? AND status='invited'").bind(gid, uid).run(); }
  askToJoinStmt(gid: string, uid: string, name: string) {
    return this.db.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status,invited_by) VALUES(?1,?2,?3,'member','pending',NULL) ON CONFLICT(group_id,member_id) DO UPDATE SET status='pending',role='member',invited_by=NULL,name=?3").bind(gid, uid, name);
  }
  suggestStmt(gid: string, uid: string, name: string, by: string) {
    return this.db.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status,invited_by) VALUES(?1,?2,?3,'member','suggested',?4) ON CONFLICT(group_id,member_id) DO UPDATE SET status='suggested',role='member',invited_by=?4,name=?3").bind(gid, uid, name, by);
  }
  inviteStmt(gid: string, uid: string, name: string, by: string) {
    return this.db.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status,invited_by) VALUES(?1,?2,?3,'member','invited',?4) ON CONFLICT(group_id,member_id) DO UPDATE SET status='invited',role='member',invited_by=?4,name=?3").bind(gid, uid, name, by);
  }
  letInPendingStmt(gid: string, uid: string, now: number) {
    return this.db.prepare("UPDATE appx_group_members SET status='active',joined_at=? WHERE group_id=? AND member_id=? AND status='pending'").bind(now, gid, uid);
  }
  // UPDATE appx_group_members SET <sql> for one member.
  updateMemberStmt(gid: string, mid: string, sql: string, ...args: unknown[]) {
    return this.db.prepare("UPDATE appx_group_members SET " + sql + " WHERE group_id=? AND member_id=?").bind(...args, gid, mid);
  }
  leave(gid: string, uid: string) { return this.db.prepare("UPDATE appx_group_members SET status='removed',role='member' WHERE group_id=? AND member_id=?").bind(gid, uid).run(); }
  renameMemberEverywhereStmt(uid: string, name: string) { return this.db.prepare("UPDATE appx_group_members SET name=? WHERE member_id=?").bind(name, uid); }
}
