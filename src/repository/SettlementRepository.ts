// appx_settlements (payments between members) and appx_payment_proofs
// (screenshots attached to them).
import { FORMER_MEMBER } from "../config/constants.ts";
import type { PaymentKind } from "../domain/payments.ts";
import type { PaymentActivityRow } from "../domain/settlement.ts";
import type { SettlementRow } from "./types.ts";

export type PaymentStatus = "pending" | "confirmed" | "rejected";
type PaymentRow = PaymentActivityRow & { status: PaymentStatus; kind: PaymentKind };

// SQL for what member f still owes member t in group g (each a placeholder
// like "?2"), from expenses and confirmed payments. With reserve, payments
// from f to t still waiting for confirmation are subtracted too, so pending
// payments can never add up to more than is owed.
export const owedSql = (g: string, f: string, t: string, reserve = false) => "("
  + `COALESCE((SELECT SUM(s.amount_cents) FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=${g} AND e.paid_by=${t} AND s.member_id=${f}),0)`
  + `-COALESCE((SELECT SUM(s.amount_cents) FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=${g} AND e.paid_by=${f} AND s.member_id=${t}),0)`
  + `-COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=${g} AND from_member_id=${f} AND to_member_id=${t} AND status ${reserve ? "IN ('confirmed','pending')" : "='confirmed'"}),0)`
  + `+COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=${g} AND from_member_id=${t} AND to_member_id=${f} AND status='confirmed'),0))`;

export class SettlementRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  find(sid: string, gid: string) {
    return this.db.prepare("SELECT id,from_member_id AS fromId,to_member_id AS toId,amount_cents AS cents,status,created_by AS createdBy,created_at AS createdAt,kind FROM appx_settlements WHERE id=? AND group_id=?").bind(sid, gid).first<SettlementRow>();
  }
  // The group's payments, newest 200, with names.
  list(gid: string) {
    return this.db.prepare("SELECT s.id,s.from_member_id AS fromMemberId,COALESCE(f.name,'" + FORMER_MEMBER + "') AS fromName,s.to_member_id AS toMemberId,COALESCE(t.name,'" + FORMER_MEMBER + "') AS toName,s.amount_cents AS amountCents,s.status,s.kind,s.created_by AS createdBy,EXISTS(SELECT 1 FROM appx_payment_proofs p WHERE p.settlement_id=s.id) AS hasProof,s.decided_at AS decidedAt,s.created_at AS createdAt,COALESCE(c.name,'" + FORMER_MEMBER + "') AS recordedByName FROM appx_settlements s LEFT JOIN appx_group_members f ON f.group_id=s.group_id AND f.member_id=s.from_member_id LEFT JOIN appx_group_members t ON t.group_id=s.group_id AND t.member_id=s.to_member_id LEFT JOIN appx_group_members c ON c.group_id=s.group_id AND c.member_id=s.created_by WHERE s.group_id=? ORDER BY s.created_at DESC LIMIT 200").bind(gid).all<{
      id: string; fromMemberId: string; fromName: string; toMemberId: string; toName: string; amountCents: number; status: PaymentStatus; kind: PaymentKind; createdBy: string; hasProof: number; decidedAt: number | null; createdAt: number; recordedByName: string;
    }>();
  }
  // Payments waiting on me, or that I sent or recorded, across all my groups.
  pendingFor(uid: string) {
    return this.db.prepare("SELECT s.id,s.group_id AS groupId,g.name AS groupName,s.from_member_id AS fromMemberId,COALESCE(f.name,'" + FORMER_MEMBER + "') AS fromName,s.to_member_id AS toMemberId,COALESCE(t.name,'" + FORMER_MEMBER + "') AS toName,s.amount_cents AS amountCents,s.kind,s.created_at AS createdAt,s.created_by AS createdBy,s.created_by=s.to_member_id AS needsAdmin,(me.role='admin' AND me.status='active') AS iAmAdmin,EXISTS(SELECT 1 FROM appx_payment_proofs p WHERE p.settlement_id=s.id) AS hasProof FROM appx_settlements s JOIN appx_groups g ON g.id=s.group_id JOIN appx_group_members me ON me.group_id=s.group_id AND me.member_id=?1 LEFT JOIN appx_group_members f ON f.group_id=s.group_id AND f.member_id=s.from_member_id LEFT JOIN appx_group_members t ON t.group_id=s.group_id AND t.member_id=s.to_member_id WHERE s.status='pending' AND (s.to_member_id=?1 OR s.from_member_id=?1 OR (s.created_by=s.to_member_id AND me.role='admin' AND me.status='active')) ORDER BY s.created_at DESC LIMIT 100").bind(uid).all<{
      id: string; groupId: string; groupName: string; fromMemberId: string; fromName: string; toMemberId: string; toName: string; amountCents: number; kind: PaymentKind; createdAt: number; createdBy: string; needsAdmin: number; iAmAdmin: number; hasProof: number;
    }>();
  }
  // Pending totals per direction in a group.
  pendingTotals(gid: string) {
    return this.db.prepare("SELECT from_member_id AS f,to_member_id AS t,SUM(amount_cents) AS c FROM appx_settlements WHERE group_id=? AND status='pending' GROUP BY from_member_id,to_member_id").bind(gid).all<{ f: string; t: string; c: number }>();
  }
  // Pending totals per direction involving one member.
  pendingTotalsFor(gid: string, uid: string) {
    return this.db.prepare("SELECT from_member_id AS f,to_member_id AS t,SUM(amount_cents) AS c FROM appx_settlements WHERE group_id=?1 AND status='pending' AND (from_member_id=?2 OR to_member_id=?2) GROUP BY from_member_id,to_member_id").bind(gid, uid).all<{ f: string; t: string; c: number }>();
  }
  async pendingBetween(gid: string, from: string, to: string): Promise<number> {
    return Number((await this.db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS c FROM appx_settlements WHERE group_id=? AND from_member_id=? AND to_member_id=? AND status='pending'").bind(gid, from, to).first<{ c: number }>())?.c || 0);
  }
  // All of one member's payments, oldest first (statement).
  memberPaymentsOldestFirst(gid: string, mid: string) {
    return this.db.prepare("SELECT id,from_member_id AS fromMemberId,to_member_id AS toMemberId,amount_cents AS amountCents,created_at AS createdAt,status,kind FROM appx_settlements WHERE group_id=?1 AND (from_member_id=?2 OR to_member_id=?2) ORDER BY created_at,id").bind(gid, mid).all<PaymentRow>();
  }
  // One member's payments except rejected ones, newest first (member summary).
  memberPaymentsNewestFirst(gid: string, mid: string) {
    return this.db.prepare("SELECT id,from_member_id AS fromMemberId,to_member_id AS toMemberId,amount_cents AS amountCents,created_at AS createdAt,status,kind FROM appx_settlements WHERE group_id=?1 AND (from_member_id=?2 OR to_member_id=?2) AND status<>'rejected' ORDER BY created_at DESC LIMIT 200").bind(gid, mid).all<PaymentActivityRow & { status: "pending" | "confirmed"; kind: PaymentKind }>();
  }
  // Confirmed payments between two members.
  confirmedBetween(gid: string, a: string, b: string) {
    return this.db.prepare("SELECT id,from_member_id AS fromMemberId,to_member_id AS toMemberId,amount_cents AS amountCents,created_at AS createdAt,kind FROM appx_settlements WHERE group_id=?1 AND status='confirmed' AND ((from_member_id=?2 AND to_member_id=?3) OR (from_member_id=?3 AND to_member_id=?2))").bind(gid, a, b).all<PaymentActivityRow>();
  }

  // Records a payment only if it still fits what is owed (checked inside the
  // INSERT, so two at once can never overpay the same debt).
  insertIfOwed(p: { id: string; gid: string; from: string; to: string; cents: number; createdBy: string; now: number; status: string; kind: PaymentKind }) {
    return this.db.prepare(
      "INSERT INTO appx_settlements(id,group_id,from_member_id,to_member_id,amount_cents,created_by,created_at,status,decided_by,decided_at,kind) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11 WHERE ?5 <= " + owedSql("?2", "?3", "?4", true),
    ).bind(p.id, p.gid, p.from, p.to, p.cents, p.createdBy, p.now, p.status, p.status === "confirmed" ? p.createdBy : null, p.status === "confirmed" ? p.now : null, p.kind).run();
  }
  // Confirms a pending payment only while it still fits what is owed.
  confirmIfOwed(sid: string, by: string, now: number, gid: string, from: string, to: string) {
    return this.db.prepare("UPDATE appx_settlements SET status='confirmed',decided_by=?1,decided_at=?2 WHERE id=?3 AND status='pending' AND amount_cents <= " + owedSql("?4", "?5", "?6")).bind(by, now, sid, gid, from, to).run();
  }
  reject(sid: string, by: string, now: number) { return this.db.prepare("UPDATE appx_settlements SET status='rejected',decided_by=?,decided_at=? WHERE id=? AND status='pending'").bind(by, now, sid).run(); }
  deletePendingStmt(sid: string) { return this.db.prepare("DELETE FROM appx_settlements WHERE id=? AND status='pending'").bind(sid); }

  // ----- Screenshots -----
  insertProof(sid: string, mime: string, base64: string, now: number) { return this.db.prepare("INSERT INTO appx_payment_proofs(settlement_id,mime,base64,created_at) VALUES(?,?,?,?)").bind(sid, mime, base64, now).run(); }
  proof(sid: string, gid: string) { return this.db.prepare("SELECT p.mime,p.base64 FROM appx_payment_proofs p JOIN appx_settlements s ON s.id=p.settlement_id WHERE p.settlement_id=? AND s.group_id=?").bind(sid, gid).first<{ mime: string; base64: string }>(); }
  deleteProofStmt(sid: string) { return this.db.prepare("DELETE FROM appx_payment_proofs WHERE settlement_id=?").bind(sid); }
}
