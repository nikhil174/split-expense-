// Who hears about a payment, in what words (src/service/PaymentNotifications.ts),
// tested on its own with a fake notifier and a fake transaction.
import test from "node:test";
import assert from "node:assert/strict";
import { PaymentNotifications } from "../src/service/PaymentNotifications.ts";
import { PaymentStatus } from "../src/domain/payments.ts";

function fakes() {
  const sent = [], batches = [];
  const notify = { stmt: n => { sent.push(n); return { note: n }; } };
  const tx = { run: async stmts => { batches.push(stmts.length); } };
  return { notes: new PaymentNotifications(notify, tx), sent, batches };
}
const names = { adm: "Admin", bea: "Bea", cy: "Cy" };
const ctx = actor => ({ actor: { id: actor, name: names[actor] }, nameOf: id => names[id] });
const pay = { gid: "g", from: "bea", to: "cy", cents: 12345 };

test("Bea records paying Cy: Cy is asked to confirm, nobody else", () => {
  const f = fakes();
  const stmts = f.notes.recorded({ ...pay, createdBy: "bea", status: PaymentStatus.Pending, hasProof: true }, ctx("bea"), ["adm"]);
  assert.equal(stmts.length, 1);
  assert.deepEqual(f.sent.map(n => [n.to, n.kind, n.title, n.body, n.link]),
    [["cy", "payment_pending", "Bea says they paid you ₹123.45", "They attached a screenshot. Confirm it once you've received it.", "#/g/g"]]);
});

test("Cy records that Bea paid them: the admins approve, Bea is told", () => {
  const f = fakes();
  f.notes.recorded({ ...pay, createdBy: "cy", status: PaymentStatus.Pending, hasProof: false }, ctx("cy"), ["adm"]);
  assert.deepEqual(f.sent.map(n => [n.to, n.kind, n.body]), [
    ["adm", "payment_admin_approval", "Approve it if it's right; it counts once an admin approves."],
    ["bea", "payment_recorded", "It counts once a group admin approves it."],
  ]);
});

test("an admin records a confirmed payment between others: both hear it counts", () => {
  const f = fakes();
  f.notes.recorded({ ...pay, createdBy: "adm", status: PaymentStatus.Confirmed, hasProof: false }, ctx("adm"), []);
  assert.deepEqual(f.sent.map(n => [n.to, n.kind, n.title, n.link]), [
    ["cy", "payment_recorded", "Admin recorded ₹123.45 from Bea to you", "#/g/g/p/bea"],
    ["bea", "payment_recorded", "Admin recorded your payment of ₹123.45 to Cy", "#/g/g/p/cy"],
  ]);
});

test("deciding: the other side hears it, never the person acting; each in its own write", async () => {
  const f = fakes();
  await f.notes.confirmed({ ...pay, createdBy: "bea" }, ctx("cy"));
  await f.notes.rejected({ ...pay, createdBy: "cy" }, ctx("adm"));
  await f.notes.cancelled({ ...pay, createdBy: "bea" }, ctx("bea"));
  assert.deepEqual(f.sent.map(n => [n.to, n.kind, n.title]), [
    ["bea", "payment_confirmed", "Cy confirmed your payment of ₹123.45"],
    ["cy", "payment_rejected", "Admin didn't approve the ₹123.45 from Bea"],
    ["bea", "payment_rejected", "Admin didn't approve your payment of ₹123.45 to Cy"],
    ["cy", "payment_cancelled", "Bea cancelled a payment of ₹123.45"],
  ]);
  assert.deepEqual(f.batches, [1, 1, 1, 1]);
});

test("a 'they paid me' payment cancelled by its lender: only the payer hears it", async () => {
  const f = fakes();
  await f.notes.cancelled({ ...pay, createdBy: "cy" }, ctx("cy"));
  assert.deepEqual(f.sent.map(n => [n.to, n.title, n.link]), [["bea", "Cy cancelled the payment of ₹123.45 recorded for you", "#/g/g/p/cy"]]);
});
