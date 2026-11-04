// Photos on an expense (a receipt, a bill, proof): attached when adding or
// editing it, seen by everyone in the group, and gone with the expense.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup } from "./helpers/d1.js";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG = "data:image/png;base64," + PNG_B64;
// JPEG bytes (FF D8 FF) that claim to be a PNG.
const FAKE = "data:image/png;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).toString("base64");
const JPEG = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]).toString("base64");

async function world(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  const G = `/api/groups/${g.groupId}`, { ids } = g;
  const post = (who, path, body = {}) => call(env, G + path, { method: "POST", cookie: g.cookies[who], body });
  const expenses = async (who = "Cy") => (await call(env, G + "/expenses", { cookie: g.cookies[who] })).data.expenses;
  const photo = (who, eid, pid, groupPath = G) => call(env, `${groupPath}/expenses/${eid}/photos/${pid}`, { cookie: who && g.cookies[who], raw: true });
  const dinner = (extra = {}) => ({ description: "Dinner", amount: "90", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy], ...extra });
  const rows = () => raw.prepare("SELECT COUNT(*) AS n FROM appx_expense_photos").get().n;
  return { raw, env, g, G, ids, post, expenses, photo, dinner, rows };
}

test("photos added with an expense: everyone in the group sees them; nobody else can", async t => {
  const w = await world(t);
  const r = await w.post("Bea", "/expenses", w.dinner({ photos: [PNG, JPEG] }));
  assert.equal(r.status, 201);
  const [e] = await w.expenses("Cy");
  assert.equal(e.photoIds.length, 2, "listed by id, without the images");
  // Cy (in the split) opens the receipt: the real bytes, as an image.
  const img = await w.photo("Cy", e.id, e.photoIds[0]);
  assert.equal(img.status, 200);
  assert.equal(img.response.headers.get("content-type"), "image/png");
  assert.equal(img.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(Buffer.from(await img.response.arrayBuffer()).toString("base64"), PNG_B64);
  assert.equal((await w.photo("Cy", e.id, e.photoIds[1])).response.headers.get("content-type"), "image/jpeg");
  // Not signed in, a wrong expense, or someone from another group: not found.
  assert.equal((await w.photo(null, e.id, e.photoIds[0])).status, 401);
  assert.equal((await w.photo("Cy", "other-expense", e.photoIds[0])).status, 404);
  assert.equal((await w.photo("Cy", e.id, "nope")).status, 404);
  const other = await setupGroup(w.env, "Other", ["Zed"]);
  const zed = await call(w.env, `/api/groups/${other.groupId}/expenses/${e.id}/photos/${e.photoIds[0]}`, { cookie: other.cookies.Zed, raw: true });
  assert.equal(zed.status, 404);
  // The history notes how many photos it had.
  const history = (await call(w.env, w.G + "/history?expense=" + e.id, { cookie: w.g.cookies.Bea })).data.history;
  assert.equal(history[0].after.photos, 2);
  // Without photos, nothing changes (no photos key in the history).
  await w.post("Bea", "/expenses", w.dinner({ description: "Cab" }));
  const cab = (await w.expenses()).find(x => x.description === "Cab");
  assert.deepEqual(cab.photoIds, []);
});

test("only real images, at most three; a refused request stores nothing", async t => {
  const w = await world(t);
  const cases = [
    [{ photos: "not-a-list" }, "Photos must be a list of images."],
    [{ photos: ["hello"] }, "Upload the photo as a PNG, JPEG or WebP image."],
    [{ photos: [FAKE] }, "That file is not a valid PNG, JPEG or WebP image."],
    [{ photos: [PNG, PNG, PNG, PNG] }, "Attach at most 3 photos to an expense."],
    [{ photos: ["data:image/png;base64," + Buffer.concat([Buffer.from(PNG_B64, "base64"), Buffer.alloc(320 * 1024)]).toString("base64")] }, "That photo is too large (max 300 KB)."],
  ];
  for (const [extra, error] of cases) {
    const r = await w.post("Bea", "/expenses", w.dinner(extra));
    assert.deepEqual([r.status, r.data.error], [400, error], JSON.stringify(extra).slice(0, 60));
  }
  assert.equal(w.raw.prepare("SELECT COUNT(*) AS n FROM appx_expenses").get().n, 0);
  assert.equal(w.rows(), 0);
  // Three is fine.
  assert.equal((await w.post("Bea", "/expenses", w.dinner({ photos: [PNG, PNG, PNG] }))).status, 201);
  assert.equal(w.rows(), 3);
});

test("editing: take photos off and add new ones, never more than three; other edits keep them", async t => {
  const w = await world(t);
  await w.post("Bea", "/expenses", w.dinner({ photos: [PNG, JPEG] }));
  const [e] = await w.expenses();
  const edit = body => w.post("Bea", `/expenses/${e.id}/edit`, w.dinner(body));
  // A plain edit (as the app sends when photos don't change) keeps them.
  assert.equal((await edit({ amount: "100" })).status, 200);
  assert.deepEqual((await w.expenses())[0].photoIds, e.photoIds);
  // Take the PNG off, add two: three now.
  assert.equal((await edit({ removePhotoIds: [e.photoIds[0]], photos: [PNG, PNG] })).status, 200);
  const after = (await w.expenses())[0].photoIds;
  assert.equal(after.length, 3);
  assert.ok(!after.includes(e.photoIds[0]) && after.includes(e.photoIds[1]));
  assert.equal((await w.photo("Cy", e.id, e.photoIds[0])).status, 404, "the removed photo is gone");
  // One more would be four.
  const four = await edit({ photos: [PNG] });
  assert.deepEqual([four.status, four.data.error], [400, "Attach at most 3 photos to an expense."]);
  // Only this expense's photos can be taken off.
  const wrong = await edit({ removePhotoIds: ["someone-elses"] });
  assert.deepEqual([wrong.status, wrong.data.error], [400, "That photo isn't on this expense."]);
  assert.equal((await edit({ removePhotoIds: "x" })).status, 400);
  assert.equal(w.rows(), 3, "refused edits changed nothing");
  // The history shows the count before and after.
  const history = (await call(w.env, w.G + "/history?expense=" + e.id, { cookie: w.g.cookies.Bea })).data.history;
  const changed = history.find(h => h.after?.photos === 3);
  assert.equal(changed.before.photos, 2);
  // Only the payer or an admin edits it (photos included).
  assert.equal((await w.post("Cy", `/expenses/${e.id}/edit`, w.dinner({ photos: [PNG] }))).status, 403);
});

test("photos go with their expense, and with the group", async t => {
  const w = await world(t);
  await w.post("Bea", "/expenses", w.dinner({ photos: [PNG, PNG] }));
  await w.post("Bea", "/expenses", w.dinner({ description: "Cab", photos: [JPEG] }));
  const dinner = (await w.expenses()).find(x => x.description === "Dinner");
  assert.equal((await w.post("Bea", `/expenses/${dinner.id}/delete`)).status, 200);
  assert.equal(w.rows(), 1);
  const history = (await call(w.env, w.G + "/history?expense=" + dinner.id, { cookie: w.g.cookies.Bea })).data.history;
  assert.equal(history[0].before.photos, 2, "the history says it had photos");
  assert.equal((await call(w.env, w.G + "/delete", { method: "POST", cookie: w.g.adminCookie, body: {} })).status, 200);
  assert.equal(w.rows(), 0);
});
