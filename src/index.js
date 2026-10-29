import { allocateEqualSplit, allocateManualSplit } from "./split-logic.js";
import { parseAmountToCents } from "./money.js";
import { computeBalances, computePairwiseDebts, debtsForMember, pairwiseActivity, validateSettlement, SettlementError } from "./settlement-logic.js";

const SESSION_MS = 3 * 60 * 60 * 1000;
const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SPLIT_MEMBERS = 100;
const MINUTE = 60 * 1000;
const RATE_LIMITS = {
  adminLogin: { limit: 10, windowMs: 15 * MINUTE },
  adminLoginGlobal: { limit: 50, windowMs: 60 * MINUTE },
  signin: { limit: 20, windowMs: 15 * MINUTE },
  accessRequest: { limit: 10, windowMs: 60 * MINUTE },
  expenseWrite: { limit: 60, windowMs: 10 * MINUTE },
  settlementWrite: { limit: 30, windowMs: 10 * MINUTE },
};
// A member who may be chosen for new expenses and payments: the admin, or a
// member whose access request in this group is approved (even if their 3-hour
// window lapsed) or pending re-approval. Revoked/rejected/deleted members keep
// their appx_group_members row so history still shows their name, but they are
// not active. Expects the appx_group_members row to be aliased as `m`.
const ACTIVE_MEMBER_SQL = "(m.member_id='admin' OR EXISTS (SELECT 1 FROM appx_access_requests a WHERE a.id=m.member_id AND a.group_id=m.group_id AND a.status IN ('approved','pending')))";
const FORMER_MEMBER = "Former member";

class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const fail = (message, status = 400) => json({ error: message }, status);
const id = () => crypto.randomUUID();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const rupees = cents => cents / 100;
const cleanName = value => String(value ?? "").trim().replace(/\s+/g, " ");
const textField = value => typeof value === "string" ? value : "";
async function hash(s) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
function cookie(req, name) { const c = req.headers.get("Cookie") || ""; const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : ""; }
function setCookie(name, value, maxAge) { return name + "=" + encodeURIComponent(value) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge; }
const changesOf = result => Number(result?.meta?.changes ?? result?.changes ?? 0);

async function secretEquals(given, expected) {
  const [a, b] = await Promise.all([hash("cmp:" + given), hash("cmp:" + expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function body(req) {
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) throw new HttpError("Request body is too large.", 413);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new HttpError("Request body is too large.", 413);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Fixed-window counter in D1. Returns true when the caller is over the limit.
// Fails open (logged) if the table is missing so a skipped migration does not
// lock everyone out; apply migration 0006 to enable it.
async function rateLimited(db, scope, key, { limit, windowMs }) {
  const now = Date.now(), windowStart = now - (now % windowMs);
  try {
    const row = await db.prepare("INSERT INTO appx_rate_limits(bucket,window_start,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN appx_rate_limits.window_start=excluded.window_start THEN appx_rate_limits.count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count").bind(scope + ":" + key, windowStart).first();
    return Number(row?.count) > limit;
  } catch (error) {
    console.error("Rate limiting unavailable:", String(error));
    return false;
  }
}
async function clientKey(req) { return (await hash("ip:" + (req.headers.get("CF-Connecting-IP") || "unknown"))).slice(0, 32); }
const tooMany = () => fail("Too many attempts. Please wait a few minutes and try again.", 429);

async function session(req, env) {
  const db = env['split-expense'];
  const raw = cookie(req, "split_session");
  if (!raw) return null;
  const tokenHash = await hash(raw);
  const s = await db.prepare("SELECT s.request_id,s.expires_at,r.display_name,r.status,r.expires_at AS access_expires FROM appx_sessions s JOIN appx_access_requests r ON r.id=s.request_id WHERE s.token_hash=?").bind(tokenHash).first();
  if (!s || s.expires_at < Date.now() || s.access_expires < Date.now() || s.status !== "approved") {
    await db.prepare("DELETE FROM appx_sessions WHERE token_hash=?").bind(tokenHash).run();
    return null;
  }
  return { id: s.request_id, name: s.display_name, role: "member" };
}
async function admin(req, env) {
  const raw = cookie(req, "split_admin");
  if (!raw || !env.SESSION_SECRET) return false;
  const h = await hash(raw + env.SESSION_SECRET);
  const row = await env['split-expense'].prepare("SELECT expires_at FROM appx_admin_sessions WHERE token_hash=?").bind(h).first();
  return !!row && row.expires_at > Date.now();
}
async function requireUser(req, env) {
  const u = await session(req, env);
  if (u) return u;
  if (await admin(req, env)) {
    const r = await env['split-expense'].prepare("SELECT setting_value AS name FROM appx_settings WHERE setting_key='admin_name'").first();
    if (r?.name) return { id: "admin", name: r.name, role: "admin" };
  }
  return null;
}

// Every member row ever added to the group (including revoked/removed members,
// whose names are kept for history), with whether they are currently active.
async function groupMembers(db, gid) {
  const r = await db.prepare("SELECT m.member_id AS id,m.name,CASE WHEN m.member_id='admin' THEN 'admin' ELSE COALESCE(r.status,'removed') END AS status," + ACTIVE_MEMBER_SQL + " AS active FROM appx_group_members m LEFT JOIN appx_access_requests r ON r.id=m.member_id AND r.group_id=m.group_id WHERE m.group_id=? ORDER BY lower(m.name)").bind(gid).all();
  return r.results.map(x => ({ id: x.id, name: x.name, status: x.status, active: !!x.active }));
}
function nameLookup(members) {
  const names = new Map(members.map(m => [m.id, m.name]));
  return memberId => names.get(memberId) || FORMER_MEMBER;
}

// Aggregated, group-scoped ledger used for both balances and pairwise debts so
// the two views can never disagree.
async function loadLedger(db, gid) {
  const [paid, splits, settlements] = await Promise.all([
    db.prepare("SELECT paid_by AS memberId,SUM(amount_cents) AS amountCents FROM appx_expenses WHERE group_id=? GROUP BY paid_by").bind(gid).all(),
    db.prepare("SELECT e.paid_by AS payerId,s.member_id AS memberId,SUM(s.amount_cents) AS amountCents FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=? GROUP BY e.paid_by,s.member_id").bind(gid).all(),
    db.prepare("SELECT from_member_id AS fromMemberId,to_member_id AS toMemberId,SUM(amount_cents) AS amountCents FROM appx_settlements WHERE group_id=? GROUP BY from_member_id,to_member_id").bind(gid).all(),
  ]);
  const ints = rows => rows.map(r => ({ ...r, amountCents: Number(r.amountCents) }));
  return { paidTotals: ints(paid.results), splitEdges: ints(splits.results), settlements: ints(settlements.results) };
}
function describeDebt(debt, nameOf) {
  return { fromMemberId: debt.fromMemberId, fromName: nameOf(debt.fromMemberId), toMemberId: debt.toMemberId, toName: nameOf(debt.toMemberId), amountCents: debt.amountCents, amount: rupees(debt.amountCents) };
}

async function api(req, env, url) {
  const db = env['split-expense'];
  const p = url.pathname, method = req.method;
  if (method === "GET" && p === "/api/groups/public") {
    const r = await db.prepare("SELECT id,name FROM appx_groups ORDER BY lower(name) LIMIT 200").all();
    return json({ groups: r.results });
  }
  if (method === "POST" && p === "/api/access/request") {
    if (await rateLimited(db, "access-request", await clientKey(req), RATE_LIMITS.accessRequest)) return tooMany();
    const b = await body(req);
    const name = cleanName(b?.name);
    const groupId = textField(b?.groupId);
    if (name.length < 2 || name.length > 60) return fail("Enter a name between 2 and 60 characters.");
    const g = await db.prepare("SELECT id FROM appx_groups WHERE id=?").bind(groupId).first();
    if (!g) return fail("Choose an existing group before requesting access.");
    const existing = await db.prepare("SELECT id,status,expires_at FROM appx_access_requests WHERE group_id=? AND lower(display_name)=lower(?) ORDER BY requested_at DESC LIMIT 1").bind(groupId, name).first();
    const now = Date.now();
    if (existing) {
      if (existing.status === "pending") return fail("An access request is already waiting for admin approval.", 409);
      if (existing.status === "approved" && existing.expires_at && existing.expires_at > now) return fail("This name already has active access in this group.", 409);
      await db.batch([
        db.prepare("UPDATE appx_access_requests SET status='pending',requested_at=?,approved_at=NULL,expires_at=NULL WHERE id=?").bind(now, existing.id),
        db.prepare("DELETE FROM appx_sessions WHERE request_id=?").bind(existing.id),
      ]);
      return json({ ok: true, requestId: existing.id, message: "Access request sent again using your existing membership entry." }, 200);
    }
    const requestId = id();
    await db.prepare("INSERT INTO appx_access_requests(id,display_name,status,requested_at,group_id) VALUES(?,?,'pending',?,?)").bind(requestId, name, now, groupId).run();
    return json({ ok: true, requestId, message: "Group access request submitted." }, 201);
  }
  if (method === "POST" && p === "/api/admin/login") {
    if (!env.ADMIN_PIN || !env.SESSION_SECRET) return fail("Admin secrets are not configured.", 503);
    if (await rateLimited(db, "admin-login", await clientKey(req), RATE_LIMITS.adminLogin)
      || await rateLimited(db, "admin-login", "global", RATE_LIMITS.adminLoginGlobal)) return tooMany();
    const b = await body(req);
    const name = cleanName(b?.name);
    if (name.length < 2 || name.length > 60) return fail("Enter your admin name.", 400);
    if (!await secretEquals(textField(b?.pin), String(env.ADMIN_PIN))) return fail("Incorrect admin PIN.", 401);
    let profile = await db.prepare("SELECT setting_value AS name FROM appx_settings WHERE setting_key='admin_name'").first();
    if (!profile) {
      await db.prepare("INSERT INTO appx_settings(setting_key,setting_value) VALUES('admin_name',?)").bind(name).run();
      profile = { name };
    } else if (String(profile.name).trim().toLowerCase() !== name.toLowerCase()) {
      return fail("Admin name does not match the saved administrator name.", 401);
    }
    const token = id() + id(), h = await hash(token + env.SESSION_SECRET), expires = Date.now() + SESSION_MS;
    await db.batch([
      db.prepare("DELETE FROM appx_admin_sessions"),
      db.prepare("INSERT INTO appx_admin_sessions(token_hash,expires_at) VALUES(?,?)").bind(h, expires),
      db.prepare("INSERT OR IGNORE INTO appx_group_members(group_id,member_id,name) SELECT id,'admin',? FROM appx_groups").bind(profile.name),
    ]);
    try { await db.prepare("DELETE FROM appx_rate_limits WHERE window_start<?").bind(Date.now() - 24 * 60 * MINUTE).run(); } catch {}
    return json({ ok: true, name: profile.name }, 200, { "set-cookie": setCookie("split_admin", token, SESSION_MS / 1000) });
  }
  if (p.startsWith("/api/admin/")) {
    if (!await admin(req, env)) return fail("Admin login required.", 401);
    if (method === "GET" && p === "/api/admin/requests") {
      const r = await db.prepare("SELECT a.id,a.display_name AS name,a.status,a.requested_at AS requestedAt,a.expires_at AS expiresAt,a.group_id AS groupId,g.name AS groupName FROM appx_access_requests a LEFT JOIN appx_groups g ON g.id=a.group_id ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,a.requested_at DESC LIMIT 200").all();
      return json({ requests: r.results });
    }
    if (method === "GET" && p === "/api/admin/dashboard") {
      const [groups, members, pending, expenses, spent] = await Promise.all([
        db.prepare("SELECT COUNT(*) AS n FROM appx_groups").first(),
        db.prepare("SELECT COUNT(*) AS n FROM appx_group_members m WHERE " + ACTIVE_MEMBER_SQL).first(),
        db.prepare("SELECT COUNT(*) AS n FROM appx_access_requests WHERE status='pending'").first(),
        db.prepare("SELECT COUNT(*) AS n FROM appx_expenses").first(),
        db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM appx_expenses").first(),
      ]);
      const recent = await db.prepare("SELECT e.description,e.amount_cents AS amountCents,e.created_at AS createdAt,g.name AS groupName,COALESCE(m.name,'" + FORMER_MEMBER + "') AS paidBy FROM appx_expenses e JOIN appx_groups g ON g.id=e.group_id LEFT JOIN appx_group_members m ON m.group_id=e.group_id AND m.member_id=e.paid_by ORDER BY e.created_at DESC LIMIT 5").all();
      return json({ stats: { groups: groups.n, members: members.n, pending: pending.n, expenses: expenses.n, totalSpentCents: spent.cents, totalSpent: rupees(spent.cents) }, recent: recent.results.map(x => ({ ...x, amount: rupees(x.amountCents) })) });
    }
    if (method === "GET" && p === "/api/admin/expenses") {
      const r = await db.prepare("SELECT e.id,e.description,e.amount_cents AS amountCents,e.created_at AS createdAt,g.id AS groupId,g.name AS groupName,COALESCE(m.name,'" + FORMER_MEMBER + "') AS paidBy FROM appx_expenses e JOIN appx_groups g ON g.id=e.group_id LEFT JOIN appx_group_members m ON m.group_id=e.group_id AND m.member_id=e.paid_by ORDER BY e.created_at DESC LIMIT 500").all();
      return json({ expenses: r.results.map(x => ({ ...x, amount: rupees(x.amountCents) })) });
    }
    if (method === "GET" && p === "/api/admin/groups") {
      const r = await db.prepare("SELECT g.id,g.name,g.created_at AS createdAt,(SELECT COUNT(*) FROM appx_group_members m WHERE m.group_id=g.id AND " + ACTIVE_MEMBER_SQL + ") AS memberCount FROM appx_groups g ORDER BY lower(g.name)").all();
      return json({ groups: r.results });
    }
    const deleteGroup = p.match(/^\/api\/admin\/groups\/([\w-]+)\/delete$/);
    if (method === "POST" && deleteGroup) {
      const gid = deleteGroup[1];
      const g = await db.prepare("SELECT id,name FROM appx_groups WHERE id=?").bind(gid).first();
      if (!g) return fail("Group not found.", 404);
      // Children first: D1 enforces foreign keys, so settlements and access
      // requests (and their sessions) must go before the group row.
      await db.batch([
        db.prepare("DELETE FROM appx_settlements WHERE group_id=?").bind(gid),
        db.prepare("DELETE FROM appx_splits WHERE expense_id IN (SELECT id FROM appx_expenses WHERE group_id=?)").bind(gid),
        db.prepare("DELETE FROM appx_expenses WHERE group_id=?").bind(gid),
        db.prepare("DELETE FROM appx_invites WHERE group_id=?").bind(gid),
        db.prepare("DELETE FROM appx_group_members WHERE group_id=?").bind(gid),
        db.prepare("DELETE FROM appx_sessions WHERE request_id IN (SELECT id FROM appx_access_requests WHERE group_id=?)").bind(gid),
        db.prepare("DELETE FROM appx_access_requests WHERE group_id=?").bind(gid),
        db.prepare("DELETE FROM appx_groups WHERE id=?").bind(gid),
      ]);
      return json({ ok: true, deletedGroup: g.name });
    }
    if (method === "POST" && p === "/api/admin/groups") {
      const b = await body(req), name = cleanName(b?.name);
      if (name.length < 2 || name.length > 80) return fail("Group name must be 2–80 characters.");
      const profile = await db.prepare("SELECT setting_value AS name FROM appx_settings WHERE setting_key='admin_name'").first();
      if (!profile?.name) return fail("Set the administrator name by signing in first.", 409);
      const gid = id();
      try {
        await db.batch([
          db.prepare("INSERT INTO appx_groups(id,name,created_at) VALUES(?,?,?)").bind(gid, name, Date.now()),
          db.prepare("INSERT INTO appx_group_members(group_id,member_id,name) VALUES(?,?,?)").bind(gid, "admin", profile.name),
        ]);
      } catch (e) {
        if (String(e).toLowerCase().includes("unique")) return fail("That group name already exists. Choose a unique name.", 409);
        throw e;
      }
      return json({ group: { id: gid, name } }, 201);
    }
    const m = p.match(/^\/api\/admin\/requests\/([\w-]+)\/(approve|reject|revoke)$/);
    if (method === "POST" && m) {
      const [, rid, action] = m;
      const reqRow = await db.prepare("SELECT id,display_name,group_id FROM appx_access_requests WHERE id=?").bind(rid).first();
      if (!reqRow) return fail("Request not found.", 404);
      if (action === "approve") {
        if (!reqRow.group_id) return fail("This request is not linked to a group.", 409);
        await db.batch([
          db.prepare("UPDATE appx_access_requests SET status='approved',approved_at=?,expires_at=? WHERE id=?").bind(Date.now(), Date.now() + SESSION_MS, rid),
          db.prepare("INSERT OR IGNORE INTO appx_group_members(group_id,member_id,name) VALUES(?,?,?)").bind(reqRow.group_id, rid, reqRow.display_name),
        ]);
      } else {
        await db.batch([
          db.prepare("UPDATE appx_access_requests SET status=?,expires_at=NULL WHERE id=?").bind(action === "reject" ? "rejected" : "revoked", rid),
          db.prepare("DELETE FROM appx_sessions WHERE request_id=?").bind(rid),
        ]);
      }
      return json({ ok: true });
    }
    // Deleting a revoked member removes their access record and sessions only.
    // Their appx_group_members row is kept so historical expenses, splits and
    // settlements still resolve to a name and group balances stay zero-sum.
    const deleteRequest = p.match(/^\/api\/admin\/requests\/([\w-]+)\/delete$/);
    if (method === "POST" && deleteRequest) {
      const rid = deleteRequest[1];
      const r = await db.prepare("SELECT id,group_id,status FROM appx_access_requests WHERE id=?").bind(rid).first();
      if (!r) return fail("Member request not found.", 404);
      if (r.status !== "revoked") return fail("Only revoked members can be deleted.", 409);
      await db.batch([
        db.prepare("DELETE FROM appx_sessions WHERE request_id=?").bind(rid),
        db.prepare("DELETE FROM appx_access_requests WHERE id=?").bind(rid),
      ]);
      return json({ ok: true, deleted: true });
    }
    const removeMember = p.match(/^\/api\/admin\/requests\/([\w-]+)\/remove$/);
    if (method === "POST" && removeMember) {
      const rid = removeMember[1];
      const r = await db.prepare("SELECT id,group_id,status FROM appx_access_requests WHERE id=?").bind(rid).first();
      if (!r) return fail("Member request not found.", 404);
      if (r.status !== "approved" && r.status !== "revoked") return fail("Only approved or revoked members can be removed from a group.", 409);
      await db.batch([
        db.prepare("UPDATE appx_access_requests SET status='revoked',expires_at=NULL WHERE id=?").bind(rid),
        db.prepare("DELETE FROM appx_sessions WHERE request_id=?").bind(rid),
      ]);
      return json({ ok: true, removed: true });
    }
    if (method === "POST" && p === "/api/admin/logout") {
      await db.prepare("DELETE FROM appx_admin_sessions").run();
      return json({ ok: true }, 200, { "set-cookie": setCookie("split_admin", "", 0) });
    }
    return fail("Not found.", 404);
  }
  if (method === "GET" && p === "/api/access/status") {
    const u = await session(req, env);
    if (u) return json({ status: "approved", name: u.name });
    const rid = url.searchParams.get("requestId") || cookie(req, "split_request");
    if (rid) {
      const r = await db.prepare("SELECT status,display_name AS name FROM appx_access_requests WHERE id=?").bind(rid).first();
      if (r) return json(r);
    }
    return json({ status: "none" });
  }
  if (method === "POST" && p === "/api/access/enter") {
    if (await rateLimited(db, "signin", await clientKey(req), RATE_LIMITS.signin)) return tooMany();
    const b = await body(req), rid = textField(b?.requestId);
    const r = await db.prepare("SELECT id,status,expires_at FROM appx_access_requests WHERE id=?").bind(rid).first();
    if (!r || r.status !== "approved" || !r.expires_at || r.expires_at < Date.now()) return fail("This request is not approved or access has expired. Request approval again.", 403);
    const token = id() + id(), tokenHash = await hash(token), expires = Math.min(Date.now() + SESSION_MS, r.expires_at);
    await db.prepare("INSERT INTO appx_sessions(token_hash,request_id,expires_at) VALUES(?,?,?)").bind(tokenHash, rid, expires).run();
    return json({ ok: true }, 200, { "set-cookie": setCookie("split_session", token, Math.floor((expires - Date.now()) / 1000)) });
  }
  if (method === "POST" && p === "/api/access/signin") {
    if (await rateLimited(db, "signin", await clientKey(req), RATE_LIMITS.signin)) return tooMany();
    const b = await body(req), name = cleanName(b?.name), gid = textField(b?.groupId);
    if (name.length < 2 || name.length > 60 || !gid) return fail("Enter your name and choose a group.");
    const r = await db.prepare("SELECT id,status,expires_at FROM appx_access_requests WHERE group_id=? AND lower(display_name)=lower(?) ORDER BY requested_at DESC LIMIT 1").bind(gid, name).first();
    if (!r) return fail("No access request found for that name in this group. Request access first.", 403);
    if (r.status === "pending") return fail("Your access request is waiting for admin approval.", 403);
    if (r.status !== "approved") return fail("Your access is not currently approved. Request access again to reactivate your existing entry.", 403);
    if (!r.expires_at || r.expires_at < Date.now()) {
      const now = Date.now();
      await db.batch([
        db.prepare("UPDATE appx_access_requests SET status='pending',requested_at=?,approved_at=NULL,expires_at=NULL WHERE id=?").bind(now, r.id),
        db.prepare("DELETE FROM appx_sessions WHERE request_id=?").bind(r.id),
      ]);
      return fail("Your approval expired. We've sent a new approval request to the admin using your existing membership entry.", 403);
    }
    const token = id() + id(), tokenHash = await hash(token), expires = Math.min(Date.now() + SESSION_MS, r.expires_at);
    await db.prepare("INSERT INTO appx_sessions(token_hash,request_id,expires_at) VALUES(?,?,?)").bind(tokenHash, r.id, expires).run();
    return json({ ok: true }, 200, { "set-cookie": setCookie("split_session", token, Math.floor((expires - Date.now()) / 1000)) });
  }
  const u = await requireUser(req, env);
  if (!u) return fail("Approval and active session required.", 401);
  const isAdmin = u.role === "admin";
  if (method === "POST" && p === "/api/logout") {
    const raw = cookie(req, "split_session");
    if (raw) await db.prepare("DELETE FROM appx_sessions WHERE token_hash=?").bind(await hash(raw)).run();
    return json({ ok: true }, 200, { "set-cookie": setCookie("split_session", "", 0) });
  }
  if (method === "GET" && p === "/api/groups") {
    const r = await db.prepare("SELECT g.id,g.name,"
      + "COALESCE((SELECT SUM(amount_cents) FROM appx_expenses WHERE group_id=g.id AND paid_by=?1),0)"
      + "-COALESCE((SELECT SUM(s.amount_cents) FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=g.id AND s.member_id=?1),0)"
      + "+COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=g.id AND from_member_id=?1),0)"
      + "-COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=g.id AND to_member_id=?1),0) AS myBalanceCents "
      + "FROM appx_groups g JOIN appx_group_members m ON m.group_id=g.id WHERE m.member_id=?1 ORDER BY g.created_at DESC").bind(u.id).all();
    return json({ groups: r.results });
  }
  if (method === "POST" && p === "/api/groups") return fail("Only an administrator can create groups.", 403);
  if (method === "POST" && p === "/api/groups/join") return fail("Invite codes do not bypass group approval. Request access to the group instead.", 403);
  const gm = p.match(/^\/api\/groups\/([\w-]+)(?:\/(.*))?$/);
  if (gm) {
    const gid = gm[1], tail = gm[2] || "";
    // Every group route requires the caller to be a member of this group.
    const member = await db.prepare("SELECT 1 FROM appx_group_members m WHERE m.group_id=? AND m.member_id=? AND " + ACTIVE_MEMBER_SQL).bind(gid, u.id).first();
    if (!member) return fail("Group not found or you do not have access.", 404);
    if (method === "GET" && !tail) {
      const g = await db.prepare("SELECT id,name FROM appx_groups WHERE id=?").bind(gid).first();
      const members = (await groupMembers(db, gid)).filter(x => x.active).map(({ id, name, status }) => ({ id, name, status }));
      return json({ group: g, members, me: { id: u.id, name: u.name, isAdmin } });
    }
    if (method === "GET" && tail === "dashboard") {
      const [members, ledger, total] = await Promise.all([
        groupMembers(db, gid),
        loadLedger(db, gid),
        db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents,COUNT(*) AS count FROM appx_expenses WHERE group_id=?").bind(gid).first(),
      ]);
      const nameOf = nameLookup(members);
      const paid = new Map(), share = new Map();
      for (const row of ledger.paidTotals) paid.set(row.memberId, (paid.get(row.memberId) || 0) + row.amountCents);
      for (const row of ledger.splitEdges) share.set(row.memberId, (share.get(row.memberId) || 0) + row.amountCents);
      const ids = new Set([...members.filter(x => x.active).map(x => x.id), ...paid.keys(), ...share.keys()]);
      const spending = [...ids].map(memberId => ({ memberId, name: nameOf(memberId), paidCents: paid.get(memberId) || 0, shareCents: share.get(memberId) || 0 }))
        .map(x => ({ ...x, paid: rupees(x.paidCents), share: rupees(x.shareCents) }))
        .sort((a, b) => b.paidCents - a.paidCents || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return json({ totalSpentCents: total.cents, totalSpent: rupees(total.cents), expenseCount: total.count, spending });
    }
    if (method === "POST" && tail === "members") return fail("Members must request access and be approved by an administrator.", 403);
    if (method === "POST" && tail === "invites") {
      const code = id() + id(), ch = await hash(code);
      await db.prepare("INSERT INTO appx_invites(code_hash,group_id,expires_at,created_by) VALUES(?,?,?,?)").bind(ch, gid, Date.now() + INVITE_MS, u.id).run();
      return json({ inviteCode: code, expiresAt: Date.now() + INVITE_MS });
    }
    if (method === "POST" && tail === "expenses") {
      if (await rateLimited(db, "expense", u.id, RATE_LIMITS.expenseWrite)) return tooMany();
      const b = await body(req);
      const desc = cleanName(b?.description);
      if (!desc || desc.length > 160) return fail("Enter a description of up to 160 characters.");
      let cents;
      try { cents = parseAmountToCents(b?.amount); } catch (error) { return fail(error.message); }
      const paidBy = textField(b?.paidBy);
      const active = new Set((await groupMembers(db, gid)).filter(x => x.active).map(x => x.id));
      if (!active.has(paidBy)) return fail("Payer must be an active member of this group.");
      const splitMode = b?.splitMode ?? "equal";
      let splitRows;
      if (splitMode === "manual") {
        if (!Array.isArray(b?.allocations) || b.allocations.length === 0) return fail("Enter at least one manual amount.");
        if (b.allocations.length > MAX_SPLIT_MEMBERS) return fail("Too many split members.");
        try {
          const allocations = b.allocations.map(item => ({ memberId: textField(item?.memberId), amountCents: parseAmountToCents(item?.amount, { allowZero: true }) }));
          splitRows = allocateManualSplit(cents, allocations, [...active]);
        } catch (error) { return fail(error.message); }
      } else if (splitMode === "equal") {
        if (!Array.isArray(b?.memberIds) || b.memberIds.length > MAX_SPLIT_MEMBERS) return fail("Select at least one member to split this expense.");
        if (b.memberIds.some(x => typeof x !== "string")) return fail("Split members must belong to this group.");
        const memberIds = [...new Set(b.memberIds)];
        if (!memberIds.length) return fail("Select at least one member to split this expense.");
        if (memberIds.some(x => !active.has(x))) return fail("Split members must be active members of this group.");
        splitRows = allocateEqualSplit(cents, memberIds);
      } else {
        return fail("Split method must be equal or manual.");
      }
      // Zero shares carry no meaning; keep only real allocations.
      splitRows = splitRows.filter(row => row.amountCents > 0);
      if (splitRows.reduce((sum, row) => sum + row.amountCents, 0) !== cents) throw new Error("Split rows do not add up to the expense total");
      const eid = id();
      await db.batch([
        db.prepare("INSERT INTO appx_expenses(id,group_id,description,amount_cents,paid_by,created_by,created_at) VALUES(?,?,?,?,?,?,?)").bind(eid, gid, desc, cents, paidBy, u.id, Date.now()),
        ...splitRows.map(row => db.prepare("INSERT INTO appx_splits(expense_id,member_id,amount_cents) VALUES(?,?,?)").bind(eid, row.memberId, row.amountCents)),
      ]);
      return json({ ok: true, id: eid, amountCents: cents, splits: splitRows }, 201);
    }
    if (method === "GET" && tail === "expenses") {
      const [members, r, splits] = await Promise.all([
        groupMembers(db, gid),
        db.prepare("SELECT id,description,amount_cents AS amountCents,created_at AS createdAt,paid_by AS paidBy,created_by AS createdBy FROM appx_expenses WHERE group_id=? ORDER BY created_at DESC LIMIT 300").bind(gid).all(),
        db.prepare("SELECT s.expense_id AS expenseId,s.member_id AS memberId,s.amount_cents AS amountCents FROM appx_splits s WHERE s.expense_id IN (SELECT id FROM appx_expenses WHERE group_id=? ORDER BY created_at DESC LIMIT 300)").bind(gid).all(),
      ]);
      const nameOf = nameLookup(members);
      const byExpense = new Map();
      for (const row of splits.results) {
        if (!byExpense.has(row.expenseId)) byExpense.set(row.expenseId, []);
        byExpense.get(row.expenseId).push({ memberId: row.memberId, name: nameOf(row.memberId), amountCents: row.amountCents });
      }
      const expenses = r.results.map(x => {
        const rows = (byExpense.get(x.id) || []).sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name));
        const myShareCents = rows.find(row => row.memberId === u.id)?.amountCents || 0;
        // Positive: others owe me on this expense ("you lent"); negative: I owe the payer ("you borrowed").
        const myEffectCents = x.paidBy === u.id ? x.amountCents - myShareCents : -myShareCents;
        return { ...x, amount: rupees(x.amountCents), paidByName: nameOf(x.paidBy), createdByName: nameOf(x.createdBy), splitCount: rows.length, splits: rows, myShareCents, myEffectCents, canDelete: isAdmin || x.createdBy === u.id };
      });
      return json({ expenses });
    }
    const deleteExpense = tail.match(/^expenses\/([\w-]+)\/delete$/);
    if (method === "POST" && deleteExpense) {
      if (await rateLimited(db, "expense", u.id, RATE_LIMITS.expenseWrite)) return tooMany();
      const e = await db.prepare("SELECT id,created_by FROM appx_expenses WHERE id=? AND group_id=?").bind(deleteExpense[1], gid).first();
      if (!e) return fail("Expense not found.", 404);
      if (!isAdmin && e.created_by !== u.id) return fail("Only the person who added this expense or the admin can delete it.", 403);
      await db.batch([
        db.prepare("DELETE FROM appx_splits WHERE expense_id=?").bind(e.id),
        db.prepare("DELETE FROM appx_expenses WHERE id=? AND group_id=?").bind(e.id, gid),
      ]);
      return json({ ok: true, deleted: true });
    }
    const withMember = tail.match(/^with\/([\w-]+)$/);
    if (method === "GET" && withMember) {
      const other = withMember[1];
      const members = await groupMembers(db, gid);
      const nameOf = nameLookup(members);
      if (other === u.id || !members.some(x => x.id === other)) return fail("Choose another member of this group.", 404);
      const [shares, settlements] = await Promise.all([
        db.prepare("SELECT e.id AS expenseId,e.description,e.paid_by AS paidBy,e.amount_cents AS totalCents,e.created_at AS createdAt,s.member_id AS memberId,s.amount_cents AS amountCents FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=?1 AND ((e.paid_by=?2 AND s.member_id=?3) OR (e.paid_by=?3 AND s.member_id=?2))").bind(gid, u.id, other).all(),
        db.prepare("SELECT id,from_member_id AS fromMemberId,to_member_id AS toMemberId,amount_cents AS amountCents,created_at AS createdAt FROM appx_settlements WHERE group_id=?1 AND ((from_member_id=?2 AND to_member_id=?3) OR (from_member_id=?3 AND to_member_id=?2))").bind(gid, u.id, other).all(),
      ]);
      const activity = pairwiseActivity({ shares: shares.results, settlements: settlements.results, me: u.id, other });
      const otherMember = members.find(x => x.id === other);
      return json({ me: { id: u.id, name: u.name }, other: { id: other, name: nameOf(other), active: otherMember.active }, netCents: activity.netCents, items: activity.items });
    }
    if (method === "GET" && tail === "settlements") {
      const r = await db.prepare("SELECT s.id,s.from_member_id AS fromMemberId,COALESCE(f.name,'" + FORMER_MEMBER + "') AS fromName,s.to_member_id AS toMemberId,COALESCE(t.name,'" + FORMER_MEMBER + "') AS toName,s.amount_cents AS amountCents,s.created_at AS createdAt,COALESCE(c.name,'" + FORMER_MEMBER + "') AS recordedByName FROM appx_settlements s LEFT JOIN appx_group_members f ON f.group_id=s.group_id AND f.member_id=s.from_member_id LEFT JOIN appx_group_members t ON t.group_id=s.group_id AND t.member_id=s.to_member_id LEFT JOIN appx_group_members c ON c.group_id=s.group_id AND c.member_id=s.created_by WHERE s.group_id=? ORDER BY s.created_at DESC LIMIT 200").bind(gid).all();
      return json({ settlements: r.results.map(x => ({ ...x, amount: rupees(x.amountCents) })) });
    }
    if (method === "GET" && (tail === "settlements/mine" || tail === "debts")) {
      const [members, ledger] = await Promise.all([groupMembers(db, gid), loadLedger(db, gid)]);
      const nameOf = nameLookup(members);
      const activeIds = new Set(members.filter(x => x.active).map(x => x.id));
      const debts = computePairwiseDebts(ledger);
      // Normal members may only record their own outgoing payments, to an
      // active member. The admin may record any payment (including to or from
      // a removed member, so such debts can still be cleared).
      const canRecord = d => isAdmin || (d.fromMemberId === u.id && activeIds.has(d.toMemberId));
      const describe = d => ({ ...describeDebt(d, nameOf), canRecord: canRecord(d), counterpartyActive: activeIds.has(d.fromMemberId === u.id ? d.toMemberId : d.fromMemberId) });
      if (tail === "debts") return json({ model: "direct-expense-attribution", debts: debts.map(describe) });
      const mine = debtsForMember(debts, u.id);
      return json({
        model: "direct-expense-attribution",
        memberId: u.id,
        memberName: u.name,
        isAdmin,
        youOwe: mine.youOwe.map(describe),
        owedToYou: mine.owedToYou.map(describe),
        totalYouOweCents: mine.totalYouOweCents,
        totalOwedToYouCents: mine.totalOwedToYouCents,
        debts: [...mine.youOwe, ...mine.owedToYou].map(describe),
      });
    }
    if (method === "POST" && tail === "settlements") {
      if (await rateLimited(db, "settlement", u.id, RATE_LIMITS.settlementWrite)) return tooMany();
      const b = await body(req);
      const from = textField(b?.fromMemberId), to = textField(b?.toMemberId);
      if (!from || !to) return fail("Choose who is paying and who is being paid.");
      if (from === to) return fail("A member cannot pay themselves.");
      if (!isAdmin && from !== u.id) return fail("You can only record a payment made by your own account.", 403);
      let cents;
      try { cents = parseAmountToCents(b?.amount); } catch (error) { return fail(error.message); }
      const members = await groupMembers(db, gid);
      const byId = new Map(members.map(x => [x.id, x]));
      if (!byId.has(from) || !byId.has(to)) return fail("Both members must belong to this group.");
      if (!isAdmin && !byId.get(to).active) return fail(byId.get(to).name + " is no longer an active member. Ask the admin to record this payment.", 409);
      try {
        validateSettlement({ debts: computePairwiseDebts(await loadLedger(db, gid)), fromMemberId: from, toMemberId: to, amountCents: cents, actorId: u.id, actorIsAdmin: isAdmin });
      } catch (error) {
        if (error instanceof SettlementError) return fail(error.message, error.status);
        throw error;
      }
      // Re-check the outstanding amount inside the INSERT itself so two
      // concurrent payments can never overpay the same debt.
      const settlementId = id();
      const result = await db.prepare(
        "INSERT INTO appx_settlements(id,group_id,from_member_id,to_member_id,amount_cents,created_by,created_at) SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE ?5 <= ("
        + "COALESCE((SELECT SUM(s.amount_cents) FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=?2 AND e.paid_by=?4 AND s.member_id=?3),0)"
        + "-COALESCE((SELECT SUM(s.amount_cents) FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=?2 AND e.paid_by=?3 AND s.member_id=?4),0)"
        + "-COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=?2 AND from_member_id=?3 AND to_member_id=?4),0)"
        + "+COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=?2 AND from_member_id=?4 AND to_member_id=?3),0))"
      ).bind(settlementId, gid, from, to, cents, u.id, Date.now()).run();
      if (changesOf(result) !== 1) return fail("The outstanding amount changed. Refresh and try again.", 409);
      return json({ ok: true, id: settlementId, amountCents: cents }, 201);
    }
    if (method === "GET" && tail === "balances") {
      const [members, ledger] = await Promise.all([groupMembers(db, gid), loadLedger(db, gid)]);
      const nameOf = nameLookup(members);
      const balances = computeBalances(ledger);
      for (const x of members) if (x.active && !balances.has(x.id)) balances.set(x.id, 0);
      return json({
        balances: [...balances].map(([memberId, cents]) => ({ memberId, name: nameOf(memberId), balanceCents: cents, balance: rupees(cents) }))
          .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
      });
    }
    return fail("Not found.", 404);
  }
  return fail("Not found.", 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": url.origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    if (url.pathname.startsWith("/api/")) {
      // Browsers send Origin on cross-site POSTs; refuse writes from other sites.
      const origin = req.headers.get("Origin");
      if (req.method !== "GET" && req.method !== "HEAD" && origin && origin !== url.origin) return fail("Cross-site request refused.", 403);
      try {
        return await api(req, env, url);
      } catch (e) {
        if (e instanceof HttpError) return fail(e.message, e.status);
        console.error("API error:", String(e));
        return json({ error: "Server error. Check Worker logs.", detail: env.ENVIRONMENT === "development" ? String(e) : undefined }, 500);
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response("Split Expense API is running. Configure the static assets binding.", { status: 200, headers: { "content-type": "text/plain" } });
  },
};
