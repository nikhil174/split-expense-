// The rules for payments between members, in one place.
//
// A payment counts only once it is confirmed: by the person who received it,
// or, when the receiver recorded it themselves ("they paid me"), by a group
// admin. Admins may decide or cancel any pending payment; the payer and
// whoever recorded it may cancel it too.

export const PaymentStatus = { Pending: "pending", Confirmed: "confirmed", Rejected: "rejected" } as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

// Who is looking at, or acting on, a payment.
export type PaymentActor = { id: string; isAdmin: boolean };
// What the rules need to know about a payment.
export type PaymentFacts = { fromMemberId: string; toMemberId: string; createdBy: string; status?: string };

// Recorded by the receiver ("they paid me"): a group admin decides it.
export const needsAdminApproval = (p: PaymentFacts): boolean => p.createdBy === p.toMemberId;

const isPending = (p: PaymentFacts) => p.status === PaymentStatus.Pending;

// May this person confirm or reject it (as shown in the group's list)?
export function canDecide(p: PaymentFacts, actor: PaymentActor): boolean {
  return isPending(p) && (needsAdminApproval(p) ? actor.isAdmin : actor.isAdmin || p.toMemberId === actor.id);
}

// May this person cancel it (as shown in the group's list)?
export function canCancel(p: PaymentFacts, actor: PaymentActor): boolean {
  return isPending(p) && mayCancel(p, actor);
}

export function mayCancel(p: PaymentFacts, actor: PaymentActor): boolean {
  return actor.isAdmin || p.fromMemberId === actor.id || p.createdBy === actor.id;
}

// Why this person may not confirm or reject it, or null when they may.
export function decisionRefusal(p: PaymentFacts, actor: PaymentActor): string | null {
  if (needsAdminApproval(p) && !actor.isAdmin) return "A group admin approves this payment.";
  if (!actor.isAdmin && p.toMemberId !== actor.id) return "Only the person who received this payment can confirm or reject it.";
  return null;
}

// Is it in this person's "to confirm" list on Home? Admins see "they paid
// me" payments recorded by someone else; everyone sees payments to them.
export function awaitsDecisionBy(p: PaymentFacts, actor: PaymentActor): boolean {
  return needsAdminApproval(p) ? actor.isAdmin && p.createdBy !== actor.id : p.toMemberId === actor.id;
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
