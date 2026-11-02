// Read-only views of who owes whom: Home's balances across groups, a group's
// balances and dashboard, one member's summary, two members' history, and
// the statement behind "Share as Excel". All come from the same pairwise
// ledger, so the screens always agree.
import type { Balance, Dashboard, MemberSummary, PeopleBalances, PersonView, Statement, StatementItem } from "../../shared/api-types.ts";
import { nameLookup } from "../domain/members.ts";
import { rupees } from "../domain/money.ts";
import { PaymentStatus } from "../domain/payments.ts";
import { computeBalances, computePairwiseDebts, pairwiseActivity } from "../domain/settlement.ts";
import { notFound } from "../http/ApiError.ts";
import type { ExpenseRepository } from "../repository/ExpenseRepository.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { SettlementRepository } from "../repository/SettlementRepository.ts";
import type { CurrentUser } from "../repository/types.ts";
import type { GroupScope } from "./GroupScope.ts";

// A statement line before names are added (its running balance comes last).
type PairRow = Omit<StatementItem, "paidByName" | "fromName" | "toName" | "runningCents"> & { runningCents?: number };

const sumFor = (mid: string) => <T extends { amountCents: number }>(rows: T[], key: keyof T) => rows.filter(r => r[key] === mid).reduce((t, r) => t + r.amountCents, 0);

export class InsightsService {
  private readonly groups: GroupRepository;
  private readonly expenses: ExpenseRepository;
  private readonly settlements: SettlementRepository;
  constructor(deps: { groups: GroupRepository; expenses: ExpenseRepository; settlements: SettlementRepository }) {
    this.groups = deps.groups; this.expenses = deps.expenses; this.settlements = deps.settlements;
  }

  // Everyone I owe or who owes me, across all my groups, one row per person
  // per group. Same pairwise ledger as each group's debts.
  async home(u: CurrentUser): Promise<PeopleBalances> {
    const groups = (await this.groups.activeGroupsOf(u.id)).results;
    const people: { groupId: string; groupName: string; memberId: string; name: string; active: boolean; netCents: number; waitingOutCents: number; waitingInCents: number }[] = [];
    for (const g of groups) {
      const [members, ledger] = await Promise.all([this.groups.members(g.id), this.expenses.ledger(g.id)]);
      const nameOf = nameLookup(members);
      const active = new Set(members.filter(x => x.active).map(x => x.id));
      // Payments waiting for approval, by the other person: what I sent them
      // (waitingOutCents) and what they sent me (waitingInCents).
      const waiting = (await this.settlements.pendingTotalsFor(g.id, u.id)).results;
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
    return { people, owedToYouCents, youOweCents, netCents: owedToYouCents - youOweCents };
  }

  // Each member's net balance in the group (positive: the group owes them).
  async balances(s: GroupScope): Promise<{ balances: Balance[] }> {
    const [members, ledger] = await Promise.all([this.groups.members(s.gid), this.expenses.ledger(s.gid)]);
    const nameOf = nameLookup(members);
    const balances = computeBalances(ledger);
    for (const x of members) if (x.active && !balances.has(x.id)) balances.set(x.id, 0);
    return {
      balances: [...balances].map(([memberId, cents]) => ({ memberId, name: nameOf(memberId), balanceCents: cents, balance: rupees(cents) }))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    };
  }

  // Total spent, and what each person paid and their share.
  async dashboard(s: GroupScope): Promise<Dashboard> {
    const [members, ledger, total] = await Promise.all([this.groups.members(s.gid), this.expenses.ledger(s.gid), this.expenses.totals(s.gid)]);
    const nameOf = nameLookup(members);
    const paid = new Map<string, number>(), share = new Map<string, number>();
    for (const row of ledger.paidTotals) paid.set(row.memberId, (paid.get(row.memberId) || 0) + row.amountCents);
    for (const row of ledger.splitEdges) share.set(row.memberId, (share.get(row.memberId) || 0) + row.amountCents);
    const ids = new Set([...members.filter(x => x.active).map(x => x.id), ...paid.keys(), ...share.keys()]);
    const spending = [...ids].map(memberId => ({ memberId, name: nameOf(memberId), paidCents: paid.get(memberId) || 0, shareCents: share.get(memberId) || 0 }))
      .map(x => ({ ...x, paid: rupees(x.paidCents), share: rupees(x.shareCents) }))
      .sort((a, b) => b.paidCents - a.paidCents || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return { totalSpentCents: total!.cents, totalSpent: rupees(total!.cents), expenseCount: total!.count, spending };
  }

  // One member's whole picture in the group, for anyone in it (group
  // expenses are visible to all members anyway): totals, who they owe and
  // who owes them, every expense they are part of, and their payments.
  async member(s: GroupScope, mid: string): Promise<MemberSummary> {
    const [members, ledger] = await Promise.all([this.groups.members(s.gid), this.expenses.ledger(s.gid)]);
    const who = members.find(x => x.id === mid);
    if (!who) throw notFound("That person is not in this group.");
    const nameOf = nameLookup(members);
    const sum = sumFor(mid);
    const debts = computePairwiseDebts(ledger);
    const [expenses, payments] = await Promise.all([this.expenses.memberExpensesNewestFirst(s.gid, mid), this.settlements.memberPaymentsNewestFirst(s.gid, mid)]);
    return {
      member: { id: mid, name: who.name, active: who.active, isMe: mid === s.user.id },
      paidCents: sum(ledger.paidTotals, "memberId"),
      shareCents: sum(ledger.splitEdges, "memberId"),
      balanceCents: computeBalances(ledger).get(mid) || 0,
      owes: debts.filter(d => d.fromMemberId === mid).map(d => ({ memberId: d.toMemberId, name: nameOf(d.toMemberId), amountCents: d.amountCents })),
      owedBy: debts.filter(d => d.toMemberId === mid).map(d => ({ memberId: d.fromMemberId, name: nameOf(d.fromMemberId), amountCents: d.amountCents })),
      // effectCents: how the expense moved their balance (paid minus own share).
      expenses: expenses.results.map(x => ({ ...x, paidByName: nameOf(x.paidBy), effectCents: (x.paidBy === mid ? x.amountCents : 0) - x.shareCents })),
      payments: payments.results.map(x => ({ ...x, fromName: nameOf(x.fromMemberId), toName: nameOf(x.toMemberId) })),
    };
  }

  // Everything between two members: expenses where one paid and the other
  // had a share, and confirmed payments between them, with a running total
  // from a's side (positive: b owes a). a is me for "with", or any member.
  async pair(s: GroupScope, a: string, other: string, aIsMe: boolean): Promise<PersonView> {
    const members = await this.groups.members(s.gid);
    const nameOf = nameLookup(members);
    if (other === a || !members.some(x => x.id === other) || !members.some(x => x.id === a)) throw notFound("Choose two different members of this group.");
    const [shares, settlements] = await Promise.all([this.expenses.pairShares(s.gid, a, other), this.settlements.confirmedBetween(s.gid, a, other)]);
    const activity = pairwiseActivity({ shares: shares.results, settlements: settlements.results, me: a, other });
    const otherMember = members.find(x => x.id === other)!;
    return { me: { id: a, name: aIsMe ? s.user.name : nameOf(a) }, other: { id: other, name: nameOf(other), active: otherMember.active }, netCents: activity.netCents, items: activity.items };
  }

  // Everything for one person's statement (the "Share as Excel" export):
  // every expense they paid for or share in, oldest first, and, for each
  // other member, every expense and payment between the two of them with a
  // running balance. Payments not counted (waiting for approval, rejected)
  // are listed with their status. Anyone in the group may export it, like
  // the person summary and pair views.
  async statement(s: GroupScope, mid: string): Promise<Statement> {
    const gid = s.gid;
    const members = await this.groups.members(gid);
    const who = members.find(x => x.id === mid);
    if (!who) throw notFound("That person is not in this group.");
    const nameOf = nameLookup(members);
    const [expRows, shares, pays, ledger] = await Promise.all([
      this.expenses.memberExpensesOldestFirst(gid, mid), this.expenses.memberShares(gid, mid), this.settlements.memberPaymentsOldestFirst(gid, mid), this.expenses.ledger(gid),
    ]);
    let cumulative = 0;
    const expenses = expRows.results.map(x => {
      const shareCents = Number(x.shareCents);
      cumulative += shareCents;
      return { id: x.id, createdAt: x.createdAt, description: x.description, totalCents: Number(x.totalCents), paidBy: x.paidBy, paidByName: nameOf(x.paidBy), shareCents, splitCount: Number(x.splitCount), cumulativeShareCents: cumulative };
    });
    const others = members.filter(x => x.id !== mid && (x.active || shares.results.some(r => r.paidBy === x.id || r.memberId === x.id) || pays.results.some(r => r.fromMemberId === x.id || r.toMemberId === x.id)));
    const pairs = others.map(o => {
      const counted = pays.results.filter(r => r.status === PaymentStatus.Confirmed);
      const activity = pairwiseActivity({ shares: shares.results, settlements: counted, me: mid, other: o.id });
      const items: PairRow[] = activity.items.slice().reverse().map(it => ({ ...it, status: "counted" }));
      // Payments not counted yet (or never): listed, but they don't move the balance.
      for (const r of pays.results) {
        if (r.status === PaymentStatus.Confirmed || !((r.fromMemberId === mid && r.toMemberId === o.id) || (r.fromMemberId === o.id && r.toMemberId === mid))) continue;
        items.push({ type: "payment", id: r.id, fromMemberId: r.fromMemberId, toMemberId: r.toMemberId, amountCents: Number(r.amountCents), effectCents: 0, createdAt: r.createdAt, status: r.status });
      }
      items.sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)));
      let running = 0;
      for (const it of items) { running += it.effectCents; it.runningCents = running; }
      const named = (it: PairRow): StatementItem => ({ ...it, runningCents: it.runningCents!, paidByName: it.paidBy ? nameOf(it.paidBy) : undefined, fromName: it.fromMemberId ? nameOf(it.fromMemberId) : undefined, toName: it.toMemberId ? nameOf(it.toMemberId) : undefined });
      return { id: o.id, name: o.name, active: o.active, netCents: activity.netCents, items: items.map(named) };
    });
    const sum = sumFor(mid);
    return {
      group: { id: gid, name: s.name },
      person: { id: mid, name: who.name, username: who.username, active: who.active },
      generatedAt: Date.now(),
      // Positive: the group owes them; negative: they owe.
      totals: { paidCents: sum(ledger.paidTotals, "memberId"), shareCents: sum(ledger.splitEdges, "memberId"), balanceCents: computeBalances(ledger).get(mid) || 0 },
      expenses,
      pairs,
    };
  }
}
