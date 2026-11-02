// Moving everything of one account into another ("I had another account").

export class AccountMergeRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  // Moves everything of account `from` into account `to` (the same person who
  // had two accounts, e.g. one per group from before accounts existed). In a
  // group where both are members, shares on the same expense are added together
  // and payments between the two are dropped (they were to oneself), so group
  // balances stay zero-sum. Returns the statements for one atomic batch.
  async mergeStatements(to: string, from: string): Promise<D1PreparedStatement[]> {
    const db = this.db;
    const toName = (await db.prepare("SELECT display_name FROM appx_users WHERE id=?").bind(to).first<{ display_name: string }>())?.display_name;
    const groups = (await db.prepare("SELECT group_id,role,status,joined_at FROM appx_group_members WHERE member_id=?").bind(from).all<{ group_id: string; role: string; status: string; joined_at: number | null }>()).results;
    const rank: Record<string, number> = { active: 3, pending: 2, invited: 1, suggested: 1, removed: 0 };
    const out: D1PreparedStatement[] = [];
    for (const g of groups) {
      const gid = g.group_id, mine = await db.prepare("SELECT role,status FROM appx_group_members WHERE group_id=? AND member_id=?").bind(gid, to).first<{ role: string; status: string }>();
      const role = g.role === "admin" || mine?.role === "admin" ? "admin" : "member";
      const status = !mine || rank[g.status] > rank[mine.status] ? g.status : mine.status;
      const inGroup = "(SELECT id FROM appx_expenses WHERE group_id=?)";
      const between = "group_id=?1 AND ((from_member_id=?2 AND to_member_id=?3) OR (from_member_id=?3 AND to_member_id=?2))";
      out.push(
        db.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status,joined_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(group_id,member_id) DO UPDATE SET role=?4,status=?5").bind(gid, to, toName, role, status, g.joined_at ?? null),
        db.prepare("UPDATE appx_splits SET amount_cents=amount_cents+(SELECT x.amount_cents FROM appx_splits x WHERE x.expense_id=appx_splits.expense_id AND x.member_id=?1) WHERE member_id=?2 AND expense_id IN (SELECT expense_id FROM appx_splits WHERE member_id=?1) AND expense_id IN " + inGroup.replace("?", "?3")).bind(from, to, gid),
        db.prepare("DELETE FROM appx_splits WHERE member_id=?1 AND expense_id IN (SELECT expense_id FROM appx_splits WHERE member_id=?2) AND expense_id IN " + inGroup.replace("?", "?3")).bind(from, to, gid),
        db.prepare("UPDATE appx_splits SET member_id=?1 WHERE member_id=?2 AND expense_id IN " + inGroup.replace("?", "?3")).bind(to, from, gid),
        db.prepare("UPDATE appx_expenses SET paid_by=? WHERE group_id=? AND paid_by=?").bind(to, gid, from),
        db.prepare("UPDATE appx_expenses SET created_by=? WHERE group_id=? AND created_by=?").bind(to, gid, from),
        db.prepare("DELETE FROM appx_payment_proofs WHERE settlement_id IN (SELECT id FROM appx_settlements WHERE " + between + ")").bind(gid, to, from),
        db.prepare("DELETE FROM appx_settlements WHERE " + between).bind(gid, to, from),
        db.prepare("UPDATE appx_settlements SET from_member_id=? WHERE group_id=? AND from_member_id=?").bind(to, gid, from),
        db.prepare("UPDATE appx_settlements SET to_member_id=? WHERE group_id=? AND to_member_id=?").bind(to, gid, from),
        db.prepare("UPDATE appx_settlements SET created_by=? WHERE group_id=? AND created_by=?").bind(to, gid, from),
        db.prepare("UPDATE appx_settlements SET decided_by=? WHERE group_id=? AND decided_by=?").bind(to, gid, from),
        db.prepare("UPDATE appx_history SET actor_id=? WHERE group_id=? AND actor_id=?").bind(to, gid, from),
        db.prepare("DELETE FROM appx_group_members WHERE group_id=? AND member_id=?").bind(gid, from),
      );
    }
    out.push(
      // Keep my UPI details; take theirs only if I have none.
      db.prepare("UPDATE OR IGNORE appx_payment_methods SET member_id=? WHERE member_id=?").bind(to, from),
      db.prepare("DELETE FROM appx_payment_methods WHERE member_id=?").bind(from),
      db.prepare("UPDATE appx_notifications SET recipient_id=? WHERE recipient_id=?").bind(to, from),
      // Friends move over too (a friendship between the two accounts is dropped).
      db.prepare("INSERT OR IGNORE INTO appx_friendships(user_a,user_b,requested_by,status,created_at) SELECT min(?1,other),max(?1,other),CASE requested_by WHEN ?2 THEN ?1 ELSE requested_by END,status,created_at FROM (SELECT CASE WHEN user_a=?2 THEN user_b ELSE user_a END AS other,requested_by,status,created_at FROM appx_friendships WHERE user_a=?2 OR user_b=?2) WHERE other<>?1").bind(to, from),
      db.prepare("DELETE FROM appx_friendships WHERE user_a=?1 OR user_b=?1").bind(from),
      db.prepare("UPDATE appx_push_subscriptions SET member_id=? WHERE member_id=?").bind(to, from),
      db.prepare("DELETE FROM appx_user_sessions WHERE user_id=?").bind(from),
      db.prepare("DELETE FROM appx_users WHERE id=?").bind(from),
    );
    return out;
  }
}
