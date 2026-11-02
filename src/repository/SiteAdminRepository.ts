// Read-only summaries for the site owner's console: counts, accounts and
// groups in summary (never anyone's expenses), plus clearing a group's PIN.

const likePattern = (q: string) => "%" + q.replace(/[%_\\]/g, "\\$&") + "%";

export class SiteAdminRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async overview(weekAgo: number) {
    const one = (sql: string) => this.db.prepare(sql).first<{ n: number }>();
    const [users, groups, expenses, spent, week] = await Promise.all([
      one("SELECT COUNT(*) AS n FROM appx_users"), one("SELECT COUNT(*) AS n FROM appx_groups"), one("SELECT COUNT(*) AS n FROM appx_expenses"),
      one("SELECT COALESCE(SUM(amount_cents),0) AS n FROM appx_expenses"),
      this.db.prepare("SELECT COUNT(*) AS n FROM appx_users WHERE created_at>?").bind(weekAgo).first<{ n: number }>(),
    ]);
    return { users: users!.n, groups: groups!.n, expenses: expenses!.n, totalSpentCents: spent!.n, newUsersThisWeek: week!.n };
  }
  users(q: string, now: number) {
    return this.db.prepare("SELECT u.id,u.display_name AS name,u.username,u.email,u.created_at AS createdAt,u.legacy,u.site_role='admin' AS siteAdmin,u.pin_hash IS NOT NULL AS hasPin,u.pin_locked_until>?2 AS locked,"
      + "(SELECT COUNT(*) FROM appx_group_members m WHERE m.member_id=u.id AND m.status='active') AS groupCount FROM appx_users u "
      + "WHERE ?1='%%' OR lower(u.username) LIKE ?1 ESCAPE '\\' OR lower(u.display_name) LIKE ?1 ESCAPE '\\' OR lower(COALESCE(u.email,'')) LIKE ?1 ESCAPE '\\' ORDER BY u.created_at DESC LIMIT 100").bind(likePattern(q), now)
      .all<{ id: string; name: string; username: string; email: string | null; createdAt: number; legacy: number; siteAdmin: number; hasPin: number; locked: number; groupCount: number }>();
  }
  groups(q: string) {
    return this.db.prepare("SELECT g.id,g.name,g.created_at AS createdAt,(SELECT COUNT(*) FROM appx_group_members m WHERE m.group_id=g.id AND m.status='active') AS memberCount,"
      + "(SELECT group_concat(m.name,', ') FROM appx_group_members m WHERE m.group_id=g.id AND m.status='active' AND m.role='admin') AS admins,"
      + "(SELECT COUNT(*) FROM appx_expenses e WHERE e.group_id=g.id) AS expenseCount,(SELECT COALESCE(SUM(amount_cents),0) FROM appx_expenses e WHERE e.group_id=g.id) AS totalCents,"
      + "(SELECT MAX(created_at) FROM appx_expenses e WHERE e.group_id=g.id) AS lastActivity,g.pin_hash IS NOT NULL AS hasPin FROM appx_groups g WHERE ?1='%%' OR lower(g.name) LIKE ?1 ESCAPE '\\' ORDER BY g.created_at DESC LIMIT 100").bind(likePattern(q))
      .all<{ id: string; name: string; createdAt: number; memberCount: number; admins: string | null; expenseCount: number; totalCents: number; lastActivity: number | null; hasPin: number }>();
  }
}
