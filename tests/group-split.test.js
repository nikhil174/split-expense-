import test from "node:test";
import assert from "node:assert/strict";
import { allocateEqualSplit, membersInGroup, expensesInGroup } from "../src/split-logic.js";
const users = Array.from({ length: 10 }, (_, i) => ({ id: `user-${i + 1}`, name: `User ${i + 1}` }));
const groupMembers = [...users.map(user => ({ ...user, groupId: "group-a" })), ...users.map(user => ({ ...user, groupId: "group-b" }))];
test("two groups can share the same ten users without sharing group scope", () => {
  assert.equal(membersInGroup(groupMembers, "group-a").length, 10);
  assert.equal(membersInGroup(groupMembers, "group-b").length, 10);
  assert.deepEqual(membersInGroup(groupMembers, "group-a").map(user => user.id), users.map(user => user.id));
  assert.deepEqual(membersInGroup(groupMembers, "group-b").map(user => user.id), users.map(user => user.id));
  assert.equal(membersInGroup(groupMembers, "group-c").length, 0);
});
test("a group expense splits among its ten selected members", () => {
  const groupA = membersInGroup(groupMembers, "group-a");
  const split = allocateEqualSplit(10000, groupA.map(user => user.id));
  assert.equal(split.length, 10);
  assert.equal(split.reduce((sum, item) => sum + item.amountCents, 0), 10000);
  assert.ok(split.every(item => groupA.some(user => user.id === item.memberId)));
});
test("expenses from one group are not returned for the other group", () => {
  const expenses = [
    { id: "a1", groupId: "group-a", amountCents: 12000 },
    { id: "b1", groupId: "group-b", amountCents: 5000 },
    { id: "a2", groupId: "group-a", amountCents: 3000 }
  ];
  assert.deepEqual(expensesInGroup(expenses, "group-a").map(x => x.id), ["a1", "a2"]);
  assert.deepEqual(expensesInGroup(expenses, "group-b").map(x => x.id), ["b1"]);
});
test("equal split preserves every cent when amount does not divide evenly", () => {
  const split = allocateEqualSplit(10001, users.map(user => user.id));
  assert.equal(split.reduce((sum, item) => sum + item.amountCents, 0), 10001);
  assert.deepEqual(split.map(item => item.amountCents), [1001, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
});
test("duplicate member IDs are counted once", () => {
  assert.deepEqual(allocateEqualSplit(300, ["user-1", "user-1", "user-2"]), [
    { memberId: "user-1", amountCents: 150 }, { memberId: "user-2", amountCents: 150 }
  ]);
});
test("invalid split input is rejected", () => {
  assert.throws(() => allocateEqualSplit(-1, ["user-1"]), TypeError);
  assert.throws(() => allocateEqualSplit(100, []), TypeError);
});
