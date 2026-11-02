// Golden master: the whole API, replayed (see tests/golden/), must answer
// exactly as recorded: every status, header and body, every email and phone
// notification, and the database at the end. It was recorded before the
// backend was restructured, so it proves the restructure changed nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.ts";
import { runScenario } from "./golden/harness.js";

const expected = JSON.parse(readFileSync(new URL("./golden/transcript.json", import.meta.url), "utf8"));

test("every API answer, email, push and database row matches the recording", async () => {
  const actual = await runScenario(worker);
  assert.equal(actual.transcript.length, expected.transcript.length, "same number of steps");
  // Step by step, so a failure names the first request that differs.
  for (let i = 0; i < expected.transcript.length; i++) {
    const want = expected.transcript[i];
    assert.deepStrictEqual(actual.transcript[i], want, `step ${want.n}: ${want.label}`);
  }
  for (const table of Object.keys(expected.db)) assert.deepStrictEqual(actual.db[table], expected.db[table], `table ${table}`);
  assert.deepStrictEqual(Object.keys(actual.db), Object.keys(expected.db), "same tables");
  assert.deepStrictEqual(actual.logs, expected.logs, "same log lines");
});
