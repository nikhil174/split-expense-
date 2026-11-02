// Payments between members ("settling up"). A payment counts only once the
// person who received it confirms it; one the receiver recorded themselves
// ("they paid me") needs a group admin's approval instead. A lender can also
// let someone off what they still owe (a waiver), which a group admin approves
// and the whole group hears about.
import type { Debt as ApiDebt, Debts, Mine, PendingPayment, Settlement } from "../../shared/api-types.ts";
import type { Clock } from "../config/Clock.ts";
import type { Untrusted } from "../domain/input.ts";
import { nameLookup } from "../domain/members.ts";
import { parseAmountToCents, rupees } from "../domain/money.ts";
import { awaitsDecisionBy, canCancel, canDecide, decisionRefusal, initialStatus, mayCancel, mayRecord, mayRecordDebt, mayAskWaiver, mayWaive, needsAdminApproval, PaymentKind, PaymentStatus, type PaymentActor } from "../domain/payments.ts";
import { computePairwiseDebts, debtsForMember, outstandingDebt, SettlementError, validateSettlement, type Debt } from "../domain/settlement.ts";
import { textField } from "../domain/text.ts";
import { ApiError, conflict, forbidden, notFound } from "../http/ApiError.ts";
import type { ExpenseRepository } from "../repository/ExpenseRepository.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { HistoryRepository } from "../repository/HistoryRepository.ts";
import type { SettlementRepository } from "../repository/SettlementRepository.ts";
import type { Statement, Transaction } from "../repository/Transaction.ts";
import { changesOf } from "../repository/db.ts";
import type { CurrentUser } from "../repository/types.ts";
import { newId } from "../security/crypto.ts";
import type { GroupScope } from "./GroupScope.ts";
import { parseImage } from "./PaymentMethodService.ts";
import type { PaymentNotifications } from "./PaymentNotifications.ts";
import type { WaiverNotifications } from "./WaiverNotifications.ts";

// The person acting in a group, as the payment rules see them.
const actorIn = (s: GroupScope): PaymentActor => ({ id: s.user.id, isAdmin: s.isAdmin });

export class SettlementService {
  private readonly tx: Transaction;
  private readonly settlements: SettlementRepository;
  private readonly expenses: ExpenseRepository;
  private readonly groups: GroupRepository;
  private readonly history: HistoryRepository;
  private readonly paymentNotes: PaymentNotifications;
  private readonly waiverNotes: WaiverNotifications;
  private readonly clock: Clock;
  constructor(deps: { clock: Clock; tx: Transaction; settlements: SettlementRepository; expenses: ExpenseRepository; groups: GroupRepository; history: HistoryRepository; paymentNotes: PaymentNotifications; waiverNotes: WaiverNotifications }) {
    this.clock = deps.clock;
    this.tx = deps.tx; this.settlements = deps.settlements; this.expenses = deps.expenses; this.groups = deps.groups; this.history = deps.history;
    this.paymentNotes = deps.paymentNotes; this.waiverNotes = deps.waiverNotes;
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
  async record(s: GroupScope, b: Untrusted<"fromMemberId" | "toMemberId" | "amount" | "proof">) {
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
    const settlementId = newId(), now = this.clock.now();
    const result = await this.settlements.insertIfOwed({ id: settlementId, gid, from, to, cents, createdBy: u.id, now, status, kind: PaymentKind.Payment });
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

  // The lender lets a member off what they still owe them ("no need to pay").
  // It is stored as a payment from the debtor to the lender that the lender
  // recorded, so a group admin approves it (an admin lender's counts at once)
  // and, once confirmed, it clears the debt exactly as a payment would.
  async waive(s: GroupScope, b: Untrusted<"fromMemberId" | "amount">) {
    const from = textField(b?.fromMemberId), to = s.user.id;
    if (!from) throw new ApiError("Choose who you're letting off.");
    if (from === to) throw new ApiError("You can't let yourself off.");
    if (!mayWaive(to, actorIn(s))) throw forbidden("Only the person who is owed can let someone off.");
    return this.createWaiver(s, from, to, b?.amount, {
      nothingOwed: "They don't owe you anything.",
      allPending: "Everything they owe you is already waiting for approval.",
      tooMuch: left => `They owe you ₹${left} that isn't already waiting for approval, so you can let them off at most that.`,
    });
  }

  // The debtor asks the lender to let them off what they still owe. It is
  // recorded by the debtor, like a payment they made, so the lender (or a
  // group admin, but never the debtor) decides it.
  async askWaiver(s: GroupScope, b: Untrusted<"toMemberId" | "amount">) {
    const from = s.user.id, to = textField(b?.toMemberId);
    if (!to) throw new ApiError("Choose who you're asking.");
    if (from === to) throw new ApiError("You can't ask yourself.");
    if (!mayAskWaiver(from, actorIn(s))) throw forbidden("Only the person who owes can ask to be let off.");
    return this.createWaiver(s, from, to, b?.amount, {
      nothingOwed: "You don't owe them anything.",
      allPending: "Everything you owe them is already waiting for approval.",
      tooMuch: left => `You owe them ₹${left} that isn't already waiting for approval, so you can ask to be let off at most that.`,
    });
  }

  // Records a waiver from `from` to `to` for the amount given, or by default
  // everything still unpaid (what is owed less what is already waiting for
  // approval), and tells whoever needs to know.
  private async createWaiver(s: GroupScope, from: string, to: string, amountInput: unknown, say: { nothingOwed: string; allPending: string; tooMuch: (left: string) => string }) {
    const u = s.user, gid = s.gid, actor = actorIn(s);
    const members = await this.groups.members(gid);
    const lender = members.find(x => x.id === to);
    if (!lender || !members.some(x => x.id === from)) throw new ApiError("They must belong to this group.");
    const asked = u.id === from;
    // Someone who left can't answer a request any more.
    if (asked && !lender.active) throw conflict(lender.name + " is no longer in this group, so they can't let you off. Ask a group admin to record a payment instead.");
    const due = outstandingDebt(computePairwiseDebts(await this.expenses.ledger(gid)), from, to);
    if (due === 0) throw conflict(say.nothingOwed);
    const left = due - await this.settlements.pendingBetween(gid, from, to);
    if (left <= 0) throw conflict(say.allPending);
    let cents = left;
    if (amountInput !== undefined && amountInput !== null && amountInput !== "") {
      try { cents = parseAmountToCents(amountInput); } catch (error) { throw new ApiError((error as Error).message); }
      if (cents > left) throw conflict(say.tooMuch((left / 100).toFixed(2)));
    }
    // A request always waits for an answer; an offer counts at once from an admin lender.
    const status = asked ? PaymentStatus.Pending : initialStatus(to, actor, true);
    const id = newId(), now = this.clock.now();
    const result = await this.settlements.insertIfOwed({ id, gid, from, to, cents, createdBy: u.id, now, status, kind: PaymentKind.Waiver });
    if (changesOf(result) !== 1) throw conflict("The outstanding amount changed. Refresh and try again.");
    const note = { gid, from, to, cents, createdBy: u.id }, told = { actor: u, nameOf: nameLookup(members) };
    const notes = asked ? this.waiverNotes.asked(note, told)
      : status === PaymentStatus.Confirmed ? this.waiverNotes.approved(note, told, members.filter(x => x.active).map(x => x.id))
      : this.waiverNotes.requested(note, told, members.filter(x => x.role === "admin" && x.active).map(x => x.id));
    await this.send(notes);
    return { ok: true, id, amountCents: cents, status };
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
    const waiver = pay.kind === PaymentKind.Waiver;
    const facts = { fromMemberId: pay.fromId, toMemberId: pay.toId, createdBy: pay.createdBy, status: pay.status, kind: pay.kind };
    if (pay.status !== PaymentStatus.Pending) throw conflict(`This ${waiver ? "request to let them off" : "payment"} was already ${pay.status}.`);
    const now = this.clock.now();
    const members = await this.groups.members(gid);
    const told = { actor: u, nameOf: nameLookup(members) };
    const note = { gid, from: pay.fromId, to: pay.toId, cents: pay.cents, createdBy: pay.createdBy };
    if (action === "cancel") {
      if (!mayCancel(facts, actor)) throw forbidden(waiver ? "Only whoever started it or a group admin can cancel this." : "Only the person who recorded it, the payer or a group admin can cancel this payment.");
      await this.tx.run([
        this.history.insertStmt({ gid, entity: "payment", entityId: sid, action: "cancelled", actor: u.id, before: { fromMemberId: pay.fromId, toMemberId: pay.toId, amountCents: pay.cents, createdBy: pay.createdBy, createdAt: pay.createdAt, kind: pay.kind } }),
        this.settlements.deleteProofStmt(sid),
        this.settlements.deletePendingStmt(sid),
      ]);
      if (waiver) await this.send(this.waiverNotes.cancelled(note, told));
      else await this.paymentNotes.cancelled(note, told);
      return { ok: true, cancelled: true };
    }
    const refusal = decisionRefusal(facts, actor);
    if (refusal) throw forbidden(refusal);
    if (action === "reject") {
      await this.settlements.reject(sid, u.id, now);
      if (waiver) await this.send(this.waiverNotes.rejected(note, told));
      else await this.paymentNotes.rejected(note, told);
      return { ok: true, status: PaymentStatus.Rejected };
    }
    // Confirm only while it still fits what is owed (expenses may have changed).
    const result = await this.settlements.confirmIfOwed(sid, u.id, now, gid, pay.fromId, pay.toId);
    if (changesOf(result) !== 1) throw conflict(waiver
      ? "This is now more than they owe, because expenses changed since it was asked. Reject it and ask again."
      : "This payment is now more than what is owed, because expenses changed since it was sent. Reject it and ask for a new one.");
    if (waiver) await this.send(this.waiverNotes.approved(note, told, members.filter(x => x.active).map(x => x.id)));
    else await this.paymentNotes.confirmed(note, told);
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
      return { id: x.id, groupId: x.groupId, groupName: x.groupName, fromMemberId: x.fromMemberId, fromName: x.fromName, toMemberId: x.toMemberId, toName: x.toName, amountCents: x.amountCents, kind: x.kind, createdAt: x.createdAt, hasProof: !!x.hasProof, needsAdmin, incoming: decide };
    });
    return { toConfirm: rows.filter(x => x.incoming), waiting: rows.filter(x => !x.incoming && (x.fromMemberId === u.id || x.toMemberId === u.id)) };
  }

  // Writes notifications, if there are any.
  private async send(notes: Statement[]): Promise<void> {
    if (notes.length) await this.tx.run(notes);
  }
}
