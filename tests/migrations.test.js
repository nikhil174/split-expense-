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
    "0007_member_pins.sql",
  ]);
  await applyMigrations(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'appx_%' ORDER BY name").all().map(r => r.name);
  assert.deepEqual(tables, ["appx_access_requests", "appx_admin_sessions", "appx_expenses", "appx_group_members", "appx_groups", "appx_invites",
    "appx_rate_limits", "appx_sessions", "appx_settings", "appx_settlements", "appx_splits"]);
  const cols = db.prepare("PRAGMA table_info(appx_settlements)").all().map(c => [c.name, c.type, c.notnull]);
  assert.deepEqual(cols, [["id", "TEXT", 0], ["group_id", "TEXT", 1], ["from_member_id", "TEXT", 1], ["to_member_id", "TEXT", 1],
    ["amount_cents", "INTEGER", 1], ["created_by", "TEXT", 1], ["created_at", "INTEGER", 1]]);
  const requestCols = db.prepare("PRAGMA table_info(appx_access_requests)").all().map(c => c.name);
  for (const c of ["group_id", "pin_hash", "pin_failures", "pin_locked_until"]) assert.ok(requestCols.includes(c), c);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'appx_%'").all().map(r => r.name);
  for (const name of ["appx_settlements_group_idx", "appx_expenses_group_created_idx", "appx_groups_unique_normalized_name", "appx_access_requests_group_name_idx"]) {
    assert.ok(indexes.includes(name), name);
  }
});

test("settlement table enforces positive integer amounts and a real group", async t => {
  const db = fresh();
  t.after(() => db.close());
  await applyMigrations(db);
  db.prepare("INSERT INTO appx_groups(id,name,created_at) VALUES('g','G',1)").run();
  const insert = db.prepare("INSERT INTO appx_settlements(id,group_id,from_member_id,to_member_id,amount_cents,created_by,created_at) VALUES(?,?,?,?,?,?,?)");
  insert.run("s1", "g", "a", "b", 100, "a", 1);
  assert.throws(() => insert.run("s2", "g", "a", "b", 0, "a", 1), /CHECK/);
  assert.throws(() => insert.run("s3", "g", "a", "b", -5, "a", 1), /CHECK/);
  assert.throws(() => insert.run("s4", "missing-group", "a", "b", 5, "a", 1), /FOREIGN KEY/);
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
  for (const f of ["0004_settlements.sql", "0005_admin_profile.sql", "0006_indexes_and_rate_limits.sql"]) {
    db.exec(await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"));
  }
});
