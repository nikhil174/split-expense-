// What people are told when a lender lets someone off what they owe (a
// waiver): who hears about it at each step, and in what words. Nobody is told
// about their own action.
import { inrText } from "../domain/money.ts";
import type { Statement } from "../repository/Transaction.ts";
import type { Actor, Notifier } from "./Notifier.ts";

// The waiver: `from` (the debtor) no longer has to pay `to` (the lender).
// createdBy says who started it: the lender (an offer) or the debtor (a request).
export type WaiverNote = { gid: string; from: string; to: string; cents: number; createdBy: string };

// Did the debtor ask to be let off (rather than the lender offering)?
const askedByDebtor = (w: WaiverNote) => w.createdBy === w.from;
type Context = { actor: Actor; nameOf: (memberId: string) => string };

export class WaiverNotifications {
  private readonly notify: Notifier;
  constructor(notify: Notifier) { this.notify = notify; }

  // The lender asked: the group's admins approve it, and the debtor hears
  // what's coming (as the debtor, even if they are an admin too).
  requested(w: WaiverNote, { actor, nameOf }: Context, adminIds: string[]): Statement[] {
    const amount = inrText(w.cents), debtor = nameOf(w.from);
    return [
      ...adminIds.filter(id => id !== actor.id && id !== w.from).map(admin => this.note(w, actor, admin, "waiver_admin_approval",
        `${actor.name} wants to let ${debtor} off ${amount}`, `${debtor} won't need to pay it once an admin approves.`, `#/g/${w.gid}`)),
      this.note(w, actor, w.from, "waiver_pending",
        `${actor.name} is letting you off ${amount}`, "You won't need to pay it once a group admin approves.", `#/g/${w.gid}/p/${w.to}`),
    ].filter(n => n !== null);
  }

  // The debtor asked to be let off: the lender decides, or a group admin
  // (never the debtor, even if they are an admin).
  asked(w: WaiverNote, { actor, nameOf }: Context, adminIds: string[]): Statement[] {
    const amount = inrText(w.cents), lender = nameOf(w.to);
    return [
      this.note(w, actor, w.to, "waiver_asked", `${actor.name} asks you to let them off ${amount}`,
        "Say yes and they won't need to pay it; everyone in the group is told. Or say no and they still owe it.", `#/g/${w.gid}`),
      ...adminIds.filter(id => id !== w.from && id !== w.to).map(admin => this.note(w, actor, admin, "waiver_asked",
        `${actor.name} asks ${lender} to let them off ${amount}`, `${lender} or a group admin decides. You're an admin, so you can too.`, `#/g/${w.gid}`)),
    ].filter(n => n !== null);
  }

  // Approved (or recorded by an admin lender, which needs no approval): the
  // whole group hears it, each in their own words.
  approved(w: WaiverNote, c: Context, activeMemberIds: string[]): Statement[] {
    const { actor, nameOf } = c, amount = inrText(w.cents), lender = nameOf(w.to), debtor = nameOf(w.from);
    const byLender = actor.id === w.to;
    // A request an admin granted for the lender: say who decided it.
    if (askedByDebtor(w) && !byLender) return activeMemberIds.map(id => {
      if (id === w.from) return this.note(w, actor, id, "waiver_approved", `${actor.name} let you off ${amount} you owed ${lender}`, `You don't need to pay it. It's cleared from what you owe ${lender}.`, `#/g/${w.gid}/p/${w.to}`);
      if (id === w.to) return this.note(w, actor, id, "waiver_approved", `${actor.name} let ${debtor} off ${amount} they owed you`, `${debtor} asked, and a group admin agreed. It's cleared from what ${debtor} owes you.`, `#/g/${w.gid}/p/${w.from}`);
      return this.note(w, actor, id, "waiver_approved", `${actor.name} let ${debtor} off ${amount} owed to ${lender}`, `${debtor} doesn't need to pay it back.`, `#/g/${w.gid}`);
    }).filter(n => n !== null);
    return activeMemberIds.map(id => {
      if (id === w.from) return this.note(w, actor, id, "waiver_approved",
        `${lender} let you off ${amount}`, `You don't need to pay it. It's cleared from what you owe ${lender}.`, `#/g/${w.gid}/p/${w.to}`);
      if (id === w.to) return this.note(w, actor, id, "waiver_approved",
        `${actor.name} approved letting ${debtor} off ${amount}`, `It's cleared from what ${debtor} owes you.`, `#/g/${w.gid}/p/${w.from}`);
      return this.note(w, actor, id, "waiver_approved",
        byLender ? `${lender} let ${debtor} off ${amount}` : `${lender} let ${debtor} off ${amount}, approved by ${actor.name}`,
        `${debtor} doesn't need to pay it back.`, `#/g/${w.gid}`);
    }).filter(n => n !== null);
  }

  // Turned down (by an admin, or by the lender when the debtor asked): the
  // lender and the debtor hear it.
  rejected(w: WaiverNote, { actor, nameOf }: Context): Statement[] {
    const amount = inrText(w.cents);
    if (askedByDebtor(w)) return [
      this.note(w, actor, w.to, "waiver_rejected", `${actor.name} said no to ${nameOf(w.from)}'s request to be let off ${amount}`, `${nameOf(w.from)} still owes it.`, `#/g/${w.gid}/p/${w.from}`),
      this.note(w, actor, w.from, "waiver_rejected", `${actor.name} said no to letting you off ${amount}`, "You still owe it.", `#/g/${w.gid}/p/${w.to}`),
    ].filter(n => n !== null);
    return [
      this.note(w, actor, w.to, "waiver_rejected", `${actor.name} didn't approve letting ${nameOf(w.from)} off ${amount}`, `${nameOf(w.from)} still owes it.`, `#/g/${w.gid}/p/${w.from}`),
      this.note(w, actor, w.from, "waiver_rejected", `${actor.name} didn't approve ${nameOf(w.to)} letting you off ${amount}`, "You still owe it.", `#/g/${w.gid}/p/${w.to}`),
    ].filter(n => n !== null);
  }

  // Withdrawn while waiting (by whoever started it, or an admin): whoever
  // else was involved hears it.
  cancelled(w: WaiverNote, { actor, nameOf }: Context): Statement[] {
    const amount = inrText(w.cents);
    if (askedByDebtor(w)) return [
      this.note(w, actor, w.to, "waiver_cancelled", actor.id === w.from ? `${actor.name} withdrew their request to be let off ${amount}` : `${actor.name} cancelled ${nameOf(w.from)}'s request to be let off ${amount}`, `${nameOf(w.from)} still owes it.`, `#/g/${w.gid}/p/${w.from}`),
      this.note(w, actor, w.from, "waiver_cancelled", `${actor.name} cancelled your request to be let off ${amount}`, "You still owe it.", `#/g/${w.gid}/p/${w.to}`),
    ].filter(n => n !== null);
    return [
      this.note(w, actor, w.to, "waiver_cancelled", `${actor.name} cancelled letting ${nameOf(w.from)} off ${amount}`, `${nameOf(w.from)} still owes it.`, `#/g/${w.gid}/p/${w.from}`),
      this.note(w, actor, w.from, "waiver_cancelled", `${actor.id === w.to ? actor.name : nameOf(w.to)} is no longer letting you off ${amount}`, "You still owe it.", `#/g/${w.gid}/p/${w.to}`),
    ].filter(n => n !== null);
  }

  // One notification, unless it would be to the person acting.
  private note(w: WaiverNote, actor: Actor, to: string, kind: string, title: string, body: string, link: string): Statement | null {
    return to === actor.id ? null : this.notify.stmt({ to, groupId: w.gid, kind, title, body, link, actor: actor.name });
  }
}
