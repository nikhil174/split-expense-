import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup } from "./helpers/d1.js";

// A real 1×1 PNG, and the same bytes claiming to be a JPEG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const png = "data:image/png;base64," + PNG;

async function fixture(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  const save = (who, body) => call(env, "/api/payment-method", { method: "POST", cookie: g.cookies[who], body });
  const mine = async who => (await call(env, "/api/payment-method", { cookie: g.cookies[who] })).data.method;
  const list = async who => (await call(env, `/api/groups/${g.groupId}/payment-methods`, { cookie: g.cookies[who] })).data.people;
  const qr = (who, mid, gid = g.groupId) => call(env, `/api/groups/${gid}/members/${mid}/qr`, { cookie: g.cookies[who], raw: true });
  return { raw, env, g, save, mine, list, qr };
}

test("set my UPI ID and QR; it is validated by format and by the image's real bytes", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.mine("Bea"), { kind: "upi", upiId: null, hasQr: false, updatedAt: null });
  for (const upiId of ["", "bea", "@okaxis", "bea@", "bea@1bank", "be a@okaxis", "bea@ok axis"]) {
    assert.equal((await f.save("Bea", { upiId })).status, 400, upiId);
  }
  const bad = [
    "data:image/jpeg;base64," + PNG,               // says JPEG, bytes are PNG
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",  // SVG is not allowed
    "data:image/png;base64,SGVsbG8gd29ybGQ=",      // not an image at all
    "https://example.com/qr.png",
  ];
  for (const q of bad) assert.equal((await f.save("Bea", { upiId: "bea@okaxis", qr: q })).status, 400, q.slice(0, 30));
  const ok = await f.save("Bea", { upiId: "bea.s@okaxis", qr: png });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.data.method.upiId, ok.data.method.hasQr], ["bea.s@okaxis", true]);
  const own = await call(f.env, "/api/payment-method/qr", { cookie: f.g.cookies.Bea, raw: true });
  assert.deepEqual([own.status, own.response.headers.get("content-type")], [200, "image/png"]);
  // Changing only the UPI ID keeps the QR; null removes it.
  await f.save("Bea", { upiId: "bea@ybl" });
  assert.deepEqual([(await f.mine("Bea")).upiId, (await f.mine("Bea")).hasQr], ["bea@ybl", true]);
  await f.save("Bea", { upiId: "bea@ybl", qr: null });
  assert.equal((await f.mine("Bea")).hasQr, false);
  // Delete removes it all.
  assert.equal((await call(f.env, "/api/payment-method/delete", { method: "POST", cookie: f.g.cookies.Bea, body: {} })).status, 200);
  assert.equal((await f.mine("Bea")).upiId, null);
  assert.equal((await call(f.env, "/api/payment-method")).status, 401);
});

test("QR uploads may be larger than other requests, but not unlimited", async t => {
  const f = await fixture(t);
  const big = "data:image/png;base64," + PNG + "A".repeat(600 * 1024);
  assert.equal((await f.save("Bea", { upiId: "bea@okaxis", qr: big })).status, 413);
  const tooBigImage = "data:image/png;base64," + Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(320 * 1024)]).toString("base64");
  const r = await f.save("Bea", { upiId: "bea@okaxis", qr: tooBigImage });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /too large/);
  // Other endpoints keep the small limit.
  const exp = await call(f.env, `/api/groups/${f.g.groupId}/expenses`, { method: "POST", cookie: f.g.cookies.Bea, body: { description: "x".repeat(20 * 1024), amount: "1" } });
  assert.equal(exp.status, 413);
});

test("everyone in the group sees how to pay each other; the QR image is served only within the group", async t => {
  const f = await fixture(t);
  await f.save("Bea", { upiId: "bea@okaxis", qr: png });
  await f.save("admin", { upiId: "nikhil@ybl" });
  const people = await f.list("Cy");
  assert.deepEqual(people.map(p => [p.name, p.upiId, p.hasQr, p.isMe]).sort(), [
    ["Alex Admin", "nikhil@ybl", false, false], ["Bea", "bea@okaxis", true, false], ["Cy", null, false, true],
  ]);
  const img = await f.qr("Cy", f.g.ids.Bea);
  assert.equal(img.status, 200);
  assert.equal(img.response.headers.get("content-type"), "image/png");
  assert.equal(img.response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await img.response.arrayBuffer()), Buffer.from(PNG, "base64"));
  assert.equal((await f.qr("Cy", f.g.ids.Cy)).status, 404, "no QR yet");
  // Someone in another group cannot see it.
  const other = await setupGroup(f.env, "Office", ["Zed"], { adminCookie: f.g.adminCookie });
  assert.equal((await call(f.env, `/api/groups/${f.g.groupId}/members/${f.g.ids.Bea}/qr`, { cookie: other.cookies.Zed, raw: true })).status, 404);
  assert.equal((await f.qr("Cy", f.g.ids.Bea, other.groupId)).status, 404);
  assert.equal((await call(f.env, `/api/groups/${f.g.groupId}/members/${f.g.ids.Bea}/qr`, { raw: true })).status, 401);
  // The admin's method follows them into every group.
  assert.equal((await call(f.env, `/api/groups/${other.groupId}/payment-methods`, { cookie: other.cookies.Zed })).data.people.find(p => p.memberId === "admin").upiId, "nikhil@ybl");
});
