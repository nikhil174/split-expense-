// The payment rules (src/domain/payments.ts): who decides, who cancels,
// who records, and the status a payment starts with.
import test from "node:test";
import assert from "node:assert/strict";
import { awaitsDecisionBy, canCancel, canDecide, decisionRefusal, initialStatus, mayCancel, mayRecord, mayAskWaiver, mayRecordDebt, mayWaive, needsAdminApproval, PaymentKind, PaymentStatus } from "../src/domain/payments.ts";

const admin = { id: "adm", isAdmin: true }, payer = { id: "bea", isAdmin: false }, receiver = { id: "cy", isAdmin: false }, other = { id: "dee", isAdmin: false };
// Bea paid Cy, recorded by Bea (normal) or by Cy ("they paid me").
const normal = { fromMemberId: "bea", toMemberId: "cy", createdBy: "bea", status: PaymentStatus.Pending };
const theyPaidMe = { ...normal, createdBy: "cy" };

test("a payment recorded by its receiver needs an admin", () => {
  assert.equal(needsAdminApproval(normal), false);
  assert.equal(needsAdminApproval(theyPaidMe), true);
});

test("who may confirm or reject: the receiver or an admin; 'they paid me' only an admin", () => {
  assert.deepEqual([admin, payer, receiver, other].map(a => canDecide(normal, a)), [true, false, true, false]);
  assert.deepEqual([admin, payer, receiver, other].map(a => canDecide(theyPaidMe, a)), [true, false, false, false]);
  assert.equal(canDecide({ ...normal, status: PaymentStatus.Confirmed }, admin), false, "only while pending");
  assert.equal(decisionRefusal(normal, receiver), null);
  assert.equal(decisionRefusal(normal, other), "Only the person who received this payment can confirm or reject it.");
  assert.equal(decisionRefusal(theyPaidMe, receiver), "A group admin approves this payment.");
  assert.equal(decisionRefusal(theyPaidMe, admin), null);
});

test("who may cancel: the payer, whoever recorded it, or an admin", () => {
  assert.deepEqual([admin, payer, receiver, other].map(a => mayCancel(normal, a)), [true, true, false, false]);
  assert.deepEqual([admin, payer, receiver, other].map(a => mayCancel(theyPaidMe, a)), [true, true, true, false]);
  assert.equal(canCancel({ ...normal, status: PaymentStatus.Rejected }, payer), false, "only while pending");
});

test("Home's 'to confirm' list: payments to me; 'they paid me' for admins who didn't record it", () => {
  assert.deepEqual([admin, payer, receiver].map(a => awaitsDecisionBy(normal, a)), [false, false, true]);
  assert.deepEqual([admin, payer, receiver].map(a => awaitsDecisionBy(theyPaidMe, a)), [true, false, false]);
  assert.equal(awaitsDecisionBy({ ...theyPaidMe, createdBy: "adm", toMemberId: "adm" }, admin), false);
});

test("who may record: their own payment, one made to them, or anything as an admin", () => {
  assert.deepEqual([admin, payer, receiver, other].map(a => mayRecord("bea", "cy", a)), [true, true, true, false]);
  const active = id => id !== "gone";
  assert.equal(mayRecordDebt({ fromMemberId: "bea", toMemberId: "cy" }, payer, active), true);
  assert.equal(mayRecordDebt({ fromMemberId: "bea", toMemberId: "gone" }, payer, active), false, "not to someone who left");
  assert.equal(mayRecordDebt({ fromMemberId: "gone", toMemberId: "cy" }, receiver, active), true, "what was paid to me");
  assert.equal(mayRecordDebt({ fromMemberId: "bea", toMemberId: "gone" }, admin, active), true);
});

test("a new payment is confirmed only when an admin receives it or the receiver left", () => {
  assert.equal(initialStatus("cy", payer, true), PaymentStatus.Pending);
  assert.equal(initialStatus("cy", receiver, true), PaymentStatus.Pending, "they paid me waits for an admin");
  assert.equal(initialStatus("adm", admin, true), PaymentStatus.Confirmed);
  assert.equal(initialStatus("gone", admin, false), PaymentStatus.Confirmed);
  assert.equal(initialStatus("cy", admin, true), PaymentStatus.Pending, "an admin recording for others still needs the receiver");
});

// Cy lets Bea off what she owes (a waiver): recorded by Cy, the lender.
const waiver = { ...theyPaidMe, kind: PaymentKind.Waiver };

test("a waiver: only the lender asks, only an admin approves, and the debtor can't cancel it", () => {
  assert.deepEqual([admin, payer, receiver, other].map(a => mayWaive("cy", a)), [false, false, true, false], "not even an admin, for someone else's debt");
  assert.equal(needsAdminApproval(waiver), true);
  assert.deepEqual([admin, payer, receiver, other].map(a => canDecide(waiver, a)), [true, false, false, false]);
  assert.deepEqual([admin, payer, receiver, other].map(a => canCancel(waiver, a)), [true, false, true, false]);
  assert.equal(mayCancel(theyPaidMe, payer), true, "the payer can still cancel a 'they paid me' payment");
  assert.equal(decisionRefusal(waiver, receiver), "A group admin approves letting them off.");
  assert.equal(decisionRefusal(theyPaidMe, receiver), "A group admin approves this payment.");
  assert.equal(decisionRefusal(waiver, admin), null);
  assert.deepEqual([admin, payer, receiver].map(a => awaitsDecisionBy(waiver, a)), [true, false, false]);
  assert.equal(initialStatus("cy", { id: "cy", isAdmin: true }, true), PaymentStatus.Confirmed, "an admin lender's waiver counts at once");
  // Bea, the debtor, is an admin too: she still can't decide or cancel being let off.
  const adminDebtor = { id: "bea", isAdmin: true };
  assert.deepEqual([canDecide(waiver, adminDebtor), canCancel(waiver, adminDebtor), awaitsDecisionBy(waiver, adminDebtor)], [false, false, false]);
  assert.equal(decisionRefusal(waiver, adminDebtor), "Another group admin approves letting you off.");
  assert.deepEqual([canDecide(theyPaidMe, adminDebtor), canCancel(theyPaidMe, adminDebtor)], [true, true], "unchanged for payments");
});

// Bea asks Cy to let her off (a waiver Bea recorded).
const asked = { ...normal, kind: PaymentKind.Waiver };

test("asking to be let off: the lender or an admin decides; the debtor can only withdraw it", () => {
  assert.deepEqual([admin, payer, receiver, other].map(a => mayAskWaiver("bea", a)), [false, true, false, false]);
  assert.equal(needsAdminApproval(asked), false);
  assert.deepEqual([admin, payer, receiver, other].map(a => canDecide(asked, a)), [true, false, true, false]);
  assert.deepEqual([admin, payer, receiver, other].map(a => canCancel(asked, a)), [true, true, false, false]);
  assert.deepEqual([admin, payer, receiver].map(a => awaitsDecisionBy(asked, a)), [false, false, true]);
  assert.equal(decisionRefusal(asked, payer), "The person you owe, or a group admin, decides this.");
  assert.equal(decisionRefusal(asked, { id: "bea", isAdmin: true }), "The person you owe, or a group admin, decides this.", "not even as an admin");
  assert.equal(decisionRefusal(asked, other), "Only the person who is owed, or a group admin, can decide this.");
});
