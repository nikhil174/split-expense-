import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { ArrowLeft, ChevronRight, HandCoins, Plus, ReceiptText, Search, Trash2, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Amount, AnimatedAmount, DateBadge, EASE, EmptyState, Page, PersonAvatar, Segmented, SectionTitle, listItem } from "@/components/app/bits";
import { AddExpenseDrawer } from "./AddExpenseDrawer";
import { SettleUpDrawer } from "./SettleUpDrawer";
import { useBalances, useDashboard, useDebts, useDeleteExpense, useExpenses, useGroup, useMine, useSettlements } from "@/hooks/queries";
import type { Debt, Expense } from "@/lib/api";
import { inr, shortDate } from "@/lib/money";
import { goBack, navigate, type GroupTab } from "@/lib/route";
import { cn } from "@/lib/utils";

export function GroupScreen({ groupId, tab }: { groupId: string; tab: GroupTab }) {
  const group = useGroup(groupId);
  const mine = useMine(groupId);
  const [adding, setAdding] = React.useState(false);
  const [settling, setSettling] = React.useState(false);
  const net = mine.data ? mine.data.totalOwedToYouCents - mine.data.totalYouOweCents : 0;
  const ready = !!group.data && !!mine.data;

  if (group.error) {
    return <Page><EmptyState icon={<ReceiptText className="size-5" />} title="Can't open this group">{(group.error as Error).message}</EmptyState>
      <Button variant="secondary" className="mx-auto flex" onClick={() => navigate({ name: "home" })}>Back to groups</Button></Page>;
  }

  return (
    <Page>
      <section className="relative overflow-hidden rounded-3xl bg-hero p-5 text-hero-foreground shadow-xl shadow-primary/10">
        <div className="pointer-events-none absolute -top-20 -right-12 size-56 rounded-full bg-primary/40 blur-3xl" />
        <button type="button" onClick={() => goBack({ name: "home" })} className="-ml-1 inline-flex cursor-pointer items-center gap-1 rounded-lg px-1 py-1 text-sm text-white/70 transition-colors hover:text-white">
          <ArrowLeft className="size-4" /> Groups
        </button>
        {group.data ? <h1 className="mt-2 truncate text-2xl font-bold tracking-tight">{group.data.group.name}</h1> : <Skeleton className="mt-2 h-8 w-44 bg-white/10" />}
        <div className="mt-1 min-h-7 text-lg font-semibold">
          {!mine.data ? <Skeleton className="h-6 w-36 bg-white/10" /> : net === 0 ? <span className="text-white/90">You are all settled up</span> : (
            <span className={net > 0 ? "text-[oklch(0.85_0.13_160)]" : "text-[oklch(0.82_0.11_28)]"}>
              {net > 0 ? "You are owed " : "You owe "}<AnimatedAmount cents={Math.abs(net)} />
            </span>
          )}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <Button size="xl" disabled={!ready} onClick={() => setAdding(true)} className="bg-white text-hero shadow-lg hover:bg-white/90"><Plus className="size-5" />Add expense</Button>
          <Button size="xl" disabled={!ready} onClick={() => setSettling(true)} variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white dark:bg-white/10"><HandCoins className="size-5" />Settle up</Button>
        </div>
      </section>

      <Segmented id="group-tab" className="sticky top-[60px] z-20 mt-4 shadow-sm backdrop-blur" value={tab}
        onChange={t => navigate({ name: "group", groupId, tab: t }, { replace: true })}
        options={[{ value: "expenses", label: "Expenses" }, { value: "balances", label: "Balances" }, { value: "payments", label: "Payments" }, { value: "insights", label: "Insights" }]} />

      <AnimatePresence mode="wait" initial={false}>
        <m.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: EASE }} className="mt-4">
          {tab === "expenses" && <ExpensesTab groupId={groupId} meId={mine.data?.memberId} onAdd={() => setAdding(true)} />}
          {tab === "balances" && <BalancesTab groupId={groupId} />}
          {tab === "payments" && <PaymentsTab groupId={groupId} meId={mine.data?.memberId} />}
          {tab === "insights" && <InsightsTab groupId={groupId} />}
        </m.div>
      </AnimatePresence>

      <AddExpenseDrawer groupId={groupId} open={adding} onOpenChange={setAdding} />
      <SettleUpDrawer groupId={groupId} open={settling} onOpenChange={setSettling} />
    </Page>
  );
}

function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3 p-4">{Array.from({ length: rows }, (_, i) => <div key={i} className="flex items-center gap-3"><Skeleton className="h-9 w-9" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div><Skeleton className="h-4 w-16" /></div>)}</div>;
}

// ----- Expenses -----
function ExpensesTab({ groupId, meId, onAdd }: { groupId: string; meId?: string; onAdd: () => void }) {
  const expenses = useExpenses(groupId);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const list = (expenses.data || []).filter(x => !query || x.description.toLowerCase().includes(query.toLowerCase()) || x.paidByName.toLowerCase().includes(query.toLowerCase()));
  const total = (expenses.data || []).reduce((s, x) => s + x.amountCents, 0);
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <h2 className="text-lg font-semibold">Expenses</h2>
        {expenses.data && <span className="tabular text-sm text-muted-foreground">{expenses.data.length} · {inr(total)}</span>}
      </div>
      <div className="relative px-4 pt-3 pb-1">
        <Search className="pointer-events-none absolute top-1/2 left-7 mt-1 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" aria-label="Search expenses" placeholder="Search by description or payer" value={query} onChange={e => setQuery(e.target.value)} className="h-10 rounded-xl pl-9" />
      </div>
      {expenses.isPending || !meId ? <TableSkeleton /> : !list.length ? (
        expenses.data?.length ? <EmptyState icon={<Search className="size-5" />} title="No matches">Try a different word.</EmptyState> : (
          <EmptyState icon={<ReceiptText className="size-5" />} title="No expenses yet">
            Add the first one and we'll work out who owes whom.
            <Button className="mt-4" onClick={onAdd}><Plus />Add expense</Button>
          </EmptyState>
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 pl-4">Date</TableHead>
              <TableHead>Expense</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="pr-4 text-right">You</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map(x => <ExpenseRow key={x.id} x={x} meId={meId} groupId={groupId} open={open === x.id} onToggle={() => setOpen(o => (o === x.id ? null : x.id))} />)}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ExpenseRow({ x, meId, groupId, open, onToggle }: { x: Expense; meId?: string; groupId: string; open: boolean; onToggle: () => void }) {
  const del = useDeleteExpense(groupId);
  const [confirm, setConfirm] = React.useState(false);
  const who = (id: string, name: string) => (id === meId ? "You" : name);
  return (
    <>
      <TableRow data-state={open ? "selected" : undefined} aria-expanded={open} tabIndex={0} onClick={onToggle}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        className="cursor-pointer data-[state=selected]:bg-accent/60">
        <TableCell className="pl-4"><DateBadge ts={x.createdAt} /></TableCell>
        <TableCell className="max-w-0 w-full">
          <span className="block truncate font-medium">{x.description}</span>
          <span className="block truncate text-xs text-muted-foreground">{who(x.paidBy, x.paidByName)} paid {inr(x.amountCents)}</span>
        </TableCell>
        <TableCell className="tabular text-right">{inr(x.amountCents)}</TableCell>
        <TableCell className="pr-4 text-right">
          {x.myEffectCents > 0 ? <><span className="block text-[11px] text-positive">you lent</span><span className="tabular font-semibold text-positive">{inr(x.myEffectCents)}</span></>
            : x.myEffectCents < 0 ? <><span className="block text-[11px] text-negative">you borrowed</span><span className="tabular font-semibold text-negative">{inr(-x.myEffectCents)}</span></>
            : <span className="text-xs text-muted-foreground">{x.myShareCents ? "your share" : "not involved"}</span>}
        </TableCell>
      </TableRow>
      <tr className="border-0">
        <td colSpan={4} className="p-0">
          <AnimatePresence initial={false}>
            {open && (
              <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden bg-accent/40">
                <div className="space-y-3 px-4 py-3">
                  <p className="text-xs text-muted-foreground">{who(x.paidBy, x.paidByName)} paid · added by {x.createdBy === meId ? "you" : x.createdByName} · {shortDate(x.createdAt).full}</p>
                  <div className="overflow-hidden rounded-xl border bg-card">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-[11px] text-muted-foreground uppercase"><th className="px-3 py-2 font-medium">Person</th><th className="px-3 py-2 text-right font-medium">Share</th><th className="px-3 py-2 text-right font-medium">Owes {x.paidBy === meId ? "you" : x.paidByName}</th></tr></thead>
                      <tbody>{x.splits.map(s => (
                        <tr key={s.memberId} className="border-t"><td className="px-3 py-2">{who(s.memberId, s.name)}</td><td className="tabular px-3 py-2 text-right">{inr(s.amountCents)}</td><td className="tabular px-3 py-2 text-right">{s.memberId === x.paidBy ? "—" : inr(s.amountCents)}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                  {x.canDelete && (
                    <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={e => { e.stopPropagation(); setConfirm(true); }}><Trash2 />Delete expense</Button>
                  )}
                </div>
              </m.div>
            )}
          </AnimatePresence>
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{x.description}”?</AlertDialogTitle>
                <AlertDialogDescription>{inr(x.amountCents)} paid by {x.paidByName}. Everyone's balances will be recalculated.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" disabled={del.isPending}
                  onClick={e => { e.preventDefault(); del.mutate(x.id, { onSuccess: () => { setConfirm(false); toast.success("Expense deleted."); } }); }}>
                  {del.isPending ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </td>
      </tr>
    </>
  );
}

// ----- Balances -----
function BalancesTab({ groupId }: { groupId: string }) {
  const mine = useMine(groupId), group = useGroup(groupId), balances = useBalances(groupId), debts = useDebts(groupId);
  const meId = mine.data?.memberId;
  const people = React.useMemo(() => {
    if (!mine.data || !group.data) return null;
    const net = new Map<string, { name: string; cents: number }>();
    for (const d of mine.data.owedToYou) net.set(d.fromMemberId, { name: d.fromName, cents: d.amountCents });
    for (const d of mine.data.youOwe) net.set(d.toMemberId, { name: d.toName, cents: -d.amountCents });
    for (const m of group.data.members) if (m.id !== meId && !net.has(m.id)) net.set(m.id, { name: m.name, cents: 0 });
    return [...net].sort((a, b) => Math.abs(b[1].cents) - Math.abs(a[1].cents) || a[1].name.localeCompare(b[1].name));
  }, [mine.data, group.data, meId]);
  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>You and each person</SectionTitle>
        <div className="overflow-hidden rounded-2xl border bg-card">
          {!people ? <TableSkeleton rows={3} /> : !people.length ? <EmptyState icon={<Wallet className="size-5" />} title="Just you here">No one else is in this group yet.</EmptyState> : people.map(([id, p], i) => (
            <m.button key={id} custom={i} variants={listItem} initial="initial" animate="animate" type="button"
              onClick={() => navigate({ name: "person", groupId, memberId: id })}
              className="flex w-full cursor-pointer items-center gap-3 border-b px-4 py-3.5 text-left transition-colors last:border-0 hover:bg-muted/60 active:bg-muted">
              <PersonAvatar id={id} name={p.name} />
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <span className="text-right">
                <span className={cn("block text-[11px]", p.cents > 0 ? "text-positive" : p.cents < 0 ? "text-negative" : "text-muted-foreground")}>{p.cents > 0 ? "owes you" : p.cents < 0 ? "you owe" : "settled up"}</span>
                {p.cents !== 0 && <Amount cents={Math.abs(p.cents)} className={p.cents > 0 ? "text-positive" : "text-negative"} />}
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </m.button>
          ))}
        </div>
        <p className="mt-2 px-1 text-xs text-muted-foreground">Tap a person to see every expense and payment between you two.</p>
      </section>

      <section>
        <SectionTitle>Group balances</SectionTitle>
        <div className="overflow-hidden rounded-2xl border bg-card">
          {!balances.data ? <TableSkeleton rows={3} /> : balances.data.map(b => (
            <div key={b.memberId} className="flex items-center gap-3 border-b px-4 py-3 last:border-0">
              <PersonAvatar id={b.memberId} name={b.name} size="sm" />
              <span className="min-w-0 flex-1 truncate">{b.name}{b.memberId === meId && <span className="text-muted-foreground"> (you)</span>}</span>
              <span className={cn("tabular text-sm font-semibold", b.balanceCents > 0 ? "text-positive" : b.balanceCents < 0 ? "text-negative" : "text-muted-foreground")}>
                {b.balanceCents > 0 ? "gets back " + inr(b.balanceCents) : b.balanceCents < 0 ? "owes " + inr(-b.balanceCents) : inr(0) + " · settled"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Who owes whom</SectionTitle>
        <div className="overflow-hidden rounded-2xl border bg-card">
          {!debts.data ? <TableSkeleton rows={2} /> : !debts.data.length ? <p className="px-4 py-5 text-center text-sm text-muted-foreground">Everyone is settled up 🎉</p> : debts.data.map(d => <DebtLine key={d.fromMemberId + ">" + d.toMemberId} d={d} meId={meId} />)}
        </div>
        <p className="mt-2 px-1 text-xs text-muted-foreground">For each expense, everyone owes their share to whoever paid. If two people owe each other, only the difference is shown.</p>
      </section>
    </div>
  );
}

function DebtLine({ d, meId }: { d: Debt; meId?: string }) {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-3 text-sm last:border-0">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{d.fromMemberId === meId ? "You" : d.fromName}</span>
        <span className="text-muted-foreground">{d.fromMemberId === meId ? " owe " : " owes "}</span>
        <span className="font-medium">{d.toMemberId === meId ? "you" : d.toName}</span>
      </span>
      <Amount cents={d.amountCents} />
    </div>
  );
}

// ----- Payments -----
function PaymentsTab({ groupId, meId }: { groupId: string; meId?: string }) {
  const payments = useSettlements(groupId);
  const who = (id: string, name: string) => (id === meId ? "You" : name);
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-lg font-semibold">Payments</h2>
        {payments.data && payments.data.length > 0 && <span className="tabular text-sm text-muted-foreground">{payments.data.length} · {inr(payments.data.reduce((s, x) => s + x.amountCents, 0))}</span>}
      </div>
      {payments.isPending ? <TableSkeleton /> : !payments.data?.length ? (
        <EmptyState icon={<HandCoins className="size-5" />} title="No payments yet">When someone pays back, it shows up here.</EmptyState>
      ) : (
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-12 pl-4">Date</TableHead><TableHead>Payment</TableHead><TableHead className="pr-4 text-right">Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {payments.data.map(s => (
              <TableRow key={s.id}>
                <TableCell className="pl-4"><DateBadge ts={s.createdAt} /></TableCell>
                <TableCell className="max-w-0 w-full">
                  <span className="block truncate font-medium">{who(s.fromMemberId, s.fromName)} paid {s.toMemberId === meId ? "you" : s.toName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {new Date(s.createdAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}{s.recordedByName && s.recordedByName !== s.fromName ? " · recorded by " + s.recordedByName : ""}
                  </span>
                </TableCell>
                <TableCell className="tabular pr-4 text-right font-semibold text-positive">{inr(s.amountCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ----- Insights -----
function InsightsTab({ groupId }: { groupId: string }) {
  const dash = useDashboard(groupId), group = useGroup(groupId);
  const max = Math.max(1, ...(dash.data?.spending.map(s => s.paidCents) || [0]));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">Total spent</p>{dash.data ? <AnimatedAmount cents={dash.data.totalSpentCents} className="text-xl font-bold" /> : <Skeleton className="mt-1 h-6 w-24" />}</div>
        <div className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">Expenses</p><p className="tabular text-xl font-bold">{dash.data?.expenseCount ?? "—"}</p></div>
      </div>
      <section>
        <SectionTitle>Who paid the most</SectionTitle>
        <div className="space-y-4 rounded-2xl border bg-card p-4">
          {!dash.data ? <TableSkeleton rows={3} /> : dash.data.spending.map((s, i) => (
            <div key={s.memberId}>
              <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-medium">{i + 1}. {s.name}</span><span className="tabular font-semibold">{inr(s.paidCents)}</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <m.div className="h-full rounded-full bg-gradient-to-r from-primary to-[oklch(0.68_0.16_300)]" initial={{ width: 0 }} animate={{ width: (s.paidCents / max) * 100 + "%" }} transition={{ duration: 0.7, ease: EASE, delay: i * 0.05 }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Their share of expenses: {inr(s.shareCents)}</p>
            </div>
          ))}
        </div>
      </section>
      <section>
        <SectionTitle>People</SectionTitle>
        <div className="overflow-hidden rounded-2xl border bg-card">
          {group.data?.members.map(m => (
            <div key={m.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-0">
              <PersonAvatar id={m.id} name={m.name} size="sm" />
              <span className="flex-1 truncate">{m.name}{m.id === group.data.me.id && <span className="text-muted-foreground"> (you)</span>}</span>
              <span className="text-xs text-muted-foreground">{m.status === "admin" ? "admin" : m.status === "pending" ? "waiting for re-approval" : ""}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
