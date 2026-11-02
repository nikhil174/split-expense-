// Who hears about a waiver ("no need to pay"), in what words
// (src/service/WaiverNotifications.ts), with a fake notifier.
import test from "node:test";
import assert from "node:assert/strict";
import { WaiverNotifications } from "../src/service/WaiverNotifications.ts";

function fakes() {
  const sent = [];
  const notify = { stmt: n => { sent.push(n); return { note: n }; } };
  return { notes: new WaiverNotifications(notify), sent };
}
const names = { adm: "Admin", bea: "Bea", cy: "Cy", dee: "Dee" };
const ctx = actor => ({ actor: { id: actor, name: names[actor] }, nameOf: id => names[id] });
// Cy lets Bea off ₹123.45.
const w = { gid: "g", from: "bea", to: "cy", cents: 12345 };
const rows = f => f.sent.map(n => [n.to, n.kind, n.title, n.body, n.link]);

test("asked: the admins (not the lender, even if one) and the debtor; one statement each", () => {
  const f = fakes();
  const stmts = f.notes.requested(w, ctx("cy"), ["adm", "cy"]);
  assert.equal(stmts.length, 2);
  assert.deepEqual(rows(f), [
    ["adm", "waiver_admin_approval", "Cy wants to let Bea off ₹123.45", "Bea won't need to pay it once an admin approves.", "#/g/g"],
    ["bea", "waiver_pending", "Cy is letting you off ₹123.45", "You won't need to pay it once a group admin approves.", "#/g/g/p/cy"],
  ]);
});

test("approved by an admin: everyone active but the admin, each in their own words", () => {
  const f = fakes();
  const stmts = f.notes.approved(w, ctx("adm"), ["adm", "bea", "cy", "dee"]);
  assert.equal(stmts.length, 3);
  assert.deepEqual(rows(f), [
    ["bea", "waiver_approved", "Cy let you off ₹123.45", "You don't need to pay it. It's cleared from what you owe Cy.", "#/g/g/p/cy"],
    ["cy", "waiver_approved", "Admin approved letting Bea off ₹123.45", "It's cleared from what Bea owes you.", "#/g/g/p/bea"],
    ["dee", "waiver_approved", "Cy let Bea off ₹123.45, approved by Admin", "Bea doesn't need to pay it back.", "#/g/g"],
  ]);
});

test("an admin lender's waiver (no approval needed): the lender isn't told about their own action", () => {
  const f = fakes();
  f.notes.approved(w, ctx("cy"), ["adm", "bea", "cy"]);
  assert.deepEqual(f.sent.map(n => [n.to, n.title]), [["adm", "Cy let Bea off ₹123.45"], ["bea", "Cy let you off ₹123.45"]]);
});

test("rejected or cancelled: the lender and the debtor, never the person acting", () => {
  const f = fakes();
  f.notes.rejected(w, ctx("adm"));
  f.notes.cancelled(w, ctx("cy"));
  f.notes.cancelled(w, ctx("adm"));
  assert.deepEqual(f.sent.map(n => [n.to, n.kind, n.title, n.body]), [
    ["cy", "waiver_rejected", "Admin didn't approve letting Bea off ₹123.45", "Bea still owes it."],
    ["bea", "waiver_rejected", "Admin didn't approve Cy letting you off ₹123.45", "You still owe it."],
    ["bea", "waiver_cancelled", "Cy is no longer letting you off ₹123.45", "You still owe it."],
    ["cy", "waiver_cancelled", "Admin cancelled letting Bea off ₹123.45", "Bea still owes it."],
    ["bea", "waiver_cancelled", "Cy is no longer letting you off ₹123.45", "You still owe it."],
  ]);
  assert.ok(f.sent.every(n => n.actor && n.groupId === "g"));
});
