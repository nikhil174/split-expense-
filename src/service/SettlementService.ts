// Payments between members ("settling up"). A payment counts only once the
// person who received it confirms it; one the receiver recorded themselves
// ("they paid me") needs a group admin's approval instead.
import type { Debt as ApiDebt, Debts, Mine, PendingPayment, Settlement } from "../../shared/api-types.ts";
import { nameLookup } from "../domain/members.ts";
import { parseAmountToCents, rupees } from "../domain/money.ts";
import { awaitsDecisionBy, canCancel, canDecide, decisionRefusal, initialStatus, mayCancel, mayRecord, mayRecordDebt, needsAdminApproval, PaymentStatus, type PaymentActor } from "../domain/payments.ts";
import { computePairwiseDebts, debtsForMember, outstandingDebt, SettlementError, validateSettlement, type Debt } from "../domain/settlement.ts";
import { textField } from "../domain/text.ts";
import { ApiError, conflict, forbidden, notFound } from "../http/ApiError.ts";
import type { ExpenseRepository } from "../repository/ExpenseRepository.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { HistoryRepository } from "../repository/HistoryRepository.ts";
import type { SettlementRepository } from "../repository/SettlementRepository.ts";
import type { Transaction } from "../repository/Transaction.ts";
import { changesOf } from "../repository/db.ts";
import type { CurrentUser } from "../repository/types.ts";
import { newId } from "../security/crypto.ts";
import type { GroupScope } from "./GroupScope.ts";
import { parseImage } from "./PaymentMethodService.ts";
import type { PaymentNotifications } from "./PaymentNotifications.ts";

// The person acting in a group, as the payment rules see them.
const actorIn = (s: GroupScope): PaymentActor => ({ id: s.user.id, isAdmin: s.isAdmin });

export class SettlementService {
  private readonly tx: Transaction;
  private readonly settlements: SettlementRepository;
  private readonly expenses: ExpenseRepository;
  private readonly groups: GroupRepository;
  private readonly history: HistoryRepository;
  private readonly paymentNotes: PaymentNotifications;
  constructor(deps: { tx: Transaction; settlements: SettlementRepository; expenses: ExpenseRepository; groups: GroupRepository; history: HistoryRepository; paymentNotes: PaymentNotifications }) {
    this.tx = deps.tx; this.settlements = deps.settlements; this.expenses = deps.expenses; this.groups = deps.groups; this.history = deps.history; this.paymentNotes = deps.paymentNotes;
  }

  // The group's payments, newest first, with what I may do with each.
  async list(s: GroupScope): Promise<{ settlements: Settlement[] }> {
    const actor = actorIn(s);
    const r = await this.settlements.list(s.gid);
    return { settlements: r.results.map(x => ({
      ...x, amount: rupees(x.amountCents),
      // needsAdmin: recorded by the receiver ("they paid me"); an admin decides it.
      needsAdmin: needsAdminApproval(x),
      canDecide: canDecide(x, actor),
      canCancel: canCancel(x, actor),
      hasProof: !!x.hasProof,
    })) };
  }

  // Who owes whom in the group (all debts, or mine), with what is already
  // waiting for approval and whether I may record a payment for each.
  async debts(s: GroupScope, which: "all" | "mine"): Promise<Debts | Mine> {
    const u = s.user, isAdmin = s.isAdmin;
    const [members, ledger] = await Promise.all([this.groups.members(s.gid), this.expenses.ledger(s.gid)]);
    const nameOf = nameLookup(members);
    const activeIds = new Set(members.filter(x => x.active).map(x => x.id));
    const debts = computePairwiseDebts(ledger);
    // Normal members may only record their own outgoing payments, to an
    // active member. The admin may record any payment (including to or from
    // a removed member, so such debts can still be cleared).
    // (Members can also record "they paid me"; an admin approves it.)
    const canRecord = (d: Debt) => mayRecordDebt(d, actorIn(s), id => activeIds.has(id));
    const waiting = new Map((await this.settlements.pendingTotals(s.gid)).results.map(x => [x.f + ">" + x.t, Number(x.c)]));
    // waitingCents: already sent and waiting for the receiver to confirm, so
    // at most amountCents - waitingCents more can be recorded.
    const describe = (d: Debt): ApiDebt => ({
      fromMemberId: d.fromMemberId, fromName: nameOf(d.fromMemberId), toMemberId: d.toMemberId, toName: nameOf(d.toMemberId), amountCents: d.amountCents, amount: rupees(d.amountCents),
      waitingCents: waiting.get(d.fromMemberId + ">" + d.toMemberId) || 0, canRecord: canRecord(d), counterpartyActive: activeIds.has(d.fromMemberId === u.id ? d.toMemberId : d.fromMemberId),
    });
    if (which === "all") return { model: "direct-expense-attribution" as const, debts: debts.map(describe) };
    const mine = debtsForMember(debts, u.id);
    return {
      model: "direct-expense-attribution" as const,
      memberId: u.id,
      memberName: u.name,
      isAdmin,
      youOwe: mine.youOwe.map(describe),
      owedToYou: mine.owedToYou.map(describe),
      totalYouOweCents: mine.totalYouOweCents,
      totalOwedToYouCents: mine.totalOwedToYouCents,
      debts: [...mine.youOwe, ...mine.owedToYou].map(describe),
    };
  }

  // Record a payment (it may carry a screenshot of it).
  async record(s: GroupScope, b: any) {
    const u = s.user, gid = s.gid, isAdmin = s.isAdmin;
    const proof = b?.proof ? parseImage(b.proof, "screenshot") : null;
    if (proof && "error" in proof) throw new ApiError(proof.error);
    const from = textField(b?.fromMemberId), to = textField(b?.toMemberId);
    if (!from || !to) throw new ApiError("Choose who is paying and who is being paid.");
    if (from === to) throw new ApiError("A member cannot pay themselves.");
    // Members record a payment they made (the receiver confirms it), or one
    // made to them ("they paid me": a group admin approves it).
    if (!mayRecord(from, to, actorIn(s))) throw forbidden("You can only record a payment you made or one made to you.");
    let cents: number;
    try { cents = parseAmountToCents(b?.amount); } catch (error) { throw new ApiError((error as Error).message); }
    const members = await this.groups.members(gid);
    const byId = new Map(members.map(x => [x.id, x]));
    if (!byId.has(from) || !byId.has(to)) throw new ApiError("Both members must belong to this group.");
    if (!isAdmin && from === u.id && !byId.get(to)!.active) throw conflict(byId.get(to)!.name + " is no longer in this group. Ask a group admin to record this payment.");
    try {
      validateSettlement({ debts: computePairwiseDebts(await this.expenses.ledger(gid)), fromMemberId: from, toMemberId: to, amountCents: cents, actorId: u.id, actorIsAdmin: isAdmin });
    } catch (error) {
      if (error instanceof SettlementError) throw new ApiError(error.message, error.status);
      throw error;
    }
    // Money already sent to this person and waiting for them to confirm
    // counts against what can still be paid.
    const waiting = await this.settlements.pendingBetween(gid, from, to);
    if (waiting) {
      const due = outstandingDebt(computePairwiseDebts(await this.expenses.ledger(gid)), from, to);
      if (cents > due - waiting) throw conflict(`₹${(waiting / 100).toFixed(2)} is already waiting for approval, so at most ₹${(Math.max(0, due - waiting) / 100).toFixed(2)} more can be recorded now.`);
    }
    // The receiver has to confirm a payment before it counts. When the
    // receiver records it themselves ("they paid me"), a group admin has to
    // approve it, unless the receiver is an admin. An admin may also record
    // a payment to someone who left (who can't confirm it any more).
    const status = initialStatus(to, actorIn(s), byId.get(to)!.active);
    const settlementId = newId(), now = Date.now();
    const result = await this.settlements.insertIfOwed({ id: settlementId, gid, from, to, cents, createdBy: u.id, now, status });
    if (changesOf(result) !== 1) throw conflict("The outstanding amount changed. Refresh and try again.");
    if (proof) await this.settlements.insertProof(settlementId, proof.mime, proof.base64, now);
    const notes = this.paymentNotes.recorded(
      { gid, from, to, cents, createdBy: u.id, status, hasProof: !!proof },
      { actor: u, nameOf: nameLookup(members) },
      members.filter(x => x.role === "admin" && x.active && x.id !== u.id).map(x => x.id),
    );
    if (notes.length) await this.tx.run(notes);
    return { ok: true, id: settlementId, amountCents: cents, status };
  }

  // The screenshot attached to a payment.
  async proof(s: GroupScope, sid: string) {
    const r = await this.settlements.proof(sid, s.gid);
    if (!r) throw notFound("No screenshot for this payment.");
    return r;
  }

  // The receiver (or an admin) confirms or rejects a pending payment; the
  // payer, whoever recorded it, or an admin can cancel it while it's pending.
  async decide(s: GroupScope, sid: string, action: "confirm" | "reject" | "cancel") {
    const u = s.user, gid = s.gid, actor = actorIn(s);
    const pay = await this.settlements.find(sid, gid);
    if (!pay) throw notFound("Payment not found.");
    const facts = { fromMemberId: pay.fromId, toMemberId: pay.toId, createdBy: pay.createdBy, status: pay.status };
    if (pay.status !== PaymentStatus.Pending) throw conflict(`This payment was already ${pay.status}.`);
    const now = Date.now();
    const told = { actor: u, nameOf: nameLookup(await this.groups.members(gid)) };
    const note = { gid, from: pay.fromId, to: pay.toId, cents: pay.cents, createdBy: pay.createdBy };
    if (action === "cancel") {
      if (!mayCancel(facts, actor)) throw forbidden("Only the person who recorded it, the payer or a group admin can cancel this payment.");
      await this.tx.run([
        this.history.insertStmt({ gid, entity: "payment", entityId: sid, action: "cancelled", actor: u.id, before: { fromMemberId: pay.fromId, toMemberId: pay.toId, amountCents: pay.cents, createdBy: pay.createdBy, createdAt: pay.createdAt } }),
        this.settlements.deleteProofStmt(sid),
        this.settlements.deletePendingStmt(sid),
      ]);
      await this.paymentNotes.cancelled(note, told);
      return { ok: true, cancelled: true };
    }
    const refusal = decisionRefusal(facts, actor);
    if (refusal) throw forbidden(refusal);
    if (action === "reject") {
      await this.settlements.reject(sid, u.id, now);
      await this.paymentNotes.rejected(note, told);
      return { ok: true, status: PaymentStatus.Rejected };
    }
    // Confirm only while it still fits what is owed (expenses may have changed).
    const result = await this.settlements.confirmIfOwed(sid, u.id, now, gid, pay.fromId, pay.toId);
    if (changesOf(result) !== 1) throw conflict("This payment is now more than what is owed, because expenses changed since it was sent. Reject it and ask for a new one.");
    await this.paymentNotes.confirmed(note, told);
    return { ok: true, status: PaymentStatus.Confirmed };
  }

  // Payments waiting on me (to confirm) or on someone else (that I sent),
  // across all my groups. Mine to decide: payments to me, or (as a group
  // admin) "they paid me" payments recorded by someone else.
  async pendingForMe(u: CurrentUser): Promise<{ toConfirm: PendingPayment[]; waiting: PendingPayment[] }> {
    const r = await this.settlements.pendingFor(u.id);
    const rows = r.results.map(x => {
      const needsAdmin = !!x.needsAdmin;
      const decide = awaitsDecisionBy(x, { id: u.id, isAdmin: !!x.iAmAdmin });
      return { id: x.id, groupId: x.groupId, groupName: x.groupName, fromMemberId: x.fromMemberId, fromName: x.fromName, toMemberId: x.toMemberId, toName: x.toName, amountCents: x.amountCents, createdAt: x.createdAt, hasProof: !!x.hasProof, needsAdmin, incoming: decide };
    });
    return { toConfirm: rows.filter(x => x.incoming), waiting: rows.filter(x => !x.incoming && (x.fromMemberId === u.id || x.toMemberId === u.id)) };
  }
}
