import { allocateEqualSplit, allocateManualSplit } from "./split-logic.js";
import { pushEnabled, sendPushes, validSubscription } from "./push.js";
import { parseAmountToCents } from "./money.js";
import { computeBalances, computePairwiseDebts, debtsForMember, outstandingDebt, pairwiseActivity, validateSettlement, SettlementError } from "./settlement-logic.js";

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
  paymentMethodWrite: { limit: 20, windowMs: 10 * MINUTE },
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

// Member PINs: exactly 4 digits, stored only as a salted PBKDF2-SHA256 hash.
// SESSION_SECRET is mixed in as a pepper, so a copy of the database alone is
// not enough to brute-force the 10,000 possible PINs (rotating SESSION_SECRET
// therefore means members must have their PINs reset). The iteration count is
// stored with each hash, so it can be raised later without breaking old PINs.
const PIN_RE = /^\d{4}$/;
const PIN_ITERATIONS = 100000; // the maximum PBKDF2 iterations Workers allows
const PIN_MAX_FAILURES = 5, PIN_LOCK_MS = 15 * MINUTE;
const fromHex = s => new Uint8Array((s.match(/../g) || []).map(x => parseInt(x, 16)));
async function derivePin(pin, env, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin + "\u0000" + (env.SESSION_SECRET || "")), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
async function hashPin(pin, env) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iterations = Number(env.PIN_HASH_ITERATIONS) || PIN_ITERATIONS;
  return `pbkdf2-sha256$${iterations}$${hex(salt)}$${await derivePin(pin, env, salt, iterations)}`;
}
async function pinMatches(pin, stored, env) {
  const [scheme, iterations, salt, expected] = String(stored || "").split("$");
  if (scheme !== "pbkdf2-sha256" || !expected || !(Number(iterations) > 0)) return false;
  const actual = await derivePin(pin, env, fromHex(salt), Number(iterations));
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < Math.min(actual.length, expected.length); i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
// Checks a member's PIN against their access request row, counting failures
// and locking the member for a while after too many. Returns an error
// Response, or null when the PIN is correct (or was just created).
async function checkMemberPin(db, env, r, pin, { create = false } = {}) {
  const now = Date.now();
  if (r.pin_locked_until && r.pin_locked_until > now) {
    const mins = Math.ceil((r.pin_locked_until - now) / MINUTE);
    return fail(`Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? "" : "s"}, or ask the admin to reset your PIN.`, 429);
  }
  if (!r.pin_hash) {
    // Existing member from before PINs: they choose one now.
    if (!create) return json({ error: "Create a 4-digit PIN for your account.", code: "pin_not_set" }, 409);
    await db.prepare("UPDATE appx_access_requests SET pin_hash=?,pin_failures=0,pin_locked_until=NULL WHERE id=? AND pin_hash IS NULL").bind(await hashPin(pin, env), r.id).run();
    const saved = await db.prepare("SELECT pin_hash FROM appx_access_requests WHERE id=?").bind(r.id).first();
    // Someone else set it a moment earlier: their PIN wins, so check against it.
    return await pinMatches(pin, saved?.pin_hash, env) ? null : fail("Incorrect PIN.", 401);
  }
  if (await pinMatches(pin, r.pin_hash, env)) {
    if (r.pin_failures) await db.prepare("UPDATE appx_access_requests SET pin_failures=0,pin_locked_until=NULL WHERE id=?").bind(r.id).run();
    return null;
  }
  const failures = Number(r.pin_failures || 0) + 1, locked = failures >= PIN_MAX_FAILURES;
  await db.prepare("UPDATE appx_access_requests SET pin_failures=?,pin_locked_until=? WHERE id=?").bind(locked ? 0 : failures, locked ? now + PIN_LOCK_MS : null, r.id).run();
  if (locked) return fail("Too many wrong PINs. Try again in 15 minutes, or ask the admin to reset your PIN.", 429);
  const left = PIN_MAX_FAILURES - failures;
  return fail(`Incorrect PIN. ${left} ${left === 1 ? "try" : "tries"} left.`, 401);
}

async function body(req, maxBytes = MAX_BODY_BYTES) {
  if (Number(req.headers.get("content-length") || 0) > maxBytes) throw new HttpError("Request body is too large.", 413);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError("Request body is too large.", 413);
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
  // Approval does not expire (members prove who they are with their PIN);
  // the session itself does, and revoking/removing a member ends it at once.
  const s = await db.prepare("SELECT s.request_id,s.expires_at,r.display_name,r.status FROM appx_sessions s JOIN appx_access_requests r ON r.id=s.request_id WHERE s.token_hash=?").bind(tokenHash).first();
  if (!s || s.expires_at < Date.now() || s.status !== "approved") {
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
async function adminName(db) {
  const r = await db.prepare("SELECT setting_value AS name FROM appx_settings WHERE setting_key='admin_name'").first();
  return r?.name || null;
}
const sameName = (a, b) => !!a && !!b && cleanName(a).toLowerCase() === cleanName(b).toLowerCase();
// The administrator is one person: with an admin session they always act as
// the "admin" member in every group (their normal-user view), even if an
// older member cookie is also present on the device.
async function requireUser(req, env) {
  if (await admin(req, env)) {
    const name = await adminName(env['split-expense']);
    if (name) return { id: "admin", name, role: "admin" };
  }
  return await session(req, env);
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
    db.prepare("SELECT from_member_id AS fromMemberId,to_member_id AS toMemberId,SUM(amount_cents) AS amountCents FROM appx_settlements WHERE group_id=? AND status='confirmed' GROUP BY from_member_id,to_member_id").bind(gid).all(),
  ]);
  const ints = rows => rows.map(r => ({ ...r, amountCents: Number(r.amountCents) }));
  return { paidTotals: ints(paid.results), splitEdges: ints(splits.results), settlements: ints(settlements.results) };
}
function describeDebt(debt, nameOf) {
  return { fromMemberId: debt.fromMemberId, fromName: nameOf(debt.fromMemberId), toMemberId: debt.toMemberId, toName: nameOf(debt.toMemberId), amountCents: debt.amountCents, amount: rupees(debt.amountCents) };
}

// Renames a member everywhere: the name they sign in with and the name on
// their past expenses and payments (stored by id). Used by the admin for
// anyone, and by members for themselves. Their current session keeps working.
async function renameMember_(db, rid, rawName) {
  const name = cleanName(rawName);
  if (name.length < 2 || name.length > 60) return fail("Name must be 2–60 characters.");
  const r = await db.prepare("SELECT id,group_id FROM appx_access_requests WHERE id=?").bind(rid).first();
  if (!r) return fail("Member not found.", 404);
  if (sameName(name, await adminName(db))) return fail("That is the administrator's name. Choose a different name.", 409);
  const taken = await db.prepare("SELECT 1 FROM appx_access_requests WHERE group_id=?1 AND id<>?2 AND lower(display_name)=lower(?3) UNION SELECT 1 FROM appx_group_members WHERE group_id=?1 AND member_id<>?2 AND lower(name)=lower(?3)").bind(r.group_id, rid, name).first();
  if (taken) return fail("Someone in this group already has that name.", 409);
  try {
    await db.batch([
      db.prepare("UPDATE appx_access_requests SET display_name=? WHERE id=?").bind(name, rid),
      db.prepare("UPDATE appx_group_members SET name=? WHERE group_id=? AND member_id=?").bind(name, r.group_id, rid),
    ]);
  } catch (e) {
    if (String(e).toLowerCase().includes("unique")) return fail("Someone in this group already has that name.", 409);
    throw e;
  }
  return json({ ok: true, id: rid, name });
}

// Validates an add/edit expense request body against the group's active
// members. Returns { desc, cents, paidBy, splitRows } or { error }.
async function parseExpense(db, gid, b) {
  const bad = error => ({ error });
  const desc = cleanName(b?.description);
  if (!desc || desc.length > 160) return bad("Enter a description of up to 160 characters.");
  let cents;
  try { cents = parseAmountToCents(b?.amount); } catch (error) { return bad(error.message); }
  const paidBy = textField(b?.paidBy);
  const active = new Set((await groupMembers(db, gid)).filter(x => x.active).map(x => x.id));
  if (!active.has(paidBy)) return bad("Payer must be an active member of this group.");
  const splitMode = b?.splitMode ?? "equal";
  let splitRows;
  if (splitMode === "manual") {
    if (!Array.isArray(b?.allocations) || b.allocations.length === 0) return bad("Enter at least one manual amount.");
    if (b.allocations.length > MAX_SPLIT_MEMBERS) return bad("Too many split members.");
    try {
      const allocations = b.allocations.map(item => ({ memberId: textField(item?.memberId), amountCents: parseAmountToCents(item?.amount, { allowZero: true }) }));
      splitRows = allocateManualSplit(cents, allocations, [...active]);
    } catch (error) { return bad(error.message); }
  } else if (splitMode === "equal") {
    if (!Array.isArray(b?.memberIds) || b.memberIds.length > MAX_SPLIT_MEMBERS) return bad("Select at least one member to split this expense.");
    if (b.memberIds.some(x => typeof x !== "string")) return bad("Split members must belong to this group.");
    const memberIds = [...new Set(b.memberIds)];
    if (!memberIds.length) return bad("Select at least one member to split this expense.");
    if (memberIds.some(x => !active.has(x))) return bad("Split members must be active members of this group.");
    splitRows = allocateEqualSplit(cents, memberIds);
  } else {
    return bad("Split method must be equal or manual.");
  }
  // Zero shares carry no meaning; keep only real allocations.
  splitRows = splitRows.filter(row => row.amountCents > 0);
  if (splitRows.reduce((sum, row) => sum + row.amountCents, 0) !== cents) throw new Error("Split rows do not add up to the expense total");
  return { desc, cents, paidBy, splitRows };
}

// Payment methods (UPI only for now). A UPI ID looks like name@bank; the QR
// is an image the person uploads (the app shrinks it before sending), checked
// by its actual bytes, not just its declared type.
const UPI_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
const QR_MAX_BYTES = 300 * 1024, PAYMENT_METHOD_BODY_BYTES = 512 * 1024;
function parseQr(value, what = "QR code") {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || ""));
  if (!m) return { error: `Upload the ${what} as a PNG, JPEG or WebP image.` };
  let bytes;
  try { bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); } catch { return { error: `That ${what} could not be read.` }; }
  if (bytes.length > QR_MAX_BYTES) return { error: `That ${what} is too large (max 300 KB).` };
  const starts = (...sig) => sig.every((b, i) => bytes[i] === b);
  const real = starts(0x89, 0x50, 0x4e, 0x47) ? "image/png" : starts(0xff, 0xd8, 0xff) ? "image/jpeg"
    : starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" ? "image/webp" : null;
  if (real !== m[1]) return { error: "That file is not a valid PNG, JPEG or WebP image." };
  return { mime: real, base64: m[2] };
}
const methodOut = r => ({ kind: "upi", upiId: r?.upi_id || null, hasQr: !!r?.qr_base64, updatedAt: r?.updated_at || null });

// In-app notifications. Each helper returns INSERT statements so they go in
// the same batch as the change they describe. Nobody is told about their own
// action.
const inrText = c => "₹" + (c / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function notifyStmt(db, n) {
  return db.prepare("INSERT INTO appx_notifications(id,recipient_id,group_id,kind,title,body,link,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(id(), n.to, n.groupId ?? null, n.kind, n.title, n.body ?? null, n.link ?? null, n.actor ?? null, Date.now());
}
// Everyone in an expense (payer and split), told what it means for them.
function expenseNotes(note, { kind, gid, actor, desc, cents, paidBy, splitRows, nameOf, alsoTell = [] }) {
  const verb = { expense_added: "added", expense_edited: "changed", expense_deleted: "deleted" }[kind];
  const people = new Set([paidBy, ...splitRows.map(r => r.memberId), ...alsoTell]);
  people.delete(actor.id);
  return [...people].map(to => {
    const share = splitRows.find(r => r.memberId === to)?.amountCents || 0;
    const effect = (paidBy === to ? cents : 0) - share;
    const body = kind === "expense_deleted" ? "It no longer counts in your balance."
      : `${paidBy === to ? "You" : nameOf(paidBy)} paid ${inrText(cents)} · ${effect > 0 ? `you get back ${inrText(effect)}` : effect < 0 ? `you owe ${inrText(-effect)}` : "you're not in the split"}`;
    return note({ to, groupId: gid, kind, title: `${actor.name} ${verb} “${desc}”`, body, link: `#/g/${gid}`, actor: actor.name });
  });
}

// SQL for what member f still owes member t in group g (each a placeholder
// like "?2"), from expenses and confirmed payments. With reserve, payments
// from f to t still waiting for confirmation are subtracted too, so pending
// payments can never add up to more than is owed.
const owedSql = (g, f, t, reserve = false) => "("
  + `COALESCE((SELECT SUM(s.amount_cents) FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=${g} AND e.paid_by=${t} AND s.member_id=${f}),0)`
  + `-COALESCE((SELECT SUM(s.amount_cents) FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=${g} AND e.paid_by=${f} AND s.member_id=${t}),0)`
  + `-COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=${g} AND from_member_id=${f} AND to_member_id=${t} AND status ${reserve ? "IN ('confirmed','pending')" : "='confirmed'"}),0)`
  + `+COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=${g} AND from_member_id=${t} AND to_member_id=${f} AND status='confirmed'),0))`;

async function api(req, env, url, outbox = []) {
  const db = env['split-expense'];
  // Every notification written during this request, also sent to phones
  // (see sendPushes) once the response is on its way.
  const note = n => { outbox.push(n); return notifyStmt(db, n); };
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
    const pin = textField(b?.pin);
    if (name.length < 2 || name.length > 60) return fail("Enter a name between 2 and 60 characters.");
    if (!PIN_RE.test(pin)) return fail("Choose a 4-digit PIN.");
    if (sameName(name, await adminName(db))) return fail("That is the administrator's name. Sign in with Admin login to use the app as yourself.", 409);
    const g = await db.prepare("SELECT id FROM appx_groups WHERE id=?").bind(groupId).first();
    if (!g) return fail("Choose an existing group before requesting access.");
    const existing = await db.prepare("SELECT id,status,expires_at,pin_hash,pin_failures,pin_locked_until FROM appx_access_requests WHERE group_id=? AND lower(display_name)=lower(?) ORDER BY requested_at DESC LIMIT 1").bind(groupId, name).first();
    const now = Date.now();
    if (existing) {
      if (existing.status === "pending") return fail("An access request is already waiting for admin approval.", 409);
      if (existing.status === "approved") return fail("This name is already a member of this group. Sign in with your PIN instead.", 409);
      // Asking again under an existing name needs that name's PIN (or sets it,
      // for members from before PINs), so nobody can take over someone else's entry.
      const bad = await checkMemberPin(db, env, existing, pin, { create: true });
      if (bad) return bad;
      await db.batch([
        db.prepare("UPDATE appx_access_requests SET status='pending',requested_at=?,approved_at=NULL,expires_at=NULL WHERE id=?").bind(now, existing.id),
        db.prepare("DELETE FROM appx_sessions WHERE request_id=?").bind(existing.id),
      ]);
      await db.batch([note({ to: "admin", groupId, kind: "access_request", title: `${name} wants to join again`, body: "Review it in Admin → Requests.", link: "#/admin", actor: name })]);
      return json({ ok: true, requestId: existing.id, message: "Access request sent again using your existing membership entry." }, 200);
    }
    const requestId = id();
    try {
      await db.prepare("INSERT INTO appx_access_requests(id,display_name,status,requested_at,group_id,pin_hash) VALUES(?,?,'pending',?,?,?)").bind(requestId, name, now, groupId, await hashPin(pin, env)).run();
    } catch (e) {
      // Another request with this name landed first (names are unique per group).
      if (String(e).toLowerCase().includes("unique")) return fail("Someone in this group already uses that name. Choose a different name.", 409);
      throw e;
    }
    await db.batch([note({ to: "admin", groupId, kind: "access_request", title: `${name} wants to join`, body: "Review it in Admin → Requests.", link: "#/admin", actor: name })]);
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
      const r = await db.prepare("SELECT a.id,a.display_name AS name,a.status,a.requested_at AS requestedAt,a.expires_at AS expiresAt,a.group_id AS groupId,g.name AS groupName,a.pin_hash IS NOT NULL AS hasPin FROM appx_access_requests a LEFT JOIN appx_groups g ON g.id=a.group_id ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,a.requested_at DESC LIMIT 200").all();
      return json({ requests: r.results.map(x => ({ ...x, hasPin: !!x.hasPin })) });
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
        db.prepare("DELETE FROM appx_payment_proofs WHERE settlement_id IN (SELECT id FROM appx_settlements WHERE group_id=?)").bind(gid),
        db.prepare("DELETE FROM appx_settlements WHERE group_id=?").bind(gid),
        db.prepare("DELETE FROM appx_splits WHERE expense_id IN (SELECT id FROM appx_expenses WHERE group_id=?)").bind(gid),
        db.prepare("DELETE FROM appx_expenses WHERE group_id=?").bind(gid),
        db.prepare("DELETE FROM appx_invites WHERE group_id=?").bind(gid),
        db.prepare("DELETE FROM appx_group_members WHERE group_id=?").bind(gid),
        db.prepare("DELETE FROM appx_sessions WHERE request_id IN (SELECT id FROM appx_access_requests WHERE group_id=?)").bind(gid),
        db.prepare("DELETE FROM appx_access_requests WHERE group_id=?").bind(gid),
        db.prepare("DELETE FROM appx_notifications WHERE group_id=?").bind(gid),
        db.prepare("DELETE FROM appx_groups WHERE id=?").bind(gid),
      ]);
      return json({ ok: true, deletedGroup: g.name });
    }
    const renameGroup = p.match(/^\/api\/admin\/groups\/([\w-]+)\/rename$/);
    if (method === "POST" && renameGroup) {
      const gid = renameGroup[1], name = cleanName((await body(req))?.name);
      if (name.length < 2 || name.length > 80) return fail("Group name must be 2–80 characters.");
      const g = await db.prepare("SELECT id FROM appx_groups WHERE id=?").bind(gid).first();
      if (!g) return fail("Group not found.", 404);
      try {
        await db.prepare("UPDATE appx_groups SET name=? WHERE id=?").bind(name, gid).run();
      } catch (e) {
        if (String(e).toLowerCase().includes("unique")) return fail("That group name already exists. Choose a unique name.", 409);
        throw e;
      }
      return json({ ok: true, group: { id: gid, name } });
    }
    // Renaming a member changes their name everywhere: past expenses and
    // payments (stored by id) and the name they sign in with. Their current
    // session keeps working.
    // Forgotten PIN: clear it and sign the member out everywhere; they choose
    // a new PIN on their next sign-in.
    const resetPin = p.match(/^\/api\/admin\/requests\/([\w-]+)\/reset-pin$/);
    if (method === "POST" && resetPin) {
      const rid = resetPin[1];
      const r = await db.prepare("SELECT id FROM appx_access_requests WHERE id=?").bind(rid).first();
      if (!r) return fail("Member not found.", 404);
      await db.batch([
        db.prepare("UPDATE appx_access_requests SET pin_hash=NULL,pin_failures=0,pin_locked_until=NULL WHERE id=?").bind(rid),
        db.prepare("DELETE FROM appx_sessions WHERE request_id=?").bind(rid),
      ]);
      return json({ ok: true });
    }
    const renameMember = p.match(/^\/api\/admin\/requests\/([\w-]+)\/rename$/);
    if (method === "POST" && renameMember) return renameMember_(db, renameMember[1], (await body(req))?.name);
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
        const groupName = (await db.prepare("SELECT name FROM appx_groups WHERE id=?").bind(reqRow.group_id).first())?.name || "the group";
        await db.batch([
          db.prepare("UPDATE appx_access_requests SET status='approved',approved_at=?,expires_at=NULL WHERE id=?").bind(Date.now(), rid),
          db.prepare("INSERT OR IGNORE INTO appx_group_members(group_id,member_id,name) VALUES(?,?,?)").bind(reqRow.group_id, rid, reqRow.display_name),
          note({ to: rid, groupId: reqRow.group_id, kind: "approved", title: `You're in “${groupName}”`, body: "The admin approved you. Add expenses and settle up here.", link: `#/g/${reqRow.group_id}`, actor: await adminName(db) }),
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
    // "This member is me": fold a separate member entry of the administrator
    // (same person, created before the admin identity existed) into the admin
    // member of that group. Shares on the same expense are added together,
    // payments between the two entries are dropped (they were to oneself), and
    // balances stay zero-sum. The preview lists what will move.
    const merge = p.match(/^\/api\/admin\/requests\/([\w-]+)\/(merge-preview|merge-into-admin)$/);
    if (merge) {
      const [, rid, action] = merge;
      const r = await db.prepare("SELECT id,display_name AS name,group_id AS groupId FROM appx_access_requests WHERE id=?").bind(rid).first();
      if (!r || !r.groupId) return fail("Member request not found.", 404);
      const gid = r.groupId;
      const name = await adminName(db);
      if (!name) return fail("Set the administrator name by signing in first.", 409);
      if (method === "GET" && action === "merge-preview") {
        const [counts, ledger] = await Promise.all([
          db.prepare("SELECT (SELECT COUNT(*) FROM appx_expenses WHERE group_id=?1 AND paid_by=?2) AS expensesPaid,(SELECT COUNT(*) FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=?1 AND s.member_id=?2) AS shares,(SELECT COUNT(*) FROM appx_settlements WHERE group_id=?1 AND (from_member_id=?2 OR to_member_id=?2)) AS payments,(SELECT COUNT(*) FROM appx_settlements WHERE group_id=?1 AND ((from_member_id=?2 AND to_member_id='admin') OR (from_member_id='admin' AND to_member_id=?2))) AS paymentsWithAdmin,(SELECT name FROM appx_groups WHERE id=?1) AS groupName").bind(gid, rid).first(),
          loadLedger(db, gid),
        ]);
        const balances = computeBalances(ledger);
        return json({ memberName: r.name, adminName: name, ...counts, memberBalanceCents: balances.get(rid) || 0, adminBalanceCents: balances.get("admin") || 0 });
      }
      if (method === "POST" && action === "merge-into-admin") {
        const inGroup = "(SELECT id FROM appx_expenses WHERE group_id=?)";
        await db.batch([
          db.prepare("INSERT OR IGNORE INTO appx_group_members(group_id,member_id,name) VALUES(?,'admin',?)").bind(gid, name),
          db.prepare("UPDATE appx_splits SET amount_cents=amount_cents+(SELECT x.amount_cents FROM appx_splits x WHERE x.expense_id=appx_splits.expense_id AND x.member_id=?) WHERE member_id='admin' AND expense_id IN (SELECT expense_id FROM appx_splits WHERE member_id=?) AND expense_id IN " + inGroup).bind(rid, rid, gid),
          db.prepare("DELETE FROM appx_splits WHERE member_id=? AND expense_id IN (SELECT expense_id FROM appx_splits WHERE member_id='admin') AND expense_id IN " + inGroup).bind(rid, gid),
          db.prepare("UPDATE appx_splits SET member_id='admin' WHERE member_id=? AND expense_id IN " + inGroup).bind(rid, gid),
          db.prepare("UPDATE appx_expenses SET paid_by='admin' WHERE group_id=? AND paid_by=?").bind(gid, rid),
          db.prepare("UPDATE appx_expenses SET created_by='admin' WHERE group_id=? AND created_by=?").bind(gid, rid),
          db.prepare("DELETE FROM appx_settlements WHERE group_id=?1 AND ((from_member_id=?2 AND to_member_id='admin') OR (from_member_id='admin' AND to_member_id=?2))").bind(gid, rid),
          db.prepare("UPDATE appx_settlements SET from_member_id='admin' WHERE group_id=? AND from_member_id=?").bind(gid, rid),
          db.prepare("UPDATE appx_settlements SET to_member_id='admin' WHERE group_id=? AND to_member_id=?").bind(gid, rid),
          db.prepare("UPDATE appx_settlements SET created_by='admin' WHERE group_id=? AND created_by=?").bind(gid, rid),
          db.prepare("UPDATE appx_invites SET created_by='admin' WHERE group_id=? AND created_by=?").bind(gid, rid),
          db.prepare("DELETE FROM appx_sessions WHERE request_id=?").bind(rid),
          db.prepare("DELETE FROM appx_group_members WHERE group_id=? AND member_id=?").bind(gid, rid),
          db.prepare("DELETE FROM appx_access_requests WHERE id=?").bind(rid),
        ]);
        return json({ ok: true, merged: true });
      }
      return fail("Not found.", 404);
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
  if (method === "GET" && p === "/api/me") {
    const isAdmin = await admin(req, env);
    const member = await session(req, env);
    const name = isAdmin ? await adminName(db) : null;
    return json({
      admin: isAdmin && name ? { id: "admin", name } : null,
      member: member ? { id: member.id, name: member.name } : null,
    });
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
    const r = await db.prepare("SELECT id,status FROM appx_access_requests WHERE id=?").bind(rid).first();
    if (!r || r.status !== "approved") return fail("This request is not approved. Ask the admin to approve it, or request access again.", 403);
    const token = id() + id(), tokenHash = await hash(token), expires = Date.now() + SESSION_MS;
    await db.prepare("INSERT INTO appx_sessions(token_hash,request_id,expires_at) VALUES(?,?,?)").bind(tokenHash, rid, expires).run();
    return json({ ok: true }, 200, { "set-cookie": setCookie("split_session", token, Math.floor((expires - Date.now()) / 1000)) });
  }
  if (method === "POST" && p === "/api/access/signin") {
    if (await rateLimited(db, "signin", await clientKey(req), RATE_LIMITS.signin)) return tooMany();
    const b = await body(req), name = cleanName(b?.name), gid = textField(b?.groupId), pin = textField(b?.pin);
    if (name.length < 2 || name.length > 60 || !gid) return fail("Enter your name and choose a group.");
    if (!PIN_RE.test(pin)) return fail("Enter your 4-digit PIN.");
    if (sameName(name, await adminName(db))) return fail("That is the administrator's name. Use Admin login (name + PIN) to sign in as yourself.", 403);
    const r = await db.prepare("SELECT id,status,expires_at,pin_hash,pin_failures,pin_locked_until FROM appx_access_requests WHERE group_id=? AND lower(display_name)=lower(?) ORDER BY requested_at DESC LIMIT 1").bind(gid, name).first();
    if (!r) return fail("No access request found for that name in this group. Request access first.", 403);
    if (r.status === "pending") return fail("Your access request is waiting for admin approval.", 403);
    if (r.status !== "approved") return fail("Your access is not currently approved. Request access again to reactivate your existing entry.", 403);
    const bad = await checkMemberPin(db, env, r, pin, { create: b?.createPin === true });
    if (bad) return bad;
    const token = id() + id(), tokenHash = await hash(token), expires = Date.now() + SESSION_MS;
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
      + "+COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=g.id AND from_member_id=?1 AND status='confirmed'),0)"
      + "-COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=g.id AND to_member_id=?1 AND status='confirmed'),0) AS myBalanceCents "
      + "FROM appx_groups g JOIN appx_group_members m ON m.group_id=g.id WHERE m.member_id=?1 ORDER BY g.created_at DESC").bind(u.id).all();
    return json({ groups: r.results });
  }
  // Everyone I owe or who owes me, across all my groups, one row per person
  // per group (member ids are group-scoped). Same pairwise ledger as each
  // group's debts, so these always match the group and person screens.
  if (method === "GET" && p === "/api/balances") {
    const groups = (await db.prepare("SELECT g.id,g.name FROM appx_groups g JOIN appx_group_members m ON m.group_id=g.id WHERE m.member_id=? AND " + ACTIVE_MEMBER_SQL + " ORDER BY g.created_at DESC").bind(u.id).all()).results;
    const people = [];
    for (const g of groups) {
      const [members, ledger] = await Promise.all([groupMembers(db, g.id), loadLedger(db, g.id)]);
      const nameOf = nameLookup(members);
      const active = new Set(members.filter(x => x.active).map(x => x.id));
      // Payments waiting for approval, by the other person: what I sent them
      // (waitingOutCents) and what they sent me (waitingInCents).
      const waiting = (await db.prepare("SELECT from_member_id AS f,to_member_id AS t,SUM(amount_cents) AS c FROM appx_settlements WHERE group_id=?1 AND status='pending' AND (from_member_id=?2 OR to_member_id=?2) GROUP BY from_member_id,to_member_id").bind(g.id, u.id).all()).results;
      const waitOut = new Map(waiting.filter(w => w.f === u.id).map(w => [w.t, Number(w.c)])), waitIn = new Map(waiting.filter(w => w.t === u.id).map(w => [w.f, Number(w.c)]));
      for (const d of computePairwiseDebts(ledger)) {
        if (d.fromMemberId !== u.id && d.toMemberId !== u.id) continue;
        const other = d.fromMemberId === u.id ? d.toMemberId : d.fromMemberId;
        // Positive: they owe me; negative: I owe them.
        const netCents = d.toMemberId === u.id ? d.amountCents : -d.amountCents;
        people.push({ groupId: g.id, groupName: g.name, memberId: other, name: nameOf(other), active: active.has(other), netCents, waitingOutCents: waitOut.get(other) || 0, waitingInCents: waitIn.get(other) || 0 });
      }
    }
    people.sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const owedToYouCents = people.reduce((s, x) => s + Math.max(0, x.netCents), 0);
    const youOweCents = people.reduce((s, x) => s + Math.max(0, -x.netCents), 0);
    return json({ people, owedToYouCents, youOweCents, netCents: owedToYouCents - youOweCents });
  }
  // Payments waiting on me (to confirm) or on someone else (that I sent),
  // across all my groups. Admins see only their own here too.
  if (method === "GET" && p === "/api/payments/pending") {
    const r = await db.prepare("SELECT s.id,s.group_id AS groupId,g.name AS groupName,s.from_member_id AS fromMemberId,COALESCE(f.name,'" + FORMER_MEMBER + "') AS fromName,s.to_member_id AS toMemberId,COALESCE(t.name,'" + FORMER_MEMBER + "') AS toName,s.amount_cents AS amountCents,s.created_at AS createdAt,EXISTS(SELECT 1 FROM appx_payment_proofs p WHERE p.settlement_id=s.id) AS hasProof FROM appx_settlements s JOIN appx_groups g ON g.id=s.group_id JOIN appx_group_members me ON me.group_id=s.group_id AND me.member_id=?1 LEFT JOIN appx_group_members f ON f.group_id=s.group_id AND f.member_id=s.from_member_id LEFT JOIN appx_group_members t ON t.group_id=s.group_id AND t.member_id=s.to_member_id WHERE s.status='pending' AND (s.to_member_id=?1 OR s.from_member_id=?1) ORDER BY s.created_at DESC LIMIT 100").bind(u.id).all();
    const rows = r.results.map(x => ({ ...x, hasProof: !!x.hasProof, incoming: x.toMemberId === u.id }));
    return json({ toConfirm: rows.filter(x => x.incoming), waiting: rows.filter(x => !x.incoming) });
  }
  // My own payment method (how others pay me), the same in every group.
  if (p === "/api/payment-method" && method === "GET") {
    return json({ method: methodOut(await db.prepare("SELECT * FROM appx_payment_methods WHERE member_id=? AND kind='upi'").bind(u.id).first()) });
  }
  if (p === "/api/payment-method" && method === "POST") {
    if (await rateLimited(db, "paymethod", u.id, RATE_LIMITS.paymentMethodWrite)) return tooMany();
    const b = await body(req, PAYMENT_METHOD_BODY_BYTES);
    const upiId = textField(b?.upiId).trim();
    if (!UPI_RE.test(upiId)) return fail("Enter a valid UPI ID, like name@okbank.");
    // qr: a data URL to set it, null to remove it, left out to keep the current one.
    let qr = null;
    if (b?.qr !== undefined && b?.qr !== null) { qr = parseQr(b.qr); if (qr.error) return fail(qr.error); }
    const keep = b?.qr === undefined;
    await db.prepare("INSERT INTO appx_payment_methods(member_id,kind,upi_id,qr_mime,qr_base64,updated_at) VALUES(?1,'upi',?2,?3,?4,?5) ON CONFLICT(member_id,kind) DO UPDATE SET upi_id=excluded.upi_id,updated_at=excluded.updated_at"
      + (keep ? "" : ",qr_mime=excluded.qr_mime,qr_base64=excluded.qr_base64"))
      .bind(u.id, upiId, qr?.mime ?? null, qr?.base64 ?? null, Date.now()).run();
    return json({ method: methodOut(await db.prepare("SELECT * FROM appx_payment_methods WHERE member_id=? AND kind='upi'").bind(u.id).first()) });
  }
  if (p === "/api/payment-method/qr" && method === "GET") {
    const r = await db.prepare("SELECT qr_mime,qr_base64 FROM appx_payment_methods WHERE member_id=? AND kind='upi'").bind(u.id).first();
    if (!r?.qr_base64) return fail("No QR code yet.", 404);
    return new Response(Uint8Array.from(atob(r.qr_base64), c => c.charCodeAt(0)), { headers: { "content-type": r.qr_mime, "cache-control": "private, no-cache", "x-content-type-options": "nosniff" } });
  }
  if (p === "/api/payment-method/delete" && method === "POST") {
    await db.prepare("DELETE FROM appx_payment_methods WHERE member_id=?").bind(u.id).run();
    return json({ method: methodOut(null) });
  }
  // Phone notifications: the public key the browser subscribes with (null
  // when push is not set up), and saving/removing this browser's subscription.
  if (method === "GET" && p === "/api/push/key") return json({ publicKey: pushEnabled(env) ? env.VAPID_PUBLIC_KEY : null });
  if (method === "POST" && p === "/api/push/subscribe") {
    if (!pushEnabled(env)) return fail("Phone notifications are not set up on this server yet.", 503);
    const sub = validSubscription(await body(req));
    if (!sub) return fail("That browser subscription is not valid.");
    await db.batch([
      db.prepare("INSERT INTO appx_push_subscriptions(endpoint,member_id,p256dh,auth,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(endpoint) DO UPDATE SET member_id=excluded.member_id,p256dh=excluded.p256dh,auth=excluded.auth,created_at=excluded.created_at").bind(sub.endpoint, u.id, sub.p256dh, sub.auth, Date.now()),
      // At most 10 devices per person: forget the oldest.
      db.prepare("DELETE FROM appx_push_subscriptions WHERE member_id=?1 AND endpoint NOT IN (SELECT endpoint FROM appx_push_subscriptions WHERE member_id=?1 ORDER BY created_at DESC LIMIT 10)").bind(u.id),
    ]);
    return json({ ok: true });
  }
  if (method === "POST" && p === "/api/push/unsubscribe") {
    const endpoint = textField((await body(req))?.endpoint);
    await db.prepare("DELETE FROM appx_push_subscriptions WHERE endpoint=? AND member_id=?").bind(endpoint, u.id).run();
    return json({ ok: true });
  }
  // My notifications, newest first, with how many are unread. Old ones (90
  // days) are cleared as they are read.
  if (method === "GET" && p === "/api/notifications") {
    await db.prepare("DELETE FROM appx_notifications WHERE recipient_id=? AND created_at<?").bind(u.id, Date.now() - 90 * 24 * 60 * MINUTE).run();
    const [rows, unread] = await Promise.all([
      db.prepare("SELECT n.id,n.kind,n.title,n.body,n.link,n.actor_name AS actorName,n.created_at AS createdAt,n.read_at AS readAt,n.group_id AS groupId,g.name AS groupName FROM appx_notifications n LEFT JOIN appx_groups g ON g.id=n.group_id WHERE n.recipient_id=? ORDER BY n.created_at DESC LIMIT 100").bind(u.id).all(),
      db.prepare("SELECT COUNT(*) AS n FROM appx_notifications WHERE recipient_id=? AND read_at IS NULL").bind(u.id).first(),
    ]);
    return json({ items: rows.results, unread: Number(unread?.n || 0) });
  }
  if (method === "POST" && p === "/api/notifications/read") {
    await db.prepare("UPDATE appx_notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL").bind(Date.now(), u.id).run();
    return json({ ok: true, unread: 0 });
  }
  // A member changes their own name. (The admin's name is their login, so it
  // is not changed here.)
  if (method === "POST" && p === "/api/me/name") {
    if (isAdmin) return fail("The admin name is your login and can't be changed here.", 403);
    if (await rateLimited(db, "rename", u.id, RATE_LIMITS.paymentMethodWrite)) return tooMany();
    return renameMember_(db, u.id, (await body(req))?.name);
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
      const parsed = await parseExpense(db, gid, await body(req));
      if (parsed.error) return fail(parsed.error);
      const { desc, cents, paidBy, splitRows } = parsed;
      const eid = id();
      const nameOf = nameLookup(await groupMembers(db, gid));
      await db.batch([
        db.prepare("INSERT INTO appx_expenses(id,group_id,description,amount_cents,paid_by,created_by,created_at) VALUES(?,?,?,?,?,?,?)").bind(eid, gid, desc, cents, paidBy, u.id, Date.now()),
        ...splitRows.map(row => db.prepare("INSERT INTO appx_splits(expense_id,member_id,amount_cents) VALUES(?,?,?)").bind(eid, row.memberId, row.amountCents)),
        ...expenseNotes(note, { kind: "expense_added", gid, actor: u, desc, cents, paidBy, splitRows, nameOf }),
      ]);
      return json({ ok: true, id: eid, amountCents: cents, splits: splitRows }, 201);
    }
    // Edit replaces the description, amount, payer and whole split; the same
    // people who may delete an expense (its creator or the admin) may edit it.
    const editExpense = tail.match(/^expenses\/([\w-]+)\/edit$/);
    if (method === "POST" && editExpense) {
      if (await rateLimited(db, "expense", u.id, RATE_LIMITS.expenseWrite)) return tooMany();
      const e = await db.prepare("SELECT id,paid_by FROM appx_expenses WHERE id=? AND group_id=?").bind(editExpense[1], gid).first();
      if (!e) return fail("Expense not found.", 404);
      if (!isAdmin && e.paid_by !== u.id) return fail("Only the person who paid for this expense or the admin can edit it.", 403);
      const parsed = await parseExpense(db, gid, await body(req));
      if (parsed.error) return fail(parsed.error);
      const { desc, cents, paidBy, splitRows } = parsed;
      // People taken out of the split hear about it too.
      const before = (await db.prepare("SELECT member_id FROM appx_splits WHERE expense_id=?").bind(e.id).all()).results.map(r => r.member_id);
      await db.batch([
        ...expenseNotes(note, { kind: "expense_edited", gid, actor: u, desc, cents, paidBy, splitRows, nameOf: nameLookup(await groupMembers(db, gid)), alsoTell: [e.paid_by, ...before] }),
        db.prepare("UPDATE appx_expenses SET description=?,amount_cents=?,paid_by=? WHERE id=? AND group_id=?").bind(desc, cents, paidBy, e.id, gid),
        db.prepare("DELETE FROM appx_splits WHERE expense_id=?").bind(e.id),
        ...splitRows.map(row => db.prepare("INSERT INTO appx_splits(expense_id,member_id,amount_cents) VALUES(?,?,?)").bind(e.id, row.memberId, row.amountCents)),
      ]);
      return json({ ok: true, id: e.id, amountCents: cents, splits: splitRows });
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
        return { ...x, amount: rupees(x.amountCents), paidByName: nameOf(x.paidBy), createdByName: nameOf(x.createdBy), splitCount: rows.length, splits: rows, myShareCents, myEffectCents, canDelete: isAdmin || x.paidBy === u.id, canEdit: isAdmin || x.paidBy === u.id };
      });
      return json({ expenses });
    }
    const deleteExpense = tail.match(/^expenses\/([\w-]+)\/delete$/);
    if (method === "POST" && deleteExpense) {
      if (await rateLimited(db, "expense", u.id, RATE_LIMITS.expenseWrite)) return tooMany();
      const e = await db.prepare("SELECT id,paid_by,description,amount_cents FROM appx_expenses WHERE id=? AND group_id=?").bind(deleteExpense[1], gid).first();
      if (!e) return fail("Expense not found.", 404);
      if (!isAdmin && e.paid_by !== u.id) return fail("Only the person who paid for this expense or the admin can delete it.", 403);
      const oldSplits = (await db.prepare("SELECT member_id AS memberId,amount_cents AS amountCents FROM appx_splits WHERE expense_id=?").bind(e.id).all()).results;
      await db.batch([
        ...expenseNotes(note, { kind: "expense_deleted", gid, actor: u, desc: e.description, cents: e.amount_cents, paidBy: e.paid_by, splitRows: oldSplits, nameOf: nameLookup(await groupMembers(db, gid)) }),
        db.prepare("DELETE FROM appx_splits WHERE expense_id=?").bind(e.id),
        db.prepare("DELETE FROM appx_expenses WHERE id=? AND group_id=?").bind(e.id, gid),
      ]);
      return json({ ok: true, deleted: true });
    }
    // One member's whole picture in the group, for anyone in it (group
    // expenses are visible to all members anyway): totals, who they owe and
    // who owes them, every expense they are part of, and their payments.
    // Everyone in the group and how to pay them (UPI ID, whether a QR exists).
    if (method === "GET" && tail === "payment-methods") {
      const members = (await groupMembers(db, gid)).filter(x => x.active);
      const rows = members.length ? (await db.prepare("SELECT * FROM appx_payment_methods WHERE kind='upi' AND member_id IN (" + members.map(() => "?").join(",") + ")").bind(...members.map(x => x.id)).all()).results : [];
      const byId = new Map(rows.map(r => [r.member_id, r]));
      return json({ people: members.map(x => ({ memberId: x.id, name: x.name, isMe: x.id === u.id, ...methodOut(byId.get(x.id)) })) });
    }
    // A member's UPI QR image, only for people in the same group.
    const qrImage = tail.match(/^members\/([\w-]+)\/qr$/);
    if (method === "GET" && qrImage) {
      const mid = qrImage[1];
      if (!(await groupMembers(db, gid)).some(x => x.id === mid)) return fail("That person is not in this group.", 404);
      const r = await db.prepare("SELECT qr_mime,qr_base64 FROM appx_payment_methods WHERE member_id=? AND kind='upi'").bind(mid).first();
      if (!r?.qr_base64) return fail("No QR code yet.", 404);
      const bytes = Uint8Array.from(atob(r.qr_base64), c => c.charCodeAt(0));
      return new Response(bytes, { headers: { "content-type": r.qr_mime, "cache-control": "private, no-cache", "x-content-type-options": "nosniff", "content-disposition": "inline" } });
    }
    const memberSummary = tail.match(/^members\/([\w-]+)$/);
    if (method === "GET" && memberSummary) {
      const mid = memberSummary[1];
      const [members, ledger] = await Promise.all([groupMembers(db, gid), loadLedger(db, gid)]);
      const who = members.find(x => x.id === mid);
      if (!who) return fail("That person is not in this group.", 404);
      const nameOf = nameLookup(members);
      const sum = (rows, key) => rows.filter(r => r[key] === mid).reduce((t, r) => t + r.amountCents, 0);
      const debts = computePairwiseDebts(ledger);
      const [expenses, payments] = await Promise.all([
        db.prepare("SELECT e.id,e.description,e.amount_cents AS amountCents,e.paid_by AS paidBy,e.created_at AS createdAt,COALESCE((SELECT amount_cents FROM appx_splits WHERE expense_id=e.id AND member_id=?2),0) AS shareCents,(SELECT COUNT(*) FROM appx_splits WHERE expense_id=e.id) AS splitCount FROM appx_expenses e WHERE e.group_id=?1 AND (e.paid_by=?2 OR e.id IN (SELECT expense_id FROM appx_splits WHERE member_id=?2)) ORDER BY e.created_at DESC LIMIT 300").bind(gid, mid).all(),
        db.prepare("SELECT id,from_member_id AS fromMemberId,to_member_id AS toMemberId,amount_cents AS amountCents,created_at AS createdAt,status FROM appx_settlements WHERE group_id=?1 AND (from_member_id=?2 OR to_member_id=?2) AND status<>'rejected' ORDER BY created_at DESC LIMIT 200").bind(gid, mid).all(),
      ]);
      return json({
        member: { id: mid, name: who.name, active: who.active, isMe: mid === u.id },
        paidCents: sum(ledger.paidTotals, "memberId"),
        shareCents: sum(ledger.splitEdges, "memberId"),
        balanceCents: computeBalances(ledger).get(mid) || 0,
        owes: debts.filter(d => d.fromMemberId === mid).map(d => ({ memberId: d.toMemberId, name: nameOf(d.toMemberId), amountCents: d.amountCents })),
        owedBy: debts.filter(d => d.toMemberId === mid).map(d => ({ memberId: d.fromMemberId, name: nameOf(d.fromMemberId), amountCents: d.amountCents })),
        // effectCents: how the expense moved their balance (paid minus own share).
        expenses: expenses.results.map(x => ({ ...x, paidByName: nameOf(x.paidBy), effectCents: (x.paidBy === mid ? x.amountCents : 0) - x.shareCents })),
        payments: payments.results.map(x => ({ ...x, fromName: nameOf(x.fromMemberId), toName: nameOf(x.toMemberId) })),
      });
    }
    // Everything between two members: expenses where one paid and the other
    // had a share, and confirmed payments between them, with a running total
    // from a's side (positive: b owes a). "with/:id" is me and that person;
    // "pair/:a/:b" is any two members of the group (anyone in it may look).
    const withMember = tail.match(/^with\/([\w-]+)$/), pair = tail.match(/^pair\/([\w-]+)\/([\w-]+)$/);
    if (method === "GET" && (withMember || pair)) {
      const a = withMember ? u.id : pair[1], other = withMember ? withMember[1] : pair[2];
      const members = await groupMembers(db, gid);
      const nameOf = nameLookup(members);
      if (other === a || !members.some(x => x.id === other) || !members.some(x => x.id === a)) return fail("Choose two different members of this group.", 404);
      const [shares, settlements] = await Promise.all([
        db.prepare("SELECT e.id AS expenseId,e.description,e.paid_by AS paidBy,e.amount_cents AS totalCents,e.created_at AS createdAt,s.member_id AS memberId,s.amount_cents AS amountCents FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=?1 AND ((e.paid_by=?2 AND s.member_id=?3) OR (e.paid_by=?3 AND s.member_id=?2))").bind(gid, a, other).all(),
        db.prepare("SELECT id,from_member_id AS fromMemberId,to_member_id AS toMemberId,amount_cents AS amountCents,created_at AS createdAt FROM appx_settlements WHERE group_id=?1 AND status='confirmed' AND ((from_member_id=?2 AND to_member_id=?3) OR (from_member_id=?3 AND to_member_id=?2))").bind(gid, a, other).all(),
      ]);
      const activity = pairwiseActivity({ shares: shares.results, settlements: settlements.results, me: a, other });
      const otherMember = members.find(x => x.id === other);
      return json({ me: { id: a, name: withMember ? u.name : nameOf(a) }, other: { id: other, name: nameOf(other), active: otherMember.active }, netCents: activity.netCents, items: activity.items });
    }
    if (method === "GET" && tail === "settlements") {
      const r = await db.prepare("SELECT s.id,s.from_member_id AS fromMemberId,COALESCE(f.name,'" + FORMER_MEMBER + "') AS fromName,s.to_member_id AS toMemberId,COALESCE(t.name,'" + FORMER_MEMBER + "') AS toName,s.amount_cents AS amountCents,s.status,s.created_by AS createdBy,EXISTS(SELECT 1 FROM appx_payment_proofs p WHERE p.settlement_id=s.id) AS hasProof,s.decided_at AS decidedAt,s.created_at AS createdAt,COALESCE(c.name,'" + FORMER_MEMBER + "') AS recordedByName FROM appx_settlements s LEFT JOIN appx_group_members f ON f.group_id=s.group_id AND f.member_id=s.from_member_id LEFT JOIN appx_group_members t ON t.group_id=s.group_id AND t.member_id=s.to_member_id LEFT JOIN appx_group_members c ON c.group_id=s.group_id AND c.member_id=s.created_by WHERE s.group_id=? ORDER BY s.created_at DESC LIMIT 200").bind(gid).all();
      return json({ settlements: r.results.map(x => ({
        ...x, amount: rupees(x.amountCents),
        canDecide: x.status === "pending" && (isAdmin || x.toMemberId === u.id),
        canCancel: x.status === "pending" && (isAdmin || x.fromMemberId === u.id),
        hasProof: !!x.hasProof,
      })) });
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
      const waiting = new Map((await db.prepare("SELECT from_member_id AS f,to_member_id AS t,SUM(amount_cents) AS c FROM appx_settlements WHERE group_id=? AND status='pending' GROUP BY from_member_id,to_member_id").bind(gid).all()).results.map(x => [x.f + ">" + x.t, Number(x.c)]));
      // waitingCents: already sent and waiting for the receiver to confirm, so
      // at most amountCents - waitingCents more can be recorded.
      const describe = d => ({ ...describeDebt(d, nameOf), waitingCents: waiting.get(d.fromMemberId + ">" + d.toMemberId) || 0, canRecord: canRecord(d), counterpartyActive: activeIds.has(d.fromMemberId === u.id ? d.toMemberId : d.fromMemberId) });
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
      // May carry a screenshot of the payment, so it may be larger.
      const b = await body(req, PAYMENT_METHOD_BODY_BYTES);
      const proof = b?.proof ? parseQr(b.proof, "screenshot") : null;
      if (proof?.error) return fail(proof.error);
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
      // Money already sent to this person and waiting for them to confirm
      // counts against what can still be paid.
      const waiting = Number((await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS c FROM appx_settlements WHERE group_id=? AND from_member_id=? AND to_member_id=? AND status='pending'").bind(gid, from, to).first())?.c || 0);
      if (waiting) {
        const due = outstandingDebt(computePairwiseDebts(await loadLedger(db, gid)), from, to);
        if (cents > due - waiting) return fail(`₹${(waiting / 100).toFixed(2)} is already waiting for ${byId.get(to).name} to confirm, so at most ₹${(Math.max(0, due - waiting) / 100).toFixed(2)} more can be recorded now.`, 409);
      }
      // The receiver has to confirm a payment before it counts, unless the
      // receiver is the one recording it, or (admin only) can no longer sign
      // in to confirm it.
      const status = to === u.id || (isAdmin && !byId.get(to).active) ? "confirmed" : "pending";
      // Re-check the outstanding amount inside the INSERT itself so two
      // concurrent payments can never overpay the same debt.
      const settlementId = id(), now = Date.now();
      const result = await db.prepare(
        "INSERT INTO appx_settlements(id,group_id,from_member_id,to_member_id,amount_cents,created_by,created_at,status,decided_by,decided_at) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE ?5 <= " + owedSql("?2", "?3", "?4", true)
      ).bind(settlementId, gid, from, to, cents, u.id, now, status, status === "confirmed" ? u.id : null, status === "confirmed" ? now : null).run();
      if (changesOf(result) !== 1) return fail("The outstanding amount changed. Refresh and try again.", 409);
      if (proof) await db.prepare("INSERT INTO appx_payment_proofs(settlement_id,mime,base64,created_at) VALUES(?,?,?,?)").bind(settlementId, proof.mime, proof.base64, now).run();
      // Tell the receiver (to confirm it) and, if someone else recorded it, the payer.
      const nm = x => byId.get(x)?.name || FORMER_MEMBER, notes = [];
      if (to !== u.id) notes.push(note({ to, groupId: gid, kind: status === "pending" ? "payment_pending" : "payment_recorded", actor: u.name,
        title: status === "pending" ? `${nm(from)} says they paid you ${inrText(cents)}` : `${u.name} recorded ${inrText(cents)} from ${nm(from)} to you`,
        body: status === "pending" ? (proof ? "They attached a screenshot. Confirm it once you've received it." : "Confirm it once you've received it.") : "It counts in your balance now.", link: "#/" }));
      if (from !== u.id) notes.push(note({ to: from, groupId: gid, kind: "payment_recorded", actor: u.name,
        title: `${u.name} recorded your payment of ${inrText(cents)} to ${to === u.id ? "them" : nm(to)}`,
        body: status === "pending" ? `It counts once ${nm(to)} confirms it.` : "It counts in your balance now.", link: `#/g/${gid}/payments` }));
      if (notes.length) await db.batch(notes);
      return json({ ok: true, id: settlementId, amountCents: cents, status }, 201);
    }
    // The receiver (or the admin) confirms or rejects a pending payment; the
    // payer (or the admin) can cancel it while it is still pending.
    // The screenshot attached to a payment, for people in the group.
    const proofImage = tail.match(/^settlements\/([\w-]+)\/proof$/);
    if (method === "GET" && proofImage) {
      const r = await db.prepare("SELECT p.mime,p.base64 FROM appx_payment_proofs p JOIN appx_settlements s ON s.id=p.settlement_id WHERE p.settlement_id=? AND s.group_id=?").bind(proofImage[1], gid).first();
      if (!r) return fail("No screenshot for this payment.", 404);
      return new Response(Uint8Array.from(atob(r.base64), c => c.charCodeAt(0)), { headers: { "content-type": r.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
    }
    const decide = tail.match(/^settlements\/([\w-]+)\/(confirm|reject|cancel)$/);
    if (method === "POST" && decide) {
      const [, sid, action] = decide;
      const pay = await db.prepare("SELECT id,from_member_id AS fromId,to_member_id AS toId,amount_cents AS cents,status,created_by AS createdBy FROM appx_settlements WHERE id=? AND group_id=?").bind(sid, gid).first();
      if (!pay) return fail("Payment not found.", 404);
      if (pay.status !== "pending") return fail(`This payment was already ${pay.status}.`, 409);
      const now = Date.now();
      const nm = nameLookup(await groupMembers(db, gid));
      const tell = (to, kind, title, body, link = `#/g/${gid}/payments`) => to === u.id ? Promise.resolve() : db.batch([note({ to, groupId: gid, kind, title, body, link, actor: u.name })]);
      if (action === "cancel") {
        if (!isAdmin && pay.fromId !== u.id) return fail("Only the person who paid or the admin can cancel this payment.", 403);
        await db.batch([
          db.prepare("DELETE FROM appx_payment_proofs WHERE settlement_id=?").bind(sid),
          db.prepare("DELETE FROM appx_settlements WHERE id=? AND status='pending'").bind(sid),
        ]);
        await tell(pay.toId, "payment_cancelled", `${u.id === pay.fromId ? nm(pay.fromId) : u.name} cancelled a payment of ${inrText(pay.cents)}`, "You don't need to confirm it any more.");
        return json({ ok: true, cancelled: true });
      }
      if (!isAdmin && pay.toId !== u.id) return fail("Only the person who received this payment can confirm or reject it.", 403);
      if (action === "reject") {
        await db.prepare("UPDATE appx_settlements SET status='rejected',decided_by=?,decided_at=? WHERE id=? AND status='pending'").bind(u.id, now, sid).run();
        await tell(pay.fromId, "payment_rejected", `${u.name} said they didn't receive your ${inrText(pay.cents)}`, "It doesn't count. Check with them and record it again if needed.");
        return json({ ok: true, status: "rejected" });
      }
      // Confirm only while it still fits what is owed (expenses may have changed).
      const result = await db.prepare("UPDATE appx_settlements SET status='confirmed',decided_by=?1,decided_at=?2 WHERE id=?3 AND status='pending' AND amount_cents <= " + owedSql("?4", "?5", "?6")).bind(u.id, now, sid, gid, pay.fromId, pay.toId).run();
      if (changesOf(result) !== 1) return fail("This payment is now more than what is owed, because expenses changed since it was sent. Reject it and ask for a new one.", 409);
      await tell(pay.fromId, "payment_confirmed", `${u.name} confirmed your payment of ${inrText(pay.cents)}`, "It counts in your balance now.");
      return json({ ok: true, status: "confirmed" });
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
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": url.origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    if (url.pathname.startsWith("/api/")) {
      // Browsers send Origin on cross-site POSTs; refuse writes from other sites.
      const origin = req.headers.get("Origin");
      if (req.method !== "GET" && req.method !== "HEAD" && origin && origin !== url.origin) return fail("Cross-site request refused.", 403);
      try {
        // Notifications written by this request also go to phones, after
        // the response (in tests, with no ctx, before it).
        const outbox = [];
        const res = await api(req, env, url, outbox);
        if (outbox.length && res.status < 400 && pushEnabled(env)) {
          const sending = sendPushes(env, env['split-expense'], outbox).catch(e => console.error("push", String(e)));
          if (ctx?.waitUntil) ctx.waitUntil(sending); else await sending;
        }
        return res;
      } catch (e) {
        if (e instanceof HttpError) return fail(e.message, e.status);
        console.error("API error:", String(e));
        return json({ error: "Server error. Check Worker logs.", detail: env.ENVIRONMENT === "development" ? String(e) : undefined }, 500);
      }
    }
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(req);
      // Hashed build files never change, so cache them for a year; the HTML
      // shell must always be revalidated so a new deploy shows up immediately.
      const headers = new Headers(res.headers);
      headers.set("cache-control", url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
    return new Response("Split It API is running. Configure the static assets binding.", { status: 200, headers: { "content-type": "text/plain" } });
  },
};
