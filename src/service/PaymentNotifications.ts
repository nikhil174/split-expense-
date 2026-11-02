// What people are told about payments: who hears about a payment being
// recorded, confirmed, rejected or cancelled, and in what words. Each person
// is taken to what's between them and the other person.
import { inrText } from "../domain/money.ts";
import { needsAdminApproval, PaymentStatus } from "../domain/payments.ts";
import type { Statement, Transaction } from "../repository/Transaction.ts";
import type { Actor, Notifier } from "./Notifier.ts";

// The payment, from the notifications' point of view.
export type PaymentNote = { gid: string; from: string; to: string; cents: number; createdBy: string };
type Context = { actor: Actor; nameOf: (memberId: string) => string };

export class PaymentNotifications {
  private readonly notify: Notifier;
  private readonly tx: Transaction;
  constructor(notify: Notifier, tx: Transaction) { this.notify = notify; this.tx = tx; }

  // A new payment: the receiver (to confirm it) and, if someone else recorded
  // it, the payer. "They paid me" waiting for approval goes to the group's
  // admins (other than whoever recorded it).
  recorded(p: PaymentNote & { status: PaymentStatus; hasProof: boolean }, { actor, nameOf }: Context, adminIds: string[]): Statement[] {
    const { gid, from, to, cents } = p, notes: Statement[] = [];
    const byReceiver = to === actor.id, pending = p.status === PaymentStatus.Pending;
    if (byReceiver && pending) {
      for (const admin of adminIds) {
        notes.push(this.notify.stmt({ to: admin, groupId: gid, kind: "payment_admin_approval", actor: actor.name, title: `${actor.name} says ${nameOf(from)} paid them ${inrText(cents)}`, body: "Approve it if it's right; it counts once an admin approves.", link: `#/g/${gid}` }));
      }
    }
    if (to !== actor.id) notes.push(this.notify.stmt({ to, groupId: gid, kind: pending ? "payment_pending" : "payment_recorded", actor: actor.name,
      title: pending ? `${nameOf(from)} says they paid you ${inrText(cents)}` : `${actor.name} recorded ${inrText(cents)} from ${nameOf(from)} to you`,
      // Pending: the group, where the approve card is on top; otherwise what's between you two.
      body: pending ? (p.hasProof ? "They attached a screenshot. Confirm it once you've received it." : "Confirm it once you've received it.") : "It counts in your balance now.", link: pending ? `#/g/${gid}` : `#/g/${gid}/p/${from}` }));
    if (from !== actor.id) notes.push(this.notify.stmt({ to: from, groupId: gid, kind: "payment_recorded", actor: actor.name,
      title: `${actor.name} recorded your payment of ${inrText(cents)} to ${to === actor.id ? "them" : nameOf(to)}`,
      body: pending ? (byReceiver ? "It counts once a group admin approves it." : `It counts once ${nameOf(to)} confirms it.`) : "It counts in your balance now.", link: `#/g/${gid}/p/${to}` }));
    return notes;
  }

  async confirmed(p: PaymentNote, c: Context): Promise<void> {
    const { actor, nameOf } = c, amount = inrText(p.cents);
    if (this.byAdmin(p)) {
      await this.tell(p, c, p.to, "payment_confirmed", `${actor.name} approved the ${amount} from ${nameOf(p.from)}`, "It counts in your balance now.");
      await this.tell(p, c, p.from, "payment_confirmed", `Your payment of ${amount} to ${nameOf(p.to)} is approved`, "It counts in your balance now.");
    } else await this.tell(p, c, p.from, "payment_confirmed", `${actor.name} confirmed your payment of ${amount}`, "It counts in your balance now.");
  }

  async rejected(p: PaymentNote, c: Context): Promise<void> {
    const { actor, nameOf } = c, amount = inrText(p.cents);
    if (this.byAdmin(p)) {
      await this.tell(p, c, p.to, "payment_rejected", `${actor.name} didn't approve the ${amount} from ${nameOf(p.from)}`, "It doesn't count. Check with them and record it again if needed.");
      await this.tell(p, c, p.from, "payment_rejected", `${actor.name} didn't approve your payment of ${amount} to ${nameOf(p.to)}`, "It doesn't count. If you did pay, check with them and the admins.");
    } else await this.tell(p, c, p.from, "payment_rejected", `${actor.name} said they didn't receive your ${amount}`, "It doesn't count. Check with them and record it again if needed.");
  }

  // "They paid me" cancelled: whoever didn't cancel it (lender and/or payer)
  // hears about it; otherwise the receiver no longer needs to confirm it.
  async cancelled(p: PaymentNote, c: Context): Promise<void> {
    const { actor, nameOf } = c, amount = inrText(p.cents);
    if (!this.byAdmin(p)) {
      await this.tell(p, c, p.to, "payment_cancelled", `${actor.id === p.from ? nameOf(p.from) : actor.name} cancelled a payment of ${amount}`, "You don't need to confirm it any more.");
      return;
    }
    await this.tell(p, c, p.to, "payment_cancelled", actor.id === p.from ? `${actor.name} cancelled the ${amount} you recorded from them` : `${actor.name} cancelled the ${amount} recorded from ${nameOf(p.from)}`, "It doesn't count.");
    await this.tell(p, c, p.from, "payment_cancelled", `${actor.name} cancelled the payment of ${amount} recorded for you`, "It doesn't count.");
  }

  // Decided by an admin: recorded by its receiver ("they paid me").
  private byAdmin(p: PaymentNote): boolean {
    return needsAdminApproval({ fromMemberId: p.from, toMemberId: p.to, createdBy: p.createdBy });
  }

  // One notification, unless it would be to the person acting.
  private async tell(p: PaymentNote, { actor }: Context, to: string, kind: string, title: string, body: string): Promise<void> {
    if (to === actor.id) return;
    await this.tx.run([this.notify.stmt({ to, groupId: p.gid, kind, title, body, link: `#/g/${p.gid}/p/${to === p.from ? p.to : p.from}`, actor: actor.name })]);
  }
}
