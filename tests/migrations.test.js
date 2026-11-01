import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, migrationFiles } from "./helpers/d1.js";

const fresh = () => new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });

test("all migrations apply cleanly, in Wrangler order, to an empty isolated database", async t => {
  const db = fresh();
  t.after(() => db.close());
  assert.deepEqual(await migrationFiles(), [
    "0001_app_tables.sql", "0002_admin_sessions.sql", "0003_app_settings.sql", "0003_reset_app_data.sql",
    "0004_group_access_and_unique_names.sql", "0004_settlements.sql", "0005_admin_profile.sql", "0006_indexes_and_rate_limits.sql",
    "0007_member_pins.sql", "0008_unique_member_names.sql", "0009_settlement_confirmation.sql",
    "0010_payment_methods.sql", "0011_notifications.sql", "0012_payment_proofs_and_push.sql", "0013_accounts.sql", "0014_site_admin.sql", "0015_group_pins.sql", "0016_invites_and_friends.sql", "0017_email_links.sql",
    "0018_history_integrity_cleanup.sql",
  ]);
  await applyMigrations(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'appx_%' ORDER BY name").all().map(r => r.name);
  // The old sign-in's tables (access requests, sessions, admin sessions, invites) were dropped by 0018.
  assert.deepEqual(tables, ["appx_expenses", "appx_group_members", "appx_groups", "appx_notifications",
    "appx_payment_methods", "appx_payment_proofs", "appx_push_subscriptions", "appx_rate_limits", "appx_settings", "appx_settlements", "appx_splits",
    "appx_user_sessions", "appx_users"].concat("appx_group_unlocks", "appx_friendships", "appx_email_tokens", "appx_history").sort());
  const cols = db.prepare("PRAGMA table_info(appx_settlements)").all().map(c => [c.name, c.type, c.notnull]);
  assert.deepEqual(cols, [["id", "TEXT", 0], ["group_id", "TEXT", 1], ["from_member_id", "TEXT", 1], ["to_member_id", "TEXT", 1],
    ["amount_cents", "INTEGER", 1], ["created_by", "TEXT", 1], ["created_at", "INTEGER", 1],
    ["status", "TEXT", 1], ["decided_by", "TEXT", 0], ["decided_at", "INTEGER", 0]]);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'appx_%'").all().map(r => r.name);
  assert.ok(!indexes.includes("appx_groups_unique_normalized_name"), "group names no longer unique");
  for (const name of ["appx_settlements_group_idx", "appx_expenses_group_created_idx", "appx_users_username_idx", "appx_users_email_idx", "appx_history_entity_idx"]) {
    assert.ok(indexes.includes(name), name);
  }
});

// Migration numbers: 0003 and 0004 were each used twice long ago. They stay as
// they are (Wrangler remembers applied migrations by file name, so renaming one
// would run it again), but no new number may be used twice.
test("no migration number is used twice, apart from the two historical ones", async () => {
  const counts = {};
  for (const f of await migrationFiles()) { const n = f.slice(0, 4); counts[n] = (counts[n] || 0) + 1; }
  const twice = Object.keys(counts).filter(n => counts[n] > 1).sort();
  assert.deepEqual(twice, ["0003", "0004"]);
});

test("settlement table enforces positive integer amounts and a real group", async t => {
  const db = fresh();
  t.after(() => db.close());
  await applyMigrations(db);
  db.prepare("INSERT INTO appx_groups(id,name,created_at) VALUES('g','G',1)").run();
  for (const u of ["a", "b"]) db.prepare("INSERT INTO appx_users(id,username,display_name,created_at) VALUES(?,?,?,1)").run(u, u, u);
  const insert = db.prepare("INSERT INTO appx_settlements(id,group_id,from_member_id,to_member_id,amount_cents,created_by,created_at) VALUES(?,?,?,?,?,?,?)");
  insert.run("s1", "g", "a", "b", 100, "a", 1);
  assert.throws(() => insert.run("s2", "g", "a", "b", 0, "a", 1), /CHECK/);
  assert.throws(() => insert.run("s3", "g", "a", "b", -5, "a", 1), /CHECK/);
  assert.throws(() => insert.run("s4", "missing-group", "a", "b", 5, "a", 1), /FOREIGN KEY/);
  // People must have an account (0018).
  assert.throws(() => insert.run("s5", "g", "a", "ghost", 5, "a", 1), /unknown account in payment/);
});

test("person ids must belong to an account, and names follow the account (0018)", async t => {
  const db = fresh();
  t.after(() => db.close());
  await applyMigrations(db);
  db.prepare("INSERT INTO appx_groups(id,name,created_at) VALUES('g','G',1)").run();
  db.prepare("INSERT INTO appx_users(id,username,display_name,created_at) VALUES('a','a','Ann',1)").run();
  db.prepare("INSERT INTO appx_group_members(group_id,member_id,name) VALUES('g','a','Ann')").run();
  assert.throws(() => db.prepare("INSERT INTO appx_group_members(group_id,member_id,name) VALUES('g','ghost','Ghost')").run(), /unknown account in group membership/);
  assert.throws(() => db.prepare("INSERT INTO appx_expenses(id,group_id,description,amount_cents,paid_by,created_by,created_at) VALUES('e','g','X',100,'ghost','a',1)").run(), /unknown account paid for expense/);
  db.prepare("INSERT INTO appx_expenses(id,group_id,description,amount_cents,paid_by,created_by,created_at) VALUES('e','g','X',100,'a','a',1)").run();
  assert.throws(() => db.prepare("INSERT INTO appx_splits(expense_id,member_id,amount_cents) VALUES('e','ghost',100)").run(), /unknown account in split/);
  assert.throws(() => db.prepare("UPDATE appx_expenses SET paid_by='ghost' WHERE id='e'").run(), /unknown account paid for expense/);
  db.prepare("UPDATE appx_users SET display_name='Annie' WHERE id='a'").run();
  assert.equal(db.prepare("SELECT name FROM appx_group_members WHERE member_id='a'").get().name, "Annie");
});

test("the old one-time reset migration no longer deletes data if it has not run yet", async t => {
  const db = fresh();
  t.after(() => db.close());
  for (const f of ["0001_app_tables.sql", "0002_admin_sessions.sql", "0003_app_settings.sql"]) db.exec(await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"));
  db.prepare("INSERT INTO appx_groups(id,name,created_at) VALUES('g','Trip',1)").run();
  db.prepare("INSERT INTO appx_expenses(id,group_id,description,amount_cents,paid_by,created_by,created_at) VALUES('e','g','Lunch',100,'a','a',1)").run();
  db.exec(await readFile(new URL("../migrations/0003_reset_app_data.sql", import.meta.url), "utf8"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM appx_groups").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM appx_expenses").get().n, 1);
});

test("additive migrations are idempotent when re-run on an existing schema", async t => {
  const db = fresh();
  t.after(() => db.close());
  await applyMigrations(db);
  for (const f of ["0004_settlements.sql", "0005_admin_profile.sql", "0018_history_integrity_cleanup.sql"]) {
    db.exec(await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"));
  }
});
