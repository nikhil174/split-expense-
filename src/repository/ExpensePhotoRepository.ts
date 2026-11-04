// appx_expense_photos: photos attached to an expense (receipts, bills, proof).
// Images are only read one at a time; lists carry just their ids.
import type { Statement } from "./Transaction.ts";

export class ExpensePhotoRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  // Photo ids of the group's listed expenses (the newest 300), oldest first.
  idsForGroup(gid: string) {
    return this.db.prepare("SELECT p.id,p.expense_id AS expenseId FROM appx_expense_photos p WHERE p.expense_id IN (SELECT id FROM appx_expenses WHERE group_id=? ORDER BY created_at DESC LIMIT 300) ORDER BY p.created_at,p.position").bind(gid).all<{ id: string; expenseId: string }>();
  }
  async idsOf(eid: string): Promise<string[]> {
    return (await this.db.prepare("SELECT id FROM appx_expense_photos WHERE expense_id=? ORDER BY created_at,position").bind(eid).all<{ id: string }>()).results.map(r => r.id);
  }
  // One photo, only if it belongs to that expense in that group.
  photo(pid: string, eid: string, gid: string) {
    return this.db.prepare("SELECT p.mime,p.base64 FROM appx_expense_photos p JOIN appx_expenses e ON e.id=p.expense_id WHERE p.id=? AND p.expense_id=? AND e.group_id=?").bind(pid, eid, gid).first<{ mime: string; base64: string }>();
  }

  insertStmt(p: { id: string; eid: string; mime: string; base64: string; now: number; position: number }): Statement {
    return this.db.prepare("INSERT INTO appx_expense_photos(id,expense_id,mime,base64,created_at,position) VALUES(?,?,?,?,?,?)").bind(p.id, p.eid, p.mime, p.base64, p.now, p.position);
  }
  deleteStmt(pid: string, eid: string): Statement { return this.db.prepare("DELETE FROM appx_expense_photos WHERE id=? AND expense_id=?").bind(pid, eid); }
  deleteForExpenseStmt(eid: string): Statement { return this.db.prepare("DELETE FROM appx_expense_photos WHERE expense_id=?").bind(eid); }
}
