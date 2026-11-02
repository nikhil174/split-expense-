// appx_expenses and appx_splits, and the group ledger built from them.
import type { Ledger, PaidTotal, Repayment, ShareActivityRow, SplitEdge } from "../domain/settlement.ts";
import type { ShareRow } from "./types.ts";

export type ExpenseRow = { id: string; paid_by: string; description: string; amount_cents: number };
export type FullLedger = Required<Ledger> & { paidTotals: PaidTotal[]; splitEdges: SplitEdge[]; settlements: Repayment[] };

export class ExpenseRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  // Aggregated, group-scoped ledger used for both balances and pairwise debts
  // so the two views can never disagree.
  async ledger(gid: string): Promise<FullLedger> {
    const [paid, splits, settlements] = await Promise.all([
      this.db.prepare("SELECT paid_by AS memberId,SUM(amount_cents) AS amountCents FROM appx_expenses WHERE group_id=? GROUP BY paid_by").bind(gid).all<PaidTotal>(),
      this.db.prepare("SELECT e.paid_by AS payerId,s.member_id AS memberId,SUM(s.amount_cents) AS amountCents FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=? GROUP BY e.paid_by,s.member_id").bind(gid).all<SplitEdge>(),
      this.db.prepare("SELECT from_member_id AS fromMemberId,to_member_id AS toMemberId,SUM(amount_cents) AS amountCents FROM appx_settlements WHERE group_id=? AND status='confirmed' GROUP BY from_member_id,to_member_id").bind(gid).all<Repayment>(),
    ]);
    const ints = <T extends { amountCents: number }>(rows: T[]): T[] => rows.map(r => ({ ...r, amountCents: Number(r.amountCents) }));
    return { paidTotals: ints(paid.results), splitEdges: ints(splits.results), settlements: ints(settlements.results) };
  }

  find(id: string, gid: string) { return this.db.prepare("SELECT id,paid_by,description,amount_cents FROM appx_expenses WHERE id=? AND group_id=?").bind(id, gid).first<ExpenseRow>(); }
  async splitsSorted(eid: string): Promise<ShareRow[]> { return (await this.db.prepare("SELECT member_id AS memberId,amount_cents AS amountCents FROM appx_splits WHERE expense_id=? ORDER BY member_id").bind(eid).all<ShareRow>()).results; }
  async splits(eid: string): Promise<ShareRow[]> { return (await this.db.prepare("SELECT member_id AS memberId,amount_cents AS amountCents FROM appx_splits WHERE expense_id=?").bind(eid).all<ShareRow>()).results; }
  totals(gid: string) { return this.db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents,COUNT(*) AS count FROM appx_expenses WHERE group_id=?").bind(gid).first<{ cents: number; count: number }>(); }

  insertStmt(eid: string, gid: string, desc: string, cents: number, paidBy: string, createdBy: string, now: number) {
    return this.db.prepare("INSERT INTO appx_expenses(id,group_id,description,amount_cents,paid_by,created_by,created_at) VALUES(?,?,?,?,?,?,?)").bind(eid, gid, desc, cents, paidBy, createdBy, now);
  }
  insertSplitStmts(eid: string, rows: ShareRow[]) {
    return rows.map(row => this.db.prepare("INSERT INTO appx_splits(expense_id,member_id,amount_cents) VALUES(?,?,?)").bind(eid, row.memberId, row.amountCents));
  }
  updateStmt(eid: string, gid: string, desc: string, cents: number, paidBy: string) {
    return this.db.prepare("UPDATE appx_expenses SET description=?,amount_cents=?,paid_by=? WHERE id=? AND group_id=?").bind(desc, cents, paidBy, eid, gid);
  }
  deleteSplitsStmt(eid: string) { return this.db.prepare("DELETE FROM appx_splits WHERE expense_id=?").bind(eid); }
  deleteStmt(eid: string, gid: string) { return this.db.prepare("DELETE FROM appx_expenses WHERE id=? AND group_id=?").bind(eid, gid); }

  // The group's expense list (newest 300) and their splits.
  list(gid: string) {
    return this.db.prepare("SELECT id,description,amount_cents AS amountCents,created_at AS createdAt,paid_by AS paidBy,created_by AS createdBy FROM appx_expenses WHERE group_id=? ORDER BY created_at DESC LIMIT 300").bind(gid).all<{ id: string; description: string; amountCents: number; createdAt: number; paidBy: string; createdBy: string }>();
  }
  listSplits(gid: string) {
    return this.db.prepare("SELECT s.expense_id AS expenseId,s.member_id AS memberId,s.amount_cents AS amountCents FROM appx_splits s WHERE s.expense_id IN (SELECT id FROM appx_expenses WHERE group_id=? ORDER BY created_at DESC LIMIT 300)").bind(gid).all<{ expenseId: string; memberId: string; amountCents: number }>();
  }

  // ----- One member's view -----
  // Expenses they paid for or share in, oldest first (statement).
  memberExpensesOldestFirst(gid: string, mid: string) {
    return this.db.prepare("SELECT e.id,e.description,e.amount_cents AS totalCents,e.paid_by AS paidBy,e.created_at AS createdAt,COALESCE((SELECT amount_cents FROM appx_splits WHERE expense_id=e.id AND member_id=?2),0) AS shareCents,(SELECT COUNT(*) FROM appx_splits WHERE expense_id=e.id) AS splitCount FROM appx_expenses e WHERE e.group_id=?1 AND (e.paid_by=?2 OR e.id IN (SELECT expense_id FROM appx_splits WHERE member_id=?2)) ORDER BY e.created_at,e.id").bind(gid, mid)
      .all<{ id: string; description: string; totalCents: number; paidBy: string; createdAt: number; shareCents: number; splitCount: number }>();
  }
  // Expenses they paid for or share in, newest first (member summary).
  memberExpensesNewestFirst(gid: string, mid: string) {
    return this.db.prepare("SELECT e.id,e.description,e.amount_cents AS amountCents,e.paid_by AS paidBy,e.created_at AS createdAt,COALESCE((SELECT amount_cents FROM appx_splits WHERE expense_id=e.id AND member_id=?2),0) AS shareCents,(SELECT COUNT(*) FROM appx_splits WHERE expense_id=e.id) AS splitCount FROM appx_expenses e WHERE e.group_id=?1 AND (e.paid_by=?2 OR e.id IN (SELECT expense_id FROM appx_splits WHERE member_id=?2)) ORDER BY e.created_at DESC LIMIT 300").bind(gid, mid)
      .all<{ id: string; description: string; amountCents: number; paidBy: string; createdAt: number; shareCents: number; splitCount: number }>();
  }
  // Every split row of expenses this member paid or shares in.
  memberShares(gid: string, mid: string) {
    return this.db.prepare("SELECT e.id AS expenseId,e.description,e.paid_by AS paidBy,e.amount_cents AS totalCents,e.created_at AS createdAt,s.member_id AS memberId,s.amount_cents AS amountCents FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=?1 AND (e.paid_by=?2 OR s.member_id=?2)").bind(gid, mid).all<ShareActivityRow>();
  }
  // Split rows between two members (one paid, the other has a share).
  pairShares(gid: string, a: string, b: string) {
    return this.db.prepare("SELECT e.id AS expenseId,e.description,e.paid_by AS paidBy,e.amount_cents AS totalCents,e.created_at AS createdAt,s.member_id AS memberId,s.amount_cents AS amountCents FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=?1 AND ((e.paid_by=?2 AND s.member_id=?3) OR (e.paid_by=?3 AND s.member_id=?2))").bind(gid, a, b).all<ShareActivityRow>();
  }
}
