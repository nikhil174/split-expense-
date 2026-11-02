// The payment rules (src/domain/payments.ts): who decides, who cancels,
// who records, and the status a payment starts with.
import test from "node:test";
import assert from "node:assert/strict";
import { awaitsDecisionBy, canCancel, canDecide, decisionRefusal, initialStatus, mayCancel, mayRecord, mayRecordDebt, needsAdminApproval, PaymentStatus } from "../src/domain/payments.ts";

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
