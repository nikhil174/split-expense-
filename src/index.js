import { allocateEqualSplit, allocateManualSplit } from "./split-logic.js";
import { pushEnabled, sendPushes, validSubscription } from "./push.js";
import { parseAmountToCents } from "./money.js";
import { computeBalances, computePairwiseDebts, debtsForMember, outstandingDebt, pairwiseActivity, validateSettlement, SettlementError } from "./settlement-logic.js";

// Signed-in sessions last 30 days (the PIN is asked again after that).
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SPLIT_MEMBERS = 100;
const MINUTE = 60 * 1000;
const RATE_LIMITS = {
  signin: { limit: 20, windowMs: 15 * MINUTE },
  adminKey: { limit: 10, windowMs: 15 * MINUTE },
  signup: { limit: 10, windowMs: 60 * MINUTE },
  link: { limit: 10, windowMs: 60 * MINUTE },
  invite: { limit: 40, windowMs: 10 * MINUTE },
  groupWrite: { limit: 20, windowMs: 10 * MINUTE },
  expenseWrite: { limit: 60, windowMs: 10 * MINUTE },
  settlementWrite: { limit: 30, windowMs: 10 * MINUTE },
  paymentMethodWrite: { limit: 20, windowMs: 10 * MINUTE },
};
// A member who is in the group now (may be chosen for expenses and payments).
// People who left or were removed keep their appx_group_members row (status
// 'removed') so history still shows their name. Expects the row aliased `m`.
const ACTIVE_MEMBER_SQL = "(m.status='active')";
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
// Checks a person's PIN against their account, counting failures and locking
// the account for a while after too many. Returns an error Response, or null
// when the PIN is correct (or was just created, for accounts from before PINs).
async function checkMemberPin(db, env, r, pin, { create = false } = {}) {
  const now = Date.now();
  if (r.pin_locked_until && r.pin_locked_until > now) {
    const mins = Math.ceil((r.pin_locked_until - now) / MINUTE);
    return fail(`Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, 429);
  }
  if (!r.pin_hash) {
    // Existing member from before PINs: they choose one now.
    if (!create) return json({ error: "Create a 4-digit PIN for your account.", code: "pin_not_set" }, 409);
    await db.prepare("UPDATE appx_users SET pin_hash=?,pin_failures=0,pin_locked_until=NULL WHERE id=? AND pin_hash IS NULL").bind(await hashPin(pin, env), r.id).run();
    const saved = await db.prepare("SELECT pin_hash FROM appx_users WHERE id=?").bind(r.id).first();
    // Someone else set it a moment earlier: their PIN wins, so check against it.
    return await pinMatches(pin, saved?.pin_hash, env) ? null : fail("Incorrect PIN.", 401);
  }
  if (await pinMatches(pin, r.pin_hash, env)) {
    if (r.pin_failures) await db.prepare("UPDATE appx_users SET pin_failures=0,pin_locked_until=NULL WHERE id=?").bind(r.id).run();
    return null;
  }
  const failures = Number(r.pin_failures || 0) + 1, locked = failures >= PIN_MAX_FAILURES;
  await db.prepare("UPDATE appx_users SET pin_failures=?,pin_locked_until=? WHERE id=?").bind(locked ? 0 : failures, locked ? now + PIN_LOCK_MS : null, r.id).run();
  if (locked) return fail("Too many wrong PINs. Try again in 15 minutes.", 429);
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

// The signed-in person, from their session cookie, or null.
async function requireUser(req, env) {
  const raw = cookie(req, "split_user");
  if (!raw) return null;
  const db = env['split-expense'], tokenHash = await hash(raw);
  const s = await db.prepare("SELECT s.expires_at,s.admin_until,u.id,u.display_name,u.username,u.email,u.legacy,u.site_role,u.pin_hash IS NOT NULL AS hasPin FROM appx_user_sessions s JOIN appx_users u ON u.id=s.user_id WHERE s.token_hash=?").bind(tokenHash).first();
  if (!s || s.expires_at < Date.now()) {
    if (s) await db.prepare("DELETE FROM appx_user_sessions WHERE token_hash=?").bind(tokenHash).run();
    return null;
  }
  const siteAdmin = s.site_role === "admin";
  return { id: s.id, name: s.display_name, username: s.username, email: s.email || null, legacy: !!s.legacy, hasPin: !!s.hasPin,
    siteAdmin, adminUnlocked: siteAdmin && Number(s.admin_until) > Date.now(), tokenHash };
}
// Starts a session for an account and returns the response that sets its cookie.
async function startSession(db, userId, data = { ok: true }, status = 200) {
  const token = id() + id(), expires = Date.now() + SESSION_MS;
  await db.prepare("INSERT INTO appx_user_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(await hash(token), userId, expires).run();
  try { await db.prepare("DELETE FROM appx_user_sessions WHERE expires_at<?").bind(Date.now()).run(); } catch {}
  return json(data, status, { "set-cookie": setCookie("split_user", token, SESSION_MS / 1000) });
}
// siteAdmin: may open the Admin tab (the site owner); adminUnlocked: this
// session entered the admin key. Nobody else learns the Admin tab exists.
const userOut = u => ({ id: u.id, name: u.name, username: u.username, email: u.email, legacy: u.legacy, hasPin: u.hasPin, ...(u.siteAdmin && { siteAdmin: true, adminUnlocked: u.adminUnlocked }) });
const ADMIN_UNLOCK_MS = 12 * 60 * 60 * 1000;

// Usernames: 3–30 characters, lowercase letters, digits, "_" and ".",
// starting with a letter. Stored lowercase; "@vicky" and "Vicky" mean "vicky".
const USERNAME_RE = /^[a-z][a-z0-9_.]{2,29}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,}$/;
const normUsername = v => String(v ?? "").trim().replace(/^@/, "").toLowerCase();
const normEmail = v => String(v ?? "").trim().toLowerCase();
// A username or email typed to find someone (sign-in, invites, linking).
async function findUser(db, login) {
  const v = String(login ?? "").trim();
  if (!v) return null;
  const cols = "id,username,display_name,email,pin_hash,pin_failures,pin_locked_until,legacy";
  if (v.includes("@") && !v.startsWith("@")) return db.prepare(`SELECT ${cols} FROM appx_users WHERE email=?`).bind(normEmail(v)).first();
  return db.prepare(`SELECT ${cols} FROM appx_users WHERE username=?`).bind(normUsername(v)).first();
}
// Accounts from before usernames: found by a group's name and their name in it.
async function findLegacyUser(db, groupName, name) {
  const r = await db.prepare("SELECT DISTINCT u.id,u.username,u.display_name,u.email,u.pin_hash,u.pin_failures,u.pin_locked_until,u.legacy FROM appx_group_members m JOIN appx_groups g ON g.id=m.group_id JOIN appx_users u ON u.id=m.member_id WHERE lower(trim(g.name))=lower(?) AND lower(m.name)=lower(?) AND m.status IN ('active','pending') AND u.legacy=1 LIMIT 2").bind(cleanName(groupName), cleanName(name)).all();
  return r.results.length === 1 ? r.results[0] : r.results.length ? "ambiguous" : null;
}
// Checks a sign-in PIN, including the two one-time cases for accounts from
// before this version: the old administrator proves who they are with the old
// admin PIN and then chooses a 4-digit PIN; members without a PIN create one.
async function signInChecks(db, env, user, b) {
  const pin = textField(b?.pin);
  if (!user.pin_hash && user.id === "admin") {
    if (!env.ADMIN_PIN || !await secretEquals(pin, String(env.ADMIN_PIN))) return fail("Incorrect PIN.", 401);
    const newPin = textField(b?.newPin);
    if (!PIN_RE.test(newPin)) return json({ error: "Choose a 4-digit PIN for your account. You'll use it from now on instead of the admin PIN.", code: "choose_pin" }, 409);
    await db.prepare("UPDATE appx_users SET pin_hash=?,pin_failures=0,pin_locked_until=NULL WHERE id='admin' AND pin_hash IS NULL").bind(await hashPin(newPin, env)).run();
    return null;
  }
  if (!PIN_RE.test(pin)) return fail("Enter your 4-digit PIN.");
  return checkMemberPin(db, env, user, pin, { create: b?.createPin === true });
}

// Every member row ever added to the group (including people who left or
// were removed, so history keeps their names), with role and status.
async function groupMembers(db, gid) {
  const r = await db.prepare("SELECT m.member_id AS id,m.name,m.role,m.status,u.username FROM appx_group_members m LEFT JOIN appx_users u ON u.id=m.member_id WHERE m.group_id=? ORDER BY lower(m.name)").bind(gid).all();
  return r.results.map(x => ({ id: x.id, name: x.name, role: x.role, status: x.status, username: x.username || null, active: x.status === "active" }));
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

// A person changes their name: on their account and in every group they are
// or were in (so past expenses and payments, stored by id, show it too).
async function renameUser(db, uid, rawName) {
  const name = cleanName(rawName);
  if (name.length < 2 || name.length > 60) return fail("Name must be 2–60 characters.");
  await db.batch([
    db.prepare("UPDATE appx_users SET display_name=? WHERE id=?").bind(name, uid),
    db.prepare("UPDATE appx_group_members SET name=? WHERE member_id=?").bind(name, uid),
  ]);
  return name;
}

// Moves everything of account `from` into account `to` (the same person who
// had two accounts, e.g. one per group from before accounts existed). In a
// group where both are members, shares on the same expense are added together
// and payments between the two are dropped (they were to oneself), so group
// balances stay zero-sum. Returns the statements for one atomic batch.
async function mergeStatements(db, to, from) {
  const toName = (await db.prepare("SELECT display_name FROM appx_users WHERE id=?").bind(to).first())?.display_name;
  const groups = (await db.prepare("SELECT group_id,role,status,joined_at FROM appx_group_members WHERE member_id=?").bind(from).all()).results;
  const rank = { active: 3, pending: 2, invited: 1, removed: 0 };
  const out = [];
  for (const g of groups) {
    const gid = g.group_id, mine = await db.prepare("SELECT role,status FROM appx_group_members WHERE group_id=? AND member_id=?").bind(gid, to).first();
    const role = g.role === "admin" || mine?.role === "admin" ? "admin" : "member";
    const status = !mine || rank[g.status] > rank[mine.status] ? g.status : mine.status;
    const inGroup = "(SELECT id FROM appx_expenses WHERE group_id=?)";
    const between = "group_id=?1 AND ((from_member_id=?2 AND to_member_id=?3) OR (from_member_id=?3 AND to_member_id=?2))";
    out.push(
      db.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status,joined_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(group_id,member_id) DO UPDATE SET role=?4,status=?5").bind(gid, to, toName, role, status, g.joined_at ?? null),
      db.prepare("UPDATE appx_splits SET amount_cents=amount_cents+(SELECT x.amount_cents FROM appx_splits x WHERE x.expense_id=appx_splits.expense_id AND x.member_id=?1) WHERE member_id=?2 AND expense_id IN (SELECT expense_id FROM appx_splits WHERE member_id=?1) AND expense_id IN " + inGroup.replace("?", "?3")).bind(from, to, gid),
      db.prepare("DELETE FROM appx_splits WHERE member_id=?1 AND expense_id IN (SELECT expense_id FROM appx_splits WHERE member_id=?2) AND expense_id IN " + inGroup.replace("?", "?3")).bind(from, to, gid),
      db.prepare("UPDATE appx_splits SET member_id=?1 WHERE member_id=?2 AND expense_id IN " + inGroup.replace("?", "?3")).bind(to, from, gid),
      db.prepare("UPDATE appx_expenses SET paid_by=? WHERE group_id=? AND paid_by=?").bind(to, gid, from),
      db.prepare("UPDATE appx_expenses SET created_by=? WHERE group_id=? AND created_by=?").bind(to, gid, from),
      db.prepare("DELETE FROM appx_payment_proofs WHERE settlement_id IN (SELECT id FROM appx_settlements WHERE " + between + ")").bind(gid, to, from),
      db.prepare("DELETE FROM appx_settlements WHERE " + between).bind(gid, to, from),
      db.prepare("UPDATE appx_settlements SET from_member_id=? WHERE group_id=? AND from_member_id=?").bind(to, gid, from),
      db.prepare("UPDATE appx_settlements SET to_member_id=? WHERE group_id=? AND to_member_id=?").bind(to, gid, from),
      db.prepare("UPDATE appx_settlements SET created_by=? WHERE group_id=? AND created_by=?").bind(to, gid, from),
      db.prepare("UPDATE appx_settlements SET decided_by=? WHERE group_id=? AND decided_by=?").bind(to, gid, from),
      db.prepare("UPDATE appx_invites SET created_by=? WHERE group_id=? AND created_by=?").bind(to, gid, from),
      db.prepare("DELETE FROM appx_group_members WHERE group_id=? AND member_id=?").bind(gid, from),
    );
  }
  out.push(
    // Keep my UPI details; take theirs only if I have none.
    db.prepare("UPDATE OR IGNORE appx_payment_methods SET member_id=? WHERE member_id=?").bind(to, from),
    db.prepare("DELETE FROM appx_payment_methods WHERE member_id=?").bind(from),
    db.prepare("UPDATE appx_notifications SET recipient_id=? WHERE recipient_id=?").bind(to, from),
    db.prepare("UPDATE appx_push_subscriptions SET member_id=? WHERE member_id=?").bind(to, from),
    db.prepare("DELETE FROM appx_user_sessions WHERE user_id=?").bind(from),
    db.prepare("DELETE FROM appx_users WHERE id=?").bind(from),
  );
  return out;
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
function expenseNotes(note, { kind, gid, expenseId, actor, desc, cents, paidBy, splitRows, nameOf, alsoTell = [] }) {
  const verb = { expense_added: "added", expense_edited: "changed", expense_deleted: "deleted" }[kind];
  const people = new Set([paidBy, ...splitRows.map(r => r.memberId), ...alsoTell]);
  people.delete(actor.id);
  return [...people].map(to => {
    const share = splitRows.find(r => r.memberId === to)?.amountCents || 0;
    const effect = (paidBy === to ? cents : 0) - share;
    const body = kind === "expense_deleted" ? "It no longer counts in your balance."
      : `${paidBy === to ? "You" : nameOf(paidBy)} paid ${inrText(cents)} · ${effect > 0 ? `you get back ${inrText(effect)}` : effect < 0 ? `you owe ${inrText(-effect)}` : "you're not in the split"}`;
    // Opens that expense (expanded); a deleted one opens the group.
    const link = kind === "expense_deleted" || !expenseId ? `#/g/${gid}` : `#/g/${gid}/e/${expenseId}`;
    return note({ to, groupId: gid, kind, title: `${actor.name} ${verb} “${desc}”`, body, link, actor: actor.name });
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

// ----- Site owner console ("Admin" tab) -----
// Only the site owner's account (site_role 'admin'), and only after entering
// the admin key (the ADMIN_PIN secret) in this session. If no owner exists
// yet (a fresh install), the first account to enter the key becomes it.
// Everyone else gets 404, as if it didn't exist. It sees accounts and groups
// in summary, never anyone's expenses.
async function siteAdmin(req, env, url, u) {
  const db = env['split-expense'], p = url.pathname, method = req.method;
  const hidden = () => fail("Not found.", 404);
  if (method === "POST" && p === "/api/site-admin/unlock") {
    if (!u.siteAdmin && await db.prepare("SELECT 1 FROM appx_users WHERE site_role='admin'").first()) return hidden();
    if (!env.ADMIN_PIN) return fail("The admin key is not configured on the server.", 503);
    if (await rateLimited(db, "admin-key", u.id, RATE_LIMITS.adminKey) || await rateLimited(db, "admin-key", await clientKey(req), RATE_LIMITS.adminKey)) return tooMany();
    if (!await secretEquals(textField((await body(req))?.key), String(env.ADMIN_PIN))) return fail("That's not the admin key.", 401);
    await db.batch([
      ...(u.siteAdmin ? [] : [db.prepare("UPDATE appx_users SET site_role='admin' WHERE id=? AND NOT EXISTS (SELECT 1 FROM appx_users WHERE site_role='admin')").bind(u.id)]),
      db.prepare("UPDATE appx_user_sessions SET admin_until=? WHERE token_hash=?").bind(Date.now() + ADMIN_UNLOCK_MS, u.tokenHash),
    ]);
    if (!(await db.prepare("SELECT site_role FROM appx_users WHERE id=?").bind(u.id).first())?.site_role) return hidden();
    return json({ ok: true });
  }
  if (!u.siteAdmin) return hidden();
  if (method === "POST" && p === "/api/site-admin/lock") {
    await db.prepare("UPDATE appx_user_sessions SET admin_until=NULL WHERE token_hash=?").bind(u.tokenHash).run();
    return json({ ok: true });
  }
  if (!u.adminUnlocked) return json({ error: "Enter the admin key to open the Admin tab.", code: "admin_locked" }, 403);
  const q = cleanName(url.searchParams.get("q")).toLowerCase();
  if (method === "GET" && p === "/api/site-admin/overview") {
    const one = sql => db.prepare(sql).first();
    const [users, groups, expenses, spent, week] = await Promise.all([
      one("SELECT COUNT(*) AS n FROM appx_users"), one("SELECT COUNT(*) AS n FROM appx_groups"), one("SELECT COUNT(*) AS n FROM appx_expenses"),
      one("SELECT COALESCE(SUM(amount_cents),0) AS n FROM appx_expenses"),
      db.prepare("SELECT COUNT(*) AS n FROM appx_users WHERE created_at>?").bind(Date.now() - 7 * 24 * 60 * MINUTE).first(),
    ]);
    return json({ users: users.n, groups: groups.n, expenses: expenses.n, totalSpentCents: spent.n, newUsersThisWeek: week.n });
  }
  if (method === "GET" && p === "/api/site-admin/users") {
    const like = "%" + q.replace(/[%_\\]/g, "\\$&") + "%";
    const r = await db.prepare("SELECT u.id,u.display_name AS name,u.username,u.email,u.created_at AS createdAt,u.legacy,u.site_role='admin' AS siteAdmin,u.pin_hash IS NOT NULL AS hasPin,u.pin_locked_until>?2 AS locked,"
      + "(SELECT COUNT(*) FROM appx_group_members m WHERE m.member_id=u.id AND m.status='active') AS groupCount FROM appx_users u "
      + "WHERE ?1='%%' OR lower(u.username) LIKE ?1 ESCAPE '\\' OR lower(u.display_name) LIKE ?1 ESCAPE '\\' OR lower(COALESCE(u.email,'')) LIKE ?1 ESCAPE '\\' ORDER BY u.created_at DESC LIMIT 100").bind(like, Date.now()).all();
    return json({ users: r.results.map(x => ({ ...x, legacy: !!x.legacy, siteAdmin: !!x.siteAdmin, hasPin: !!x.hasPin, locked: !!x.locked })) });
  }
  // A forgotten PIN: a new temporary PIN, shown once to the admin to pass
  // on; it signs the person out everywhere and they change it in Profile.
  const reset = p.match(/^\/api\/site-admin\/users\/([\w-]+)\/reset-pin$/);
  if (method === "POST" && reset) {
    const who = await db.prepare("SELECT id,display_name FROM appx_users WHERE id=?").bind(reset[1]).first();
    if (!who) return fail("Account not found.", 404);
    const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");
    await db.batch([
      db.prepare("UPDATE appx_users SET pin_hash=?,pin_failures=0,pin_locked_until=NULL WHERE id=?").bind(await hashPin(pin, env), who.id),
      db.prepare("DELETE FROM appx_user_sessions WHERE user_id=? AND token_hash<>?").bind(who.id, u.tokenHash),
    ]);
    return json({ ok: true, name: who.display_name, temporaryPin: pin });
  }
  if (method === "GET" && p === "/api/site-admin/groups") {
    const like = "%" + q.replace(/[%_\\]/g, "\\$&") + "%";
    const r = await db.prepare("SELECT g.id,g.name,g.created_at AS createdAt,(SELECT COUNT(*) FROM appx_group_members m WHERE m.group_id=g.id AND m.status='active') AS memberCount,"
      + "(SELECT group_concat(m.name,', ') FROM appx_group_members m WHERE m.group_id=g.id AND m.status='active' AND m.role='admin') AS admins,"
      + "(SELECT COUNT(*) FROM appx_expenses e WHERE e.group_id=g.id) AS expenseCount,(SELECT COALESCE(SUM(amount_cents),0) FROM appx_expenses e WHERE e.group_id=g.id) AS totalCents,"
      + "(SELECT MAX(created_at) FROM appx_expenses e WHERE e.group_id=g.id) AS lastActivity FROM appx_groups g WHERE ?1='%%' OR lower(g.name) LIKE ?1 ESCAPE '\\' ORDER BY g.created_at DESC LIMIT 100").bind(like).all();
    return json({ groups: r.results });
  }
  return hidden();
}

async function api(req, env, url, outbox = []) {
  const db = env['split-expense'];
  // Every notification written during this request, also sent to phones
  // (see sendPushes) once the response is on its way.
  const note = n => { outbox.push(n); return notifyStmt(db, n); };
  const p = url.pathname, method = req.method;
  // ----- Accounts -----
  // Create an account: name, username (unique), optional email, 4-digit PIN.
  if (method === "POST" && p === "/api/auth/signup") {
    if (await rateLimited(db, "signup", await clientKey(req), RATE_LIMITS.signup)) return tooMany();
    const b = await body(req);
    const name = cleanName(b?.name), username = normUsername(b?.username), email = b?.email ? normEmail(b.email) : null, pin = textField(b?.pin);
    if (name.length < 2 || name.length > 60) return fail("Enter your name (2–60 characters).");
    if (!USERNAME_RE.test(username)) return fail("Usernames are 3–30 characters: letters, numbers, _ or ., starting with a letter.");
    if (email && (!EMAIL_RE.test(email) || email.length > 254)) return fail("Enter a valid email, or leave it empty.");
    if (!PIN_RE.test(pin)) return fail("Choose a 4-digit PIN.");
    if (await db.prepare("SELECT 1 FROM appx_users WHERE username=?").bind(username).first()) return fail("That username is taken. Try another.", 409);
    if (email && await db.prepare("SELECT 1 FROM appx_users WHERE email=?").bind(email).first()) return fail("That email is already used by another account. Sign in instead.", 409);
    const uid = id();
    try {
      await db.prepare("INSERT INTO appx_users(id,username,display_name,email,pin_hash,created_at) VALUES(?,?,?,?,?,?)").bind(uid, username, name, email, await hashPin(pin, env), Date.now()).run();
    } catch (e) {
      // Someone took the username or email a moment earlier.
      if (String(e).toLowerCase().includes("unique")) return fail("That username or email was just taken. Try again.", 409);
      throw e;
    }
    return startSession(db, uid, { ok: true, id: uid }, 201);
  }
  // Is this username free? (For the sign-up and profile forms.)
  if (method === "GET" && p === "/api/auth/username") {
    const username = normUsername(url.searchParams.get("u"));
    if (!USERNAME_RE.test(username)) return json({ username, valid: false, available: false });
    const taken = await db.prepare("SELECT id FROM appx_users WHERE username=?").bind(username).first();
    const me = await requireUser(req, env);
    return json({ username, valid: true, available: !taken || taken.id === me?.id });
  }
  // Sign in with username or email + PIN.
  if (method === "POST" && p === "/api/auth/signin") {
    if (await rateLimited(db, "signin", await clientKey(req), RATE_LIMITS.signin)) return tooMany();
    const b = await body(req);
    const user = await findUser(db, b?.login);
    if (!user) return fail("No account with that username or email. Check it, or create an account.", 404);
    const bad = await signInChecks(db, env, user, b);
    if (bad) return bad;
    return startSession(db, user.id, { ok: true, id: user.id, legacy: !!user.legacy });
  }
  // Accounts from before usernames: sign in with the group's name and your
  // name in it (then choose a username in your profile).
  if (method === "POST" && p === "/api/auth/legacy-signin") {
    if (await rateLimited(db, "signin", await clientKey(req), RATE_LIMITS.signin)) return tooMany();
    const b = await body(req);
    if (!cleanName(b?.group) || !cleanName(b?.name)) return fail("Enter the group's name and your name in it.");
    const user = await findLegacyUser(db, b?.group, b?.name);
    if (user === "ambiguous") return fail("More than one account matches. Sign in with your username instead, or ask a group admin for it.", 409);
    if (!user) return fail("No one with that name in a group with that name. Check both, or sign in with your username.", 404);
    const bad = await signInChecks(db, env, user, b);
    if (bad) return bad;
    return startSession(db, user.id, { ok: true, id: user.id, legacy: true });
  }
  if (method === "GET" && p === "/api/me") {
    const me = await requireUser(req, env);
    return json({ user: me ? userOut(me) : null });
  }
  if (method === "POST" && p === "/api/logout") {
    const raw = cookie(req, "split_user");
    if (raw) await db.prepare("DELETE FROM appx_user_sessions WHERE token_hash=?").bind(await hash(raw)).run();
    return json({ ok: true }, 200, { "set-cookie": setCookie("split_user", "", 0) });
  }
  const u = await requireUser(req, env);
  if (!u) return fail("Sign in to continue.", 401);
  if (p.startsWith("/api/site-admin/")) return siteAdmin(req, env, url, u);
  // Change my name, username and/or email.
  if (method === "POST" && p === "/api/me/profile") {
    if (await rateLimited(db, "profile", u.id, RATE_LIMITS.paymentMethodWrite)) return tooMany();
    const b = await body(req);
    if (b?.username !== undefined) {
      const username = normUsername(b.username);
      if (!USERNAME_RE.test(username)) return fail("Usernames are 3–30 characters: letters, numbers, _ or ., starting with a letter.");
      const taken = await db.prepare("SELECT id FROM appx_users WHERE username=?").bind(username).first();
      if (taken && taken.id !== u.id) return fail("That username is taken. Try another.", 409);
      // Choosing a username ends the one-time "group and name" sign-in.
      await db.prepare("UPDATE appx_users SET username=?,legacy=0 WHERE id=?").bind(username, u.id).run();
    }
    if (b?.email !== undefined) {
      const email = b.email ? normEmail(b.email) : null;
      if (email && (!EMAIL_RE.test(email) || email.length > 254)) return fail("Enter a valid email, or leave it empty.");
      const taken = email && await db.prepare("SELECT id FROM appx_users WHERE email=?").bind(email).first();
      if (taken && taken.id !== u.id) return fail("That email is already used by another account.", 409);
      await db.prepare("UPDATE appx_users SET email=? WHERE id=?").bind(email, u.id).run();
    }
    if (b?.name !== undefined) {
      const r = await renameUser(db, u.id, b.name);
      if (r instanceof Response) return r;
    }
    return json({ user: userOut(await requireUser(req, env)) });
  }
  // Kept for older app versions: change only my name.
  if (method === "POST" && p === "/api/me/name") {
    if (await rateLimited(db, "profile", u.id, RATE_LIMITS.paymentMethodWrite)) return tooMany();
    const r = await renameUser(db, u.id, (await body(req))?.name);
    return r instanceof Response ? r : json({ ok: true, id: u.id, name: r });
  }
  // Change my PIN (the current one is needed, if there is one).
  if (method === "POST" && p === "/api/me/pin") {
    if (await rateLimited(db, "signin", u.id, RATE_LIMITS.signin)) return tooMany();
    const b = await body(req), newPin = textField(b?.newPin);
    if (!PIN_RE.test(newPin)) return fail("Choose a 4-digit PIN.");
    const row = await db.prepare("SELECT id,pin_hash,pin_failures,pin_locked_until FROM appx_users WHERE id=?").bind(u.id).first();
    if (row.pin_hash) {
      if (!PIN_RE.test(textField(b?.currentPin))) return fail("Enter your current 4-digit PIN.");
      const bad = await checkMemberPin(db, env, row, textField(b?.currentPin));
      if (bad) return bad;
    }
    await db.prepare("UPDATE appx_users SET pin_hash=?,pin_failures=0,pin_locked_until=NULL WHERE id=?").bind(await hashPin(newPin, env), u.id).run();
    return json({ ok: true });
  }
  // "I had another account": prove it with that account's username (or its
  // group and name) and PIN, then everything of it moves into this account.
  if (method === "POST" && p === "/api/me/link") {
    if (await rateLimited(db, "link", u.id, RATE_LIMITS.link)) return tooMany();
    const b = await body(req);
    const other = b?.login ? await findUser(db, b.login) : await findLegacyUser(db, b?.group, b?.name);
    if (other === "ambiguous") return fail("More than one account matches. Use that account's username instead.", 409);
    if (!other) return fail("No account found. Check the username, or the group and name.", 404);
    if (other.id === u.id) return fail("That's the account you're signed in to.", 409);
    if (!other.pin_hash) return fail("That account has no PIN yet. Sign in to it once to create one, then link it here.", 409);
    if (!PIN_RE.test(textField(b?.pin))) return fail("Enter that account's 4-digit PIN.");
    const bad = await checkMemberPin(db, env, other, textField(b?.pin));
    if (bad) return bad;
    await db.batch(await mergeStatements(db, u.id, other.id));
    return json({ ok: true, merged: other.display_name });
  }
  // Anyone can create a group; they are its first admin.
  if (method === "POST" && p === "/api/groups") {
    if (await rateLimited(db, "group", u.id, RATE_LIMITS.groupWrite)) return tooMany();
    const name = cleanName((await body(req))?.name);
    if (name.length < 2 || name.length > 80) return fail("Group name must be 2–80 characters.");
    const gid = id(), now = Date.now();
    await db.batch([
      db.prepare("INSERT INTO appx_groups(id,name,created_at,created_by) VALUES(?,?,?,?)").bind(gid, name, now, u.id),
      db.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status,joined_at) VALUES(?,?,?,'admin','active',?)").bind(gid, u.id, u.name, now),
    ]);
    return json({ group: { id: gid, name } }, 201);
  }
  // Groups I've been invited to and haven't answered yet.
  if (method === "GET" && p === "/api/invitations") {
    const r = await db.prepare("SELECT g.id AS groupId,g.name AS groupName,COALESCE(i.name,'Someone') AS invitedBy,(SELECT COUNT(*) FROM appx_group_members x WHERE x.group_id=g.id AND x.status='active') AS memberCount FROM appx_group_members m JOIN appx_groups g ON g.id=m.group_id LEFT JOIN appx_group_members i ON i.group_id=m.group_id AND i.member_id=m.invited_by WHERE m.member_id=? AND m.status='invited' ORDER BY g.created_at DESC").bind(u.id).all();
    return json({ invitations: r.results });
  }
  const answer = p.match(/^\/api\/groups\/([\w-]+)\/invitation\/(accept|decline)$/);
  if (method === "POST" && answer) {
    const [, gid, action] = answer;
    const row = await db.prepare("SELECT m.status,g.name FROM appx_group_members m JOIN appx_groups g ON g.id=m.group_id WHERE m.group_id=? AND m.member_id=?").bind(gid, u.id).first();
    if (!row || row.status !== "invited") return fail("This invitation is no longer open.", 404);
    if (action === "decline") {
      await db.prepare("UPDATE appx_group_members SET status='removed' WHERE group_id=? AND member_id=? AND status='invited'").bind(gid, u.id).run();
      return json({ ok: true });
    }
    const admins = (await db.prepare("SELECT member_id FROM appx_group_members WHERE group_id=? AND role='admin' AND status='active'").bind(gid).all()).results.map(r => r.member_id);
    await db.batch([
      db.prepare("UPDATE appx_group_members SET status='active',name=?,joined_at=? WHERE group_id=? AND member_id=? AND status='invited'").bind(u.name, Date.now(), gid, u.id),
      ...admins.filter(a => a !== u.id).map(to => note({ to, groupId: gid, kind: "member_joined", title: `${u.name} joined “${row.name}”`, body: "They accepted your invitation.", link: `#/g/${gid}`, actor: u.name })),
    ]);
    return json({ ok: true, groupId: gid });
  }
  if (method === "GET" && p === "/api/groups") {
    const r = await db.prepare("SELECT g.id,g.name,"
      + "COALESCE((SELECT SUM(amount_cents) FROM appx_expenses WHERE group_id=g.id AND paid_by=?1),0)"
      + "-COALESCE((SELECT SUM(s.amount_cents) FROM appx_splits s JOIN appx_expenses e ON e.id=s.expense_id WHERE e.group_id=g.id AND s.member_id=?1),0)"
      + "+COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=g.id AND from_member_id=?1 AND status='confirmed'),0)"
      + "-COALESCE((SELECT SUM(amount_cents) FROM appx_settlements WHERE group_id=g.id AND to_member_id=?1 AND status='confirmed'),0) AS myBalanceCents"
      + ",m.role,(SELECT COUNT(*) FROM appx_group_members x WHERE x.group_id=g.id AND x.status='active') AS memberCount "
      + "FROM appx_groups g JOIN appx_group_members m ON m.group_id=g.id WHERE m.member_id=?1 AND m.status='active' ORDER BY g.created_at DESC").bind(u.id).all();
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
  const gm = p.match(/^\/api\/groups\/([\w-]+)(?:\/(.*))?$/);
  if (gm) {
    const gid = gm[1], tail = gm[2] || "";
    // Every group route requires the caller to be in this group now.
    const member = await db.prepare("SELECT m.role FROM appx_group_members m WHERE m.group_id=? AND m.member_id=? AND " + ACTIVE_MEMBER_SQL).bind(gid, u.id).first();
    if (!member) return fail("Group not found or you do not have access.", 404);
    // Admins of this group may edit or delete anything in it, decide any
    // payment, and manage who is in it. Being admin is per group.
    const isAdmin = member.role === "admin";
    if (method === "GET" && !tail) {
      const g = await db.prepare("SELECT id,name FROM appx_groups WHERE id=?").bind(gid).first();
      const all = await groupMembers(db, gid);
      const pick = x => ({ id: x.id, name: x.name, username: x.username, role: x.role, status: x.status });
      return json({
        group: g,
        members: all.filter(x => x.active).map(pick),
        // Only admins see who is waiting: asked to join, or invited and not answered.
        waiting: isAdmin ? all.filter(x => x.status === "pending" || x.status === "invited").map(pick) : [],
        me: { id: u.id, name: u.name, isAdmin, role: member.role },
      });
    }
    // ----- Group admin: who is in the group -----
    const needAdmin = () => fail("Only a group admin can do that.", 403);
    // Invite someone already on Split It by their username or email. They
    // join when they accept. Someone who asked to join is let in straight away.
    if (method === "POST" && tail === "members/invite") {
      if (!isAdmin) return needAdmin();
      if (await rateLimited(db, "invite", u.id, RATE_LIMITS.invite)) return tooMany();
      const login = textField((await body(req))?.login).trim();
      if (!login) return fail("Enter a username or email.");
      const who = await findUser(db, login);
      if (!who) return fail(`No one on Split It has the ${login.includes("@") && !login.startsWith("@") ? "email" : "username"} “${login}”. Check it, or ask them to create an account first.`, 404);
      const g = await db.prepare("SELECT name FROM appx_groups WHERE id=?").bind(gid).first();
      const row = await db.prepare("SELECT status FROM appx_group_members WHERE group_id=? AND member_id=?").bind(gid, who.id).first();
      if (row?.status === "active") return fail(`${who.display_name} is already in this group.`, 409);
      if (row?.status === "invited") return fail(`${who.display_name} is already invited. They'll see it when they open Split It.`, 409);
      if (row?.status === "pending") {
        await db.batch([
          db.prepare("UPDATE appx_group_members SET status='active',joined_at=? WHERE group_id=? AND member_id=?").bind(Date.now(), gid, who.id),
          note({ to: who.id, groupId: gid, kind: "approved", title: `You're in “${g.name}”`, body: `${u.name} let you in. Add expenses and settle up here.`, link: `#/g/${gid}`, actor: u.name }),
        ]);
        return json({ ok: true, status: "active", name: who.display_name });
      }
      await db.batch([
        db.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status,invited_by) VALUES(?1,?2,?3,'member','invited',?4) ON CONFLICT(group_id,member_id) DO UPDATE SET status='invited',role='member',invited_by=?4,name=?3").bind(gid, who.id, who.display_name, u.id),
        note({ to: who.id, groupId: gid, kind: "group_invite", title: `${u.name} invited you to “${g.name}”`, body: "Open Split It to accept or decline.", link: "#/", actor: u.name }),
      ]);
      return json({ ok: true, status: "invited", name: who.display_name });
    }
    const manage = tail.match(/^members\/([\w-]+)\/(approve|reject|remove|cancel-invite|make-admin|make-member)$/);
    if (method === "POST" && manage) {
      if (!isAdmin) return needAdmin();
      const [, mid, action] = manage;
      const row = await db.prepare("SELECT m.member_id,m.name,m.role,m.status,g.name AS groupName FROM appx_group_members m JOIN appx_groups g ON g.id=m.group_id WHERE m.group_id=? AND m.member_id=?").bind(gid, mid).first();
      if (!row) return fail("That person is not in this group.", 404);
      const admins = Number((await db.prepare("SELECT COUNT(*) AS n FROM appx_group_members WHERE group_id=? AND role='admin' AND status='active'").bind(gid).first()).n);
      const lastAdmin = row.role === "admin" && row.status === "active" && admins <= 1;
      const set = (sql, ...args) => db.prepare("UPDATE appx_group_members SET " + sql + " WHERE group_id=? AND member_id=?").bind(...args, gid, mid);
      if (action === "approve" || action === "reject") {
        if (row.status !== "pending") return fail("This person isn't waiting to join.", 409);
        await db.batch(action === "approve"
          ? [set("status='active',joined_at=?", Date.now()), note({ to: mid, groupId: gid, kind: "approved", title: `You're in “${row.groupName}”`, body: `${u.name} approved you. Add expenses and settle up here.`, link: `#/g/${gid}`, actor: u.name })]
          : [set("status='removed'")]);
        return json({ ok: true });
      }
      if (action === "cancel-invite") {
        if (row.status !== "invited") return fail("This person has no open invitation.", 409);
        await db.batch([set("status='removed'")]);
        return json({ ok: true });
      }
      if (row.status !== "active") return fail(`${row.name} is not in the group right now.`, 409);
      if (action === "remove") {
        if (mid === u.id) return fail("To leave the group yourself, use Leave group.", 409);
        if (lastAdmin) return fail("Make someone else an admin first.", 409);
        // Their expenses and payments stay; balances with them can still be settled by an admin.
        await db.batch([set("status='removed',role='member'"), note({ to: mid, groupId: gid, kind: "removed", title: `You were removed from “${row.groupName}”`, body: `${u.name} removed you from the group.`, link: "#/", actor: u.name })]);
        return json({ ok: true });
      }
      if (action === "make-admin") {
        if (row.role === "admin") return json({ ok: true });
        await db.batch([set("role='admin'"), note({ to: mid, groupId: gid, kind: "made_admin", title: `You're now an admin of “${row.groupName}”`, body: `${u.name} made you an admin. You can manage members and edit anything in the group.`, link: `#/g/${gid}`, actor: u.name })]);
        return json({ ok: true });
      }
      // make-member
      if (lastAdmin) return fail("A group needs at least one admin. Make someone else an admin first.", 409);
      await db.batch([set("role='member'")]);
      return json({ ok: true });
    }
    if (method === "POST" && tail === "leave") {
      const admins = Number((await db.prepare("SELECT COUNT(*) AS n FROM appx_group_members WHERE group_id=? AND role='admin' AND status='active'").bind(gid).first()).n);
      const others = Number((await db.prepare("SELECT COUNT(*) AS n FROM appx_group_members WHERE group_id=? AND status='active' AND member_id<>?").bind(gid, u.id).first()).n);
      if (isAdmin && admins <= 1 && others > 0) return fail("You're the only admin. Make someone else an admin before you leave.", 409);
      await db.prepare("UPDATE appx_group_members SET status='removed',role='member' WHERE group_id=? AND member_id=?").bind(gid, u.id).run();
      return json({ ok: true });
    }
    if (method === "POST" && tail === "rename") {
      if (!isAdmin) return needAdmin();
      const name = cleanName((await body(req))?.name);
      if (name.length < 2 || name.length > 80) return fail("Group name must be 2–80 characters.");
      await db.prepare("UPDATE appx_groups SET name=? WHERE id=?").bind(name, gid).run();
      return json({ ok: true, group: { id: gid, name } });
    }
    // Deletes the group and everything in it. Children first: D1 enforces
    // foreign keys.
    if (method === "POST" && tail === "delete") {
      if (!isAdmin) return needAdmin();
      const g = await db.prepare("SELECT name FROM appx_groups WHERE id=?").bind(gid).first();
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
        ...expenseNotes(note, { kind: "expense_added", gid, expenseId: eid, actor: u, desc, cents, paidBy, splitRows, nameOf }),
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
      if (!isAdmin && e.paid_by !== u.id) return fail("Only the person who paid for this expense or a group admin can edit it.", 403);
      const parsed = await parseExpense(db, gid, await body(req));
      if (parsed.error) return fail(parsed.error);
      const { desc, cents, paidBy, splitRows } = parsed;
      // People taken out of the split hear about it too.
      const before = (await db.prepare("SELECT member_id FROM appx_splits WHERE expense_id=?").bind(e.id).all()).results.map(r => r.member_id);
      await db.batch([
        ...expenseNotes(note, { kind: "expense_edited", gid, expenseId: e.id, actor: u, desc, cents, paidBy, splitRows, nameOf: nameLookup(await groupMembers(db, gid)), alsoTell: [e.paid_by, ...before] }),
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
      if (!isAdmin && e.paid_by !== u.id) return fail("Only the person who paid for this expense or a group admin can delete it.", 403);
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
      if (!isAdmin && !byId.get(to).active) return fail(byId.get(to).name + " is no longer in this group. Ask a group admin to record this payment.", 409);
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
        // Pending: the group, where the approve card is on top; otherwise what's between you two.
        body: status === "pending" ? (proof ? "They attached a screenshot. Confirm it once you've received it." : "Confirm it once you've received it.") : "It counts in your balance now.", link: status === "pending" ? `#/g/${gid}` : `#/g/${gid}/p/${from}` }));
      if (from !== u.id) notes.push(note({ to: from, groupId: gid, kind: "payment_recorded", actor: u.name,
        title: `${u.name} recorded your payment of ${inrText(cents)} to ${to === u.id ? "them" : nm(to)}`,
        body: status === "pending" ? `It counts once ${nm(to)} confirms it.` : "It counts in your balance now.", link: `#/g/${gid}/p/${to}` }));
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
      // Each side is taken to what's between them and the other person.
      const tell = (to, kind, title, body) => to === u.id ? Promise.resolve() : db.batch([note({ to, groupId: gid, kind, title, body, link: `#/g/${gid}/p/${to === pay.fromId ? pay.toId : pay.fromId}`, actor: u.name })]);
      if (action === "cancel") {
        if (!isAdmin && pay.fromId !== u.id) return fail("Only the person who paid or a group admin can cancel this payment.", 403);
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
