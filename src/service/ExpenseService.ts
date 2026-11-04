// Expenses: adding, editing and deleting them (each logged in the group's
// history and told to everyone in them), listing, and their photos (a
// receipt, a bill, proof of what was bought).
import type { Expense, HistoryEntry } from "../../shared/api-types.ts";
import type { Clock } from "../config/Clock.ts";
import { MAX_EXPENSE_PHOTOS, MAX_SPLIT_MEMBERS } from "../config/constants.ts";
import type { Untrusted } from "../domain/input.ts";
import { nameLookup } from "../domain/members.ts";
import { parseAmountToCents, rupees } from "../domain/money.ts";
import { allocateEqualSplit, allocateManualSplit, type ShareRow } from "../domain/split.ts";
import { cleanName } from "../domain/text.ts";
import { textField } from "../domain/text.ts";
import { ApiError, forbidden, notFound } from "../http/ApiError.ts";
import type { ExpensePhotoRepository } from "../repository/ExpensePhotoRepository.ts";
import type { ExpenseRepository } from "../repository/ExpenseRepository.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { HistoryRepository } from "../repository/HistoryRepository.ts";
import type { Transaction } from "../repository/Transaction.ts";
import { newId } from "../security/crypto.ts";
import type { GroupScope } from "./GroupScope.ts";
import type { Notifier } from "./Notifier.ts";
import { parseImage } from "./PaymentMethodService.ts";

// An add/edit request: equal split among memberIds, or exact amounts per
// person (splitMode "manual", allocations [{ memberId, amount }]).
// Either may carry photos: new ones as image data URLs (photos), and on edit
// the ids of attached ones to take off (removePhotoIds).
export type ExpenseRequest = Untrusted<"description" | "amount" | "paidBy" | "splitMode" | "memberIds" | "allocations" | "photos" | "removePhotoIds">;
export type ExpenseInput = { desc: string; cents: number; paidBy: string; splitRows: ShareRow[] };
type Photo = { mime: string; base64: string };

// What an expense looked like, for the history log (with how many photos it
// had, when it had any).
const snapshot = (desc: string, cents: number, paidBy: string, splitRows: ShareRow[], photos = 0) => ({
  description: desc, amountCents: cents, paidBy, splits: splitRows.map(r => ({ memberId: r.memberId, amountCents: r.amountCents })), ...(photos ? { photos } : {}),
});

const tooManyPhotos = `Attach at most ${MAX_EXPENSE_PHOTOS} photos to an expense.`;

// New photos in a request: none when left out; each must be a real image.
function parsePhotos(value: unknown): Photo[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ApiError("Photos must be a list of images.");
  if (value.length > MAX_EXPENSE_PHOTOS) throw new ApiError(tooManyPhotos);
  return value.map(v => {
    const p = parseImage(v, "photo");
    if ("error" in p) throw new ApiError(p.error);
    return p;
  });
}

// Attached photos to take off on edit: ids of photos this expense has.
function parseRemovals(value: unknown, attached: string[]): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(v => typeof v !== "string")) throw new ApiError("Choose which photos to remove.");
  const ids = [...new Set(value as string[])];
  if (ids.some(id => !attached.includes(id))) throw new ApiError("That photo isn't on this expense.");
  return ids;
}

export class ExpenseService {
  private readonly tx: Transaction;
  private readonly expenses: ExpenseRepository;
  private readonly photos: ExpensePhotoRepository;
  private readonly groups: GroupRepository;
  private readonly historyLog: HistoryRepository;
  private readonly notify: Notifier;
  private readonly clock: Clock;
  constructor(deps: { clock: Clock; tx: Transaction; expenses: ExpenseRepository; photos: ExpensePhotoRepository; groups: GroupRepository; history: HistoryRepository; notify: Notifier }) {
    this.clock = deps.clock;
    this.tx = deps.tx; this.expenses = deps.expenses; this.photos = deps.photos; this.groups = deps.groups; this.historyLog = deps.history; this.notify = deps.notify;
  }

  // Validates an add/edit expense request body against the group's active
  // members.
  async parse(gid: string, b: ExpenseRequest): Promise<ExpenseInput> {
    const desc = cleanName(b?.description);
    if (!desc || desc.length > 160) throw new ApiError("Enter a description of up to 160 characters.");
    let cents: number;
    try { cents = parseAmountToCents(b?.amount); } catch (error) { throw new ApiError((error as Error).message); }
    const paidBy = textField(b?.paidBy);
    const active = new Set((await this.groups.members(gid)).filter(x => x.active).map(x => x.id));
    if (!active.has(paidBy)) throw new ApiError("Payer must be an active member of this group.");
    const splitMode = b?.splitMode ?? "equal";
    let splitRows: ShareRow[];
    if (splitMode === "manual") {
      if (!Array.isArray(b?.allocations) || b.allocations.length === 0) throw new ApiError("Enter at least one manual amount.");
      if (b.allocations.length > MAX_SPLIT_MEMBERS) throw new ApiError("Too many split members.");
      try {
        const allocations = b.allocations.map((item: Untrusted<"memberId" | "amount">) => ({ memberId: textField(item?.memberId), amountCents: parseAmountToCents(item?.amount, { allowZero: true }) }));
        splitRows = allocateManualSplit(cents, allocations, [...active]);
      } catch (error) { throw new ApiError((error as Error).message); }
    } else if (splitMode === "equal") {
      if (!Array.isArray(b?.memberIds) || b.memberIds.length > MAX_SPLIT_MEMBERS) throw new ApiError("Select at least one member to split this expense.");
      if (b.memberIds.some((x: unknown) => typeof x !== "string")) throw new ApiError("Split members must belong to this group.");
      const memberIds = [...new Set<string>(b.memberIds)];
      if (!memberIds.length) throw new ApiError("Select at least one member to split this expense.");
      if (memberIds.some(x => !active.has(x))) throw new ApiError("Split members must be active members of this group.");
      splitRows = allocateEqualSplit(cents, memberIds);
    } else {
      throw new ApiError("Split method must be equal or manual.");
    }
    // Zero shares carry no meaning; keep only real allocations.
    splitRows = splitRows.filter(row => row.amountCents > 0);
    if (splitRows.reduce((sum, row) => sum + row.amountCents, 0) !== cents) throw new Error("Split rows do not add up to the expense total");
    return { desc, cents, paidBy, splitRows };
  }

  async add(s: GroupScope, b: ExpenseRequest) {
    const { desc, cents, paidBy, splitRows } = await this.parse(s.gid, b);
    const photos = parsePhotos(b?.photos);
    const eid = newId(), now = this.clock.now();
    const nameOf = nameLookup(await this.groups.members(s.gid));
    await this.tx.run([
      this.expenses.insertStmt(eid, s.gid, desc, cents, paidBy, s.user.id, now),
      ...this.expenses.insertSplitStmts(eid, splitRows),
      ...this.photoInsertStmts(eid, photos, now),
      ...this.notify.expenseStmts({ kind: "expense_added", gid: s.gid, expenseId: eid, actor: s.user, desc, cents, paidBy, splitRows, nameOf }),
      this.historyLog.insertStmt({ gid: s.gid, entity: "expense", entityId: eid, action: "created", actor: s.user.id, after: snapshot(desc, cents, paidBy, splitRows, photos.length) }),
    ]);
    return { ok: true, id: eid, amountCents: cents, splits: splitRows };
  }

  // Edit replaces the description, amount, payer and whole split; the same
  // people who may delete an expense (its payer or an admin) may edit it.
  async edit(s: GroupScope, eid: string, body: () => Promise<ExpenseRequest>) {
    const e = await this.expenses.find(eid, s.gid);
    if (!e) throw notFound("Expense not found.");
    if (!s.isAdmin && e.paid_by !== s.user.id) throw forbidden("Only the person who paid for this expense or a group admin can edit it.");
    const b = await body();
    const { desc, cents, paidBy, splitRows } = await this.parse(s.gid, b);
    // Photos: keep the attached ones except those taken off, plus any new ones.
    const added = parsePhotos(b?.photos), attached = await this.photos.idsOf(e.id);
    const removed = parseRemovals(b?.removePhotoIds, attached);
    const photoCount = attached.length - removed.length + added.length;
    if (photoCount > MAX_EXPENSE_PHOTOS) throw new ApiError(tooManyPhotos);
    // People taken out of the split hear about it too.
    const oldSplits = await this.expenses.splitsSorted(e.id);
    const before = oldSplits.map(r => r.memberId);
    await this.tx.run([
      this.historyLog.insertStmt({ gid: s.gid, entity: "expense", entityId: e.id, action: "edited", actor: s.user.id, before: snapshot(e.description, e.amount_cents, e.paid_by, oldSplits, attached.length), after: snapshot(desc, cents, paidBy, splitRows, photoCount) }),
      ...removed.map(pid => this.photos.deleteStmt(pid, e.id)),
      ...this.photoInsertStmts(e.id, added, this.clock.now()),
      ...this.notify.expenseStmts({ kind: "expense_edited", gid: s.gid, expenseId: e.id, actor: s.user, desc, cents, paidBy, splitRows, nameOf: nameLookup(await this.groups.members(s.gid)), alsoTell: [e.paid_by, ...before] }),
      this.expenses.updateStmt(e.id, s.gid, desc, cents, paidBy),
      this.expenses.deleteSplitsStmt(e.id),
      ...this.expenses.insertSplitStmts(e.id, splitRows),
    ]);
    return { ok: true, id: e.id, amountCents: cents, splits: splitRows };
  }

  async delete(s: GroupScope, eid: string) {
    const e = await this.expenses.find(eid, s.gid);
    if (!e) throw notFound("Expense not found.");
    if (!s.isAdmin && e.paid_by !== s.user.id) throw forbidden("Only the person who paid for this expense or a group admin can delete it.");
    const oldSplits = await this.expenses.splits(e.id), photoCount = (await this.photos.idsOf(e.id)).length;
    await this.tx.run([
      ...this.notify.expenseStmts({ kind: "expense_deleted", gid: s.gid, actor: s.user, desc: e.description, cents: e.amount_cents, paidBy: e.paid_by, splitRows: oldSplits, nameOf: nameLookup(await this.groups.members(s.gid)) }),
      this.historyLog.insertStmt({ gid: s.gid, entity: "expense", entityId: e.id, action: "deleted", actor: s.user.id, before: snapshot(e.description, e.amount_cents, e.paid_by, oldSplits, photoCount) }),
      this.photos.deleteForExpenseStmt(e.id),
      this.expenses.deleteSplitsStmt(e.id),
      this.expenses.deleteStmt(e.id, s.gid),
    ]);
    return { ok: true, deleted: true };
  }

  // The group's expenses, newest first, each with its split and what it
  // means for me.
  async list(s: GroupScope): Promise<{ expenses: Expense[] }> {
    const u = s.user;
    const [members, r, splits, photos] = await Promise.all([this.groups.members(s.gid), this.expenses.list(s.gid), this.expenses.listSplits(s.gid), this.photos.idsForGroup(s.gid)]);
    const nameOf = nameLookup(members);
    const photoIds = new Map<string, string[]>();
    for (const p of photos.results) photoIds.set(p.expenseId, [...(photoIds.get(p.expenseId) || []), p.id]);
    const byExpense = new Map<string, { memberId: string; name: string; amountCents: number }[]>();
    for (const row of splits.results) {
      if (!byExpense.has(row.expenseId)) byExpense.set(row.expenseId, []);
      byExpense.get(row.expenseId)!.push({ memberId: row.memberId, name: nameOf(row.memberId), amountCents: row.amountCents });
    }
    const expenses = r.results.map(x => {
      const rows = (byExpense.get(x.id) || []).sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name));
      const myShareCents = rows.find(row => row.memberId === u.id)?.amountCents || 0;
      // Positive: others owe me on this expense ("you lent"); negative: I owe the payer ("you borrowed").
      const myEffectCents = x.paidBy === u.id ? x.amountCents - myShareCents : -myShareCents;
      return { ...x, amount: rupees(x.amountCents), paidByName: nameOf(x.paidBy), createdByName: nameOf(x.createdBy), splitCount: rows.length, splits: rows, photoIds: photoIds.get(x.id) || [], myShareCents, myEffectCents, canDelete: s.isAdmin || x.paidBy === u.id, canEdit: s.isAdmin || x.paidBy === u.id };
    });
    return { expenses };
  }

  // One photo of an expense, for anyone in the group.
  async photo(s: GroupScope, eid: string, pid: string) {
    const p = await this.photos.photo(pid, eid, s.gid);
    if (!p) throw notFound("Photo not found.");
    return p;
  }

  private photoInsertStmts(eid: string, photos: Photo[], now: number) {
    return photos.map((p, position) => this.photos.insertStmt({ id: newId(), eid, mime: p.mime, base64: p.base64, now, position }));
  }

  // The group's permanent history: expenses added, edited and deleted, and
  // payments cancelled, newest first; or one expense's.
  async history(s: GroupScope, expenseId: string | null): Promise<{ history: HistoryEntry[] }> {
    const rows = expenseId ? await this.historyLog.forExpense(s.gid, expenseId) : await this.historyLog.forGroup(s.gid);
    const nameOf = nameLookup(await this.groups.members(s.gid));
    const named = (x: string | null) => {
      if (!x) return null;
      const v = JSON.parse(x);
      for (const [k, out] of [["paidBy", "paidByName"], ["fromMemberId", "fromName"], ["toMemberId", "toName"], ["createdBy", "createdByName"]]) if (v[k]) v[out] = nameOf(v[k]);
      if (v.splits) v.splits = v.splits.map((r: { memberId: string }) => ({ ...r, name: nameOf(r.memberId) }));
      return v;
    };
    return { history: rows.map(r => ({ id: r.id, entity: r.entity, entityId: r.entity_id, action: r.action, actorId: r.actor_id, actorName: nameOf(r.actor_id), createdAt: r.created_at, before: named(r.before_json), after: named(r.after_json) })) };
  }
}
