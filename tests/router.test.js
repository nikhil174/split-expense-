// The router (src/http/Router.ts): first match wins, methods must match
// unless the route takes any, and path variables come from the pattern.
import test from "node:test";
import assert from "node:assert/strict";
import { Router } from "../src/http/Router.ts";

const hit = name => (_ctx, params) => ({ name, params });

test("matches exact paths and regex paths with their variables", async () => {
  const r = new Router().get("/api/groups", hit("list")).post(/^\/api\/groups\/([\w-]+)\/rename$/, hit("rename"));
  assert.deepEqual(await r.dispatch({}, "GET", "/api/groups"), { name: "list", params: [] });
  assert.deepEqual(await r.dispatch({}, "POST", "/api/groups/g-1/rename"), { name: "rename", params: ["g-1"] });
});

test("the method must match; a wrong method or unknown path is no match (null)", async () => {
  const r = new Router().get("/api/groups", hit("list"));
  assert.equal(await r.dispatch({}, "POST", "/api/groups"), null);
  assert.equal(await r.dispatch({}, "GET", "/api/group"), null);
  assert.equal(await r.dispatch({}, "GET", "/api/groups/"), null, "exact strings are anchored");
});

test("routes are tried in order and `any` takes every method", async () => {
  const r = new Router().get(/^members\/([\w-]+)$/, hit("member")).any(/^invite-link(?:\/(reset|off))?$/, hit("link"));
  assert.deepEqual(await r.dispatch({}, "GET", "members/invite"), { name: "member", params: ["invite"] });
  assert.deepEqual(await r.dispatch({}, "PUT", "invite-link"), { name: "link", params: [undefined] });
  assert.deepEqual(await r.dispatch({}, "POST", "invite-link/off"), { name: "link", params: ["off"] });
  const first = new Router().get(/^a$/, hit("first")).get(/^a$/, hit("second"));
  assert.equal((await first.dispatch({}, "GET", "a")).name, "first");
});

test("special characters in exact paths are literal", async () => {
  const r = new Router().get("/api/a.b", hit("dot"));
  assert.equal(await r.dispatch({}, "GET", "/api/aXb"), null);
  assert.equal((await r.dispatch({}, "GET", "/api/a.b")).name, "dot");
});
