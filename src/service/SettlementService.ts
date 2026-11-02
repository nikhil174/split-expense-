// Payments between members ("settling up"). A payment counts only once the
// person who received it confirms it; one the receiver recorded themselves
// ("they paid me") needs a group admin's approval instead.
import type { Debt as ApiDebt, Debts, Mine, PendingPayment, Settlement } from "../../shared/api-types.ts";
import { FORMER_MEMBER } from "../config/constants.ts";
import { nameLookup } from "../domain/members.ts";
import { inrText, parseAmountToCents, rupees } from "../domain/money.ts";
import { awaitsDecisionBy, canCancel, canDecide, decisionRefusal, initialStatus, mayCancel, mayRecord, mayRecordDebt, needsAdminApproval, PaymentStatus, type PaymentActor } from "../domain/payments.ts";
import { computePairwiseDebts, debtsForMember, outstandingDebt, SettlementError, validateSettlement, type Debt } from "../domain/settlement.ts";
import { textField } from "../domain/text.ts";
import { ApiError, conflict, forbidden, notFound } from "../http/ApiError.ts";
import type { ExpenseRepository } from "../repository/ExpenseRepository.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { HistoryRepository } from "../repository/HistoryRepository.ts";
import type { SettlementRepository } from "../repository/SettlementRepository.ts";
import { changesOf } from "../repository/db.ts";
import type { CurrentUser } from "../repository/types.ts";
import { newId } from "../security/crypto.ts";
import type { GroupScope } from "./GroupService.ts";

// The person acting in a group, as the payment rules see them.
const actorIn = (s: GroupScope): PaymentActor => ({ id: s.user.id, isAdmin: s.isAdmin });
import type { Notifier } from "./Notifier.ts";
import { parseImage } from "./PaymentMethodService.ts";

export class SettlementService {
  private readonly db: D1Database;
  private readonly settlements: SettlementRepository;
  private readonly expenses: ExpenseRepository;
  private readonly groups: GroupRepository;
  private readonly history: HistoryRepository;
  private readonly notify: Notifier;
  constructor(deps: { db: D1Database; settlements: SettlementRepository; expenses: ExpenseRepository; groups: GroupRepository; history: HistoryRepository; notify: Notifier }) {
    this.db = deps.db; this.settlements = deps.settlements; this.expenses = deps.expenses; this.groups = deps.groups; this.history = deps.history; this.notify = deps.notify;
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
    const byReceiver = to === u.id;
    const status = initialStatus(to, actorIn(s), byId.get(to)!.active);
    const settlementId = newId(), now = Date.now();
    const result = await this.settlements.insertIfOwed({ id: settlementId, gid, from, to, cents, createdBy: u.id, now, status });
    if (changesOf(result) !== 1) throw conflict("The outstanding amount changed. Refresh and try again.");
    if (proof) await this.settlements.insertProof(settlementId, proof.mime, proof.base64, now);
    // Tell the receiver (to confirm it) and, if someone else recorded it, the payer.
    // "They paid me" waiting for approval goes to the group's admins.
    const nm = (x: string) => byId.get(x)?.name || FORMER_MEMBER, notes: D1PreparedStatement[] = [];
    if (byReceiver && status === PaymentStatus.Pending) {
      for (const a of members.filter(x => x.role === "admin" && x.active && x.id !== u.id)) {
        notes.push(this.notify.stmt({ to: a.id, groupId: gid, kind: "payment_admin_approval", actor: u.name, title: `${u.name} says ${nm(from)} paid them ${inrText(cents)}`, body: "Approve it if it's right; it counts once an admin approves.", link: `#/g/${gid}` }));
      }
    }
    const pending = status === PaymentStatus.Pending;
    if (to !== u.id) notes.push(this.notify.stmt({ to, groupId: gid, kind: pending ? "payment_pending" : "payment_recorded", actor: u.name,
      title: pending ? `${nm(from)} says they paid you ${inrText(cents)}` : `${u.name} recorded ${inrText(cents)} from ${nm(from)} to you`,
      // Pending: the group, where the approve card is on top; otherwise what's between you two.
      body: pending ? (proof ? "They attached a screenshot. Confirm it once you've received it." : "Confirm it once you've received it.") : "It counts in your balance now.", link: pending ? `#/g/${gid}` : `#/g/${gid}/p/${from}` }));
    if (from !== u.id) notes.push(this.notify.stmt({ to: from, groupId: gid, kind: "payment_recorded", actor: u.name,
      title: `${u.name} recorded your payment of ${inrText(cents)} to ${to === u.id ? "them" : nm(to)}`,
      body: pending ? (byReceiver ? "It counts once a group admin approves it." : `It counts once ${nm(to)} confirms it.`) : "It counts in your balance now.", link: `#/g/${gid}/p/${to}` }));
    if (notes.length) await this.db.batch(notes);
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
    const nm = nameLookup(await this.groups.members(gid));
    // Each side is taken to what's between them and the other person.
    const tell = (to: string, kind: string, title: string, body: string) => to === u.id ? Promise.resolve() : this.db.batch([this.notify.stmt({ to, groupId: gid, kind, title, body, link: `#/g/${gid}/p/${to === pay.fromId ? pay.toId : pay.fromId}`, actor: u.name })]);
    // "They paid me", recorded by the receiver: a group admin decides it.
    const needsAdmin = needsAdminApproval(facts);
    if (action === "cancel") {
      if (!mayCancel(facts, actor)) throw forbidden("Only the person who recorded it, the payer or a group admin can cancel this payment.");
      await this.db.batch([
        this.history.insertStmt({ gid, entity: "payment", entityId: sid, action: "cancelled", actor: u.id, before: { fromMemberId: pay.fromId, toMemberId: pay.toId, amountCents: pay.cents, createdBy: pay.createdBy, createdAt: pay.createdAt } }),
        this.settlements.deleteProofStmt(sid),
        this.settlements.deletePendingStmt(sid),
      ]);
      if (!needsAdmin) await tell(pay.toId, "payment_cancelled", `${u.id === pay.fromId ? nm(pay.fromId) : u.name} cancelled a payment of ${inrText(pay.cents)}`, "You don't need to confirm it any more.");
      else {
        // "They paid me" cancelled: whoever didn't cancel it (lender and/or payer) hears about it.
        await tell(pay.toId, "payment_cancelled", u.id === pay.fromId ? `${u.name} cancelled the ${inrText(pay.cents)} you recorded from them` : `${u.name} cancelled the ${inrText(pay.cents)} recorded from ${nm(pay.fromId)}`, "It doesn't count.");
        await tell(pay.fromId, "payment_cancelled", `${u.name} cancelled the payment of ${inrText(pay.cents)} recorded for you`, "It doesn't count.");
      }
      return { ok: true, cancelled: true };
    }
    const refusal = decisionRefusal(facts, actor);
    if (refusal) throw forbidden(refusal);
    if (action === "reject") {
      await this.settlements.reject(sid, u.id, now);
      if (needsAdmin) {
        await tell(pay.toId, "payment_rejected", `${u.name} didn't approve the ${inrText(pay.cents)} from ${nm(pay.fromId)}`, "It doesn't count. Check with them and record it again if needed.");
        await tell(pay.fromId, "payment_rejected", `${u.name} didn't approve your payment of ${inrText(pay.cents)} to ${nm(pay.toId)}`, "It doesn't count. If you did pay, check with them and the admins.");
      }
      else await tell(pay.fromId, "payment_rejected", `${u.name} said they didn't receive your ${inrText(pay.cents)}`, "It doesn't count. Check with them and record it again if needed.");
      return { ok: true, status: PaymentStatus.Rejected };
    }
    // Confirm only while it still fits what is owed (expenses may have changed).
    const result = await this.settlements.confirmIfOwed(sid, u.id, now, gid, pay.fromId, pay.toId);
    if (changesOf(result) !== 1) throw conflict("This payment is now more than what is owed, because expenses changed since it was sent. Reject it and ask for a new one.");
    if (needsAdmin) {
      await tell(pay.toId, "payment_confirmed", `${u.name} approved the ${inrText(pay.cents)} from ${nm(pay.fromId)}`, "It counts in your balance now.");
      await tell(pay.fromId, "payment_confirmed", `Your payment of ${inrText(pay.cents)} to ${nm(pay.toId)} is approved`, "It counts in your balance now.");
    } else await tell(pay.fromId, "payment_confirmed", `${u.name} confirmed your payment of ${inrText(pay.cents)}`, "It counts in your balance now.");
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
