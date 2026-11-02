// The rules for payments between members, in one place.
//
// A payment counts only once it is confirmed: by the person who received it,
// or, when the receiver recorded it themselves ("they paid me"), by a group
// admin. Admins may decide or cancel any pending payment; the payer and
// whoever recorded it may cancel it too.
//
// A waiver ("let them off") is the lender saying the debtor doesn't need to
// pay. It is recorded by the lender, so like "they paid me" a group admin
// confirms it; then it clears the debt exactly as a payment would. A debtor
// who is an admin can't approve letting themselves off; another admin does.

export const PaymentStatus = { Pending: "pending", Confirmed: "confirmed", Rejected: "rejected" } as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentKind = { Payment: "payment", Waiver: "waiver" } as const;
export type PaymentKind = (typeof PaymentKind)[keyof typeof PaymentKind];

// Who is looking at, or acting on, a payment.
export type PaymentActor = { id: string; isAdmin: boolean };
// What the rules need to know about a payment.
export type PaymentFacts = { fromMemberId: string; toMemberId: string; createdBy: string; status?: string; kind?: string };

const isWaiver = (p: PaymentFacts) => p.kind === PaymentKind.Waiver;

// Recorded by the receiver ("they paid me"): a group admin decides it.
export const needsAdminApproval = (p: PaymentFacts): boolean => p.createdBy === p.toMemberId;

const isPending = (p: PaymentFacts) => p.status === PaymentStatus.Pending;

// Is this person the debtor of a waiver, who can't decide it themselves?
const isWaivedDebtor = (p: PaymentFacts, actor: PaymentActor) => isWaiver(p) && p.fromMemberId === actor.id;

// May this person confirm or reject it (as shown in the group's list)?
export function canDecide(p: PaymentFacts, actor: PaymentActor): boolean {
  return isPending(p) && decisionRefusal(p, actor) === null;
}

// May this person cancel it (as shown in the group's list)?
export function canCancel(p: PaymentFacts, actor: PaymentActor): boolean {
  return isPending(p) && mayCancel(p, actor);
}

// The debtor can't cancel a waiver (not even as an admin): it's the lender's offer.
export function mayCancel(p: PaymentFacts, actor: PaymentActor): boolean {
  if (isWaivedDebtor(p, actor)) return false;
  return actor.isAdmin || p.createdBy === actor.id || (!isWaiver(p) && p.fromMemberId === actor.id);
}

// Only the lender can let someone off what they owe them.
export const mayWaive = (to: string, actor: PaymentActor): boolean => to === actor.id;

// Why this person may not confirm or reject it, or null when they may.
export function decisionRefusal(p: PaymentFacts, actor: PaymentActor): string | null {
  if (isWaivedDebtor(p, actor)) return "Another group admin approves letting you off.";
  if (needsAdminApproval(p) && !actor.isAdmin) return isWaiver(p) ? "A group admin approves letting them off." : "A group admin approves this payment.";
  if (!actor.isAdmin && p.toMemberId !== actor.id) return "Only the person who received this payment can confirm or reject it.";
  return null;
}

// Is it in this person's "to confirm" list on Home? Admins see "they paid
// me" payments recorded by someone else; everyone sees payments to them.
export function awaitsDecisionBy(p: PaymentFacts, actor: PaymentActor): boolean {
  return needsAdminApproval(p) ? actor.isAdmin && p.createdBy !== actor.id && !isWaivedDebtor(p, actor) : p.toMemberId === actor.id;
}

// May this person record a payment from `from` to `to`? Members record
// payments they made, or ones made to them; admins record any.
export const mayRecord = (from: string, to: string, actor: PaymentActor): boolean => actor.isAdmin || from === actor.id || to === actor.id;

// May this person record a payment for this debt (the "Settle up" buttons)?
// Members pay an active member, or record what was paid to them.
export function mayRecordDebt(d: { fromMemberId: string; toMemberId: string }, actor: PaymentActor, isActive: (id: string) => boolean): boolean {
  return actor.isAdmin || (d.fromMemberId === actor.id && isActive(d.toMemberId)) || d.toMemberId === actor.id;
}

// The status a newly recorded payment starts with: confirmed when an admin
// records money they received, or a payment to someone who left (who can't
// confirm it any more); otherwise waiting for confirmation.
export function initialStatus(to: string, actor: PaymentActor, receiverActive: boolean): PaymentStatus {
  const byReceiver = to === actor.id;
  return (byReceiver && actor.isAdmin) || (actor.isAdmin && !receiverActive) ? PaymentStatus.Confirmed : PaymentStatus.Pending;
}
