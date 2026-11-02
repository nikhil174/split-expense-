// Normalizing what people type (src/domain/text.ts) and group name lookups.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanName, isEmailLogin, loginKind, normEmail, normUsername, textField } from "../src/domain/text.ts";
import { nameLookup } from "../src/domain/members.ts";

test("names are trimmed with inner spaces collapsed", () => {
  assert.equal(cleanName("  Goa   Trip \n"), "Goa Trip");
  assert.equal(cleanName(null), "");
  assert.equal(cleanName(42), "42");
});

test("usernames and emails are stored lowercase; '@vicky' means 'vicky'", () => {
  assert.equal(normUsername(" @Vicky "), "vicky");
  assert.equal(normUsername(undefined), "");
  assert.equal(normEmail(" Bea@Mail.COM "), "bea@mail.com");
});

test("a login is an email only with an @ that isn't a username prefix", () => {
  assert.equal(isEmailLogin("bea@mail.com"), true);
  assert.equal(isEmailLogin("@bea"), false);
  assert.equal(isEmailLogin("bea"), false);
  assert.deepEqual(["x@y.z", "@x", "x"].map(loginKind), ["email", "username", "username"]);
});

test("only strings count as text fields", () => {
  assert.deepEqual([textField("a"), textField(1), textField(null), textField({})], ["a", "", "", ""]);
});

test("member names by id; anyone unknown is a former member", () => {
  const nameOf = nameLookup([{ id: "a", name: "Ann" }]);
  assert.deepEqual([nameOf("a"), nameOf("zz")], ["Ann", "Former member"]);
});
