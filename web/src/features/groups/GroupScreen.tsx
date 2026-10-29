import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, HandCoins, Plus, ReceiptText, Search, Trash2, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AnimatedMoney, DateBadge, EASE, EmptyState, Footnote, List, Page, PersonAvatar, SectionTitle, Segmented, haptic, listItem, pressableRow, rowClass, searchFieldClass,
} from "@/components/app/bits";
import { AddExpenseDrawer } from "./AddExpenseDrawer";
import { SettleUpDrawer } from "./SettleUpDrawer";
import { useBalances, useDashboard, useDebts, useDeleteExpense, useExpenses, useGroup, useMine, useSettlements } from "@/hooks/queries";
import type { Expense } from "@/lib/api";
import { inr, shortDate } from "@/lib/money";
import { goBack, navigate, type GroupTab } from "@/lib/route";
import { cn } from "@/lib/utils";

const CHEVRON = "size-[18px] text-[#c4c4c7] dark:text-[#5a5a5e]";

// iOS back button: tint chevron + previous title.
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="-ml-2 inline-flex max-w-full cursor-pointer items-center text-[17px] text-tint transition-opacity active:opacity-50">
      <ChevronLeft className="size-7 shrink-0" strokeWidth={2.2} /><span className="-ml-0.5 truncate">{label}</span>
    </button>
  );
}

export function GroupScreen({ groupId, tab }: { groupId: string; tab: GroupTab }) {
  const group = useGroup(groupId);
  const mine = useMine(groupId);
  const [adding, setAdding] = React.useState(false);
  const [settling, setSettling] = React.useState(false);
  const net = mine.data ? mine.data.totalOwedToYouCents - mine.data.totalYouOweCents : 0;
  const ready = !!group.data && !!mine.data;

  if (group.error) {
    return <Page><EmptyState icon={<ReceiptText />} title="Can't Open Group">{(group.error as Error).message}</EmptyState>
      <Button variant="secondary" className="mx-auto flex" onClick={() => navigate({ name: "home" })}>Back to Groups</Button></Page>;
  }

  return (
    <Page>
      <BackButton label="Groups" onClick={() => goBack({ name: "home" })} />
      {group.data ? <h1 className="large-title mt-1 px-1 break-words">{group.data.group.name}</h1> : <Skeleton className="mt-2 h-9 w-52" />}
      {group.data && <p className="subhead px-1 text-muted-foreground">{group.data.members.length} {group.data.members.length === 1 ? "member" : "members"}</p>}

      <section className="panel mt-5 p-4">
        <p className="subhead text-muted-foreground">{!mine.data ? "Your balance" : net > 0 ? "You are owed" : net < 0 ? "You owe" : "Balance"}</p>
        <div className="mt-1.5 min-h-12">
          {!mine.data ? <Skeleton className="h-11 w-40" /> : net === 0 ? <p className="title-2 pt-1.5">You are all settled up</p>
            : <AnimatedMoney cents={Math.abs(net)} size="hero" className={net > 0 ? "text-positive" : "text-negative"} />}
        </div>
        {mine.data && mine.data.totalOwedToYouCents > 0 && mine.data.totalYouOweCents > 0 && (
          <p className="footnote mt-1.5 text-muted-foreground">You owe {inr(mine.data.totalYouOweCents)} · you are owed {inr(mine.data.totalOwedToYouCents)}</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Button size="xl" disabled={!ready} onClick={() => setAdding(true)}><Plus className="size-5" strokeWidth={2.5} />Add expense</Button>
          <Button size="xl" variant="secondary" disabled={!ready} onClick={() => setSettling(true)}><HandCoins className="size-5" />Settle up</Button>
        </div>
      </section>

      <div className="sticky top-[52px] z-20 -mx-4 mt-5 bg-background/80 px-4 py-2 backdrop-blur-xl backdrop-saturate-[1.8]">
        <Segmented id="group-tab" value={tab} onChange={t => navigate({ name: "group", groupId, tab: t }, { replace: true })}
          options={[{ value: "expenses", label: "Expenses" }, { value: "balances", label: "Balances" }, { value: "payments", label: "Payments" }, { value: "insights", label: "Insights" }]} />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <m.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: EASE }} className="mt-3">
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

function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return <div>{Array.from({ length: rows }, (_, i) => <div key={i} className="flex items-center gap-3 px-4 py-3"><Skeleton className="size-9 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div><Skeleton className="h-4 w-16" /></div>)}</div>;
}

// Column header row shared by the money tables (iOS footnote style).
function TableHead({ cols }: { cols: [string, string?][] }) {
  return <thead><tr className="shadow-[inset_0_-0.5px_0_var(--hairline)]">{cols.map(([c, cls], i) => <th key={i} scope="col" className={cn("footnote px-2 py-2 text-left font-normal text-muted-foreground first:pl-4 last:pr-4", cls)}>{c}</th>)}</tr></thead>;
}
const tr = "shadow-[inset_0_-0.5px_0_var(--hairline)] last:shadow-none";

// ----- Expenses -----
function ExpensesTab({ groupId, meId, onAdd }: { groupId: string; meId?: string; onAdd: () => void }) {
  const expenses = useExpenses(groupId);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const q = query.toLowerCase();
  const list = (expenses.data || []).filter(x => !q || x.description.toLowerCase().includes(q) || x.paidByName.toLowerCase().includes(q));
  const total = (expenses.data || []).reduce((s, x) => s + x.amountCents, 0);
  return (
    <>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={2.5} />
        <Input type="search" aria-label="Search expenses" placeholder="Search by description or payer" value={query} onChange={e => setQuery(e.target.value)} className={searchFieldClass} />
      </div>
      <SectionTitle action={expenses.data && expenses.data.length > 0 ? <span className="footnote tabular text-muted-foreground">Total {inr(total)}</span> : undefined}>
        {expenses.data ? `${expenses.data.length} ${expenses.data.length === 1 ? "expense" : "expenses"}` : "Expenses"}
      </SectionTitle>
      <div className="panel overflow-hidden">
        {expenses.isPending || !meId ? <RowsSkeleton /> : !list.length ? (
          expenses.data?.length ? <EmptyState icon={<Search />} title="No Results">Try a different word.</EmptyState> : (
            <EmptyState icon={<ReceiptText />} title="No Expenses">
              Add the first one and we'll work out who owes whom.
              <Button className="mt-4 h-9 rounded-full px-4" onClick={onAdd}><Plus />Add expense</Button>
            </EmptyState>
          )
        ) : (
          <table className="w-full text-[15px]">
            <TableHead cols={[["Date", "w-12"], ["Expense"], ["Amount", "text-right"], ["You", "text-right"]]} />
            <tbody>{list.map(x => <ExpenseRow key={x.id} x={x} meId={meId} groupId={groupId} open={open === x.id} onToggle={() => setOpen(o => (o === x.id ? null : x.id))} />)}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ExpenseRow({ x, meId, groupId, open, onToggle }: { x: Expense; meId?: string; groupId: string; open: boolean; onToggle: () => void }) {
  const del = useDeleteExpense(groupId);
  const [confirm, setConfirm] = React.useState(false);
  const who = (id: string, name: string) => (id === meId ? "You" : name);
  return (
    <>
      <tr aria-expanded={open} tabIndex={0} onClick={onToggle} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        className={cn("cursor-pointer transition-colors duration-100 active:bg-[#d1d1d6] dark:active:bg-[#3a3a3c]", !open && tr, open && "bg-muted/60")}>
        <td className="py-2.5 pr-1 pl-3 align-middle"><DateBadge ts={x.createdAt} /></td>
        <td className="w-full max-w-0 px-2 py-2.5">
          <span className="block truncate text-[17px]">{x.description}</span>
          <span className="subhead block truncate text-muted-foreground">{who(x.paidBy, x.paidByName)} paid</span>
        </td>
        <td className="tabular px-2 py-2.5 text-right whitespace-nowrap">{inr(x.amountCents)}</td>
        <td className="py-2.5 pr-4 pl-2 text-right whitespace-nowrap">
          {x.myEffectCents > 0 ? <><span className="block text-[12px] text-positive">you lent</span><span className="tabular font-semibold text-positive">{inr(x.myEffectCents)}</span></>
            : x.myEffectCents < 0 ? <><span className="block text-[12px] text-negative">you borrowed</span><span className="tabular font-semibold text-negative">{inr(-x.myEffectCents)}</span></>
            : <span className="footnote text-muted-foreground">{x.myShareCents ? "your share" : "not involved"}</span>}
        </td>
      </tr>
      <tr className={open ? tr : ""}>
        <td colSpan={4} className="p-0">
          <AnimatePresence initial={false}>
            {open && (
              <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }} className="overflow-hidden bg-muted/60">
                <div className="space-y-3 px-4 pt-1 pb-4">
                  <p className="footnote text-muted-foreground">{who(x.paidBy, x.paidByName)} paid · added by {x.createdBy === meId ? "you" : x.createdByName} · {shortDate(x.createdAt).full}</p>
                  <div className="overflow-hidden rounded-[10px] bg-card">
                    <table className="w-full text-[15px]">
                      <TableHead cols={[["Person"], ["Share", "text-right"], ["Owes " + (x.paidBy === meId ? "you" : x.paidByName), "text-right"]]} />
                      <tbody>{x.splits.map(s => (
                        <tr key={s.memberId} className={tr}>
                          <td className="px-2 py-2.5 pl-4">{who(s.memberId, s.name)}</td>
                          <td className="tabular px-2 py-2.5 text-right">{inr(s.amountCents)}</td>
                          <td className="tabular px-2 py-2.5 pr-4 text-right text-muted-foreground">{s.memberId === x.paidBy ? "—" : inr(s.amountCents)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  {x.canDelete && (
                    <button type="button" className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[10px] bg-card py-2.5 text-[17px] text-destructive transition-opacity active:opacity-60" onClick={e => { e.stopPropagation(); setConfirm(true); }}><Trash2 className="size-[18px]" />Delete expense</button>
                  )}
                </div>
              </m.div>
            )}
          </AnimatePresence>
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogContent className="max-w-[300px] gap-0 rounded-[14px] p-0 text-center">
              <AlertDialogHeader className="px-4 pt-5 pb-4 text-center sm:text-center">
                <AlertDialogTitle className="headline">Delete “{x.description}”?</AlertDialogTitle>
                <AlertDialogDescription className="footnote text-foreground">{inr(x.amountCents)} paid by {x.paidByName}. Everyone's balances will be recalculated.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="grid grid-cols-2 gap-0 shadow-[inset_0_0.5px_0_var(--hairline)] sm:grid-cols-2">
                <AlertDialogCancel className="h-11 rounded-none border-0 bg-transparent text-[17px] text-tint shadow-none hover:bg-muted/50">Cancel</AlertDialogCancel>
                <AlertDialogAction className="h-11 rounded-none bg-transparent text-[17px] font-semibold text-destructive shadow-[inset_0.5px_0_0_var(--hairline)] hover:bg-muted/50" disabled={del.isPending}
                  onClick={e => { e.preventDefault(); del.mutate(x.id, { onSuccess: () => { setConfirm(false); haptic(); toast.success("Expense deleted."); } }); }}>
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
    for (const mm of group.data.members) if (mm.id !== meId && !net.has(mm.id)) net.set(mm.id, { name: mm.name, cents: 0 });
    return [...net].sort((a, b) => Math.abs(b[1].cents) - Math.abs(a[1].cents) || a[1].name.localeCompare(b[1].name));
  }, [mine.data, group.data, meId]);
  return (
    <div className="space-y-7">
      <section>
        <SectionTitle>You and each person</SectionTitle>
        <List inset={68}>
          {!people ? <RowsSkeleton rows={3} /> : !people.length ? <EmptyState icon={<Users />} title="Just You">No one else is in this group yet.</EmptyState> : people.map(([id, p], i) => (
            <m.button key={id} custom={i} variants={listItem} initial="initial" animate="animate" type="button" onClick={() => navigate({ name: "person", groupId, memberId: id })} className={pressableRow}>
              <PersonAvatar name={p.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px]">{p.name}</span>
                <span className={cn("subhead block", p.cents > 0 ? "text-positive" : p.cents < 0 ? "text-negative" : "text-muted-foreground")}>{p.cents > 0 ? "owes you" : p.cents < 0 ? "you owe" : "settled up"}</span>
              </span>
              {p.cents !== 0 && <span className={cn("tabular text-[17px]", p.cents > 0 ? "text-positive" : "text-negative")}>{inr(Math.abs(p.cents))}</span>}
              <ChevronRight className={CHEVRON} strokeWidth={2.5} />
            </m.button>
          ))}
        </List>
        <Footnote>Tap a person to see every expense and payment between you two.</Footnote>
      </section>

      <section>
        <SectionTitle>Group balances</SectionTitle>
        <List inset={60}>
          {!balances.data ? <RowsSkeleton rows={3} /> : balances.data.map(b => (
            <div key={b.memberId} className={rowClass}>
              <PersonAvatar name={b.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[17px]">{b.name}{b.memberId === meId && <span className="text-muted-foreground"> (you)</span>}</span>
              <span className={cn("tabular text-[15px]", b.balanceCents > 0 ? "text-positive" : b.balanceCents < 0 ? "text-negative" : "text-muted-foreground")}>
                {b.balanceCents > 0 ? "gets back " + inr(b.balanceCents) : b.balanceCents < 0 ? "owes " + inr(-b.balanceCents) : "settled"}
              </span>
            </div>
          ))}
        </List>
      </section>

      <section>
        <SectionTitle>Who owes whom</SectionTitle>
        <List>
          {!debts.data ? <RowsSkeleton rows={2} /> : !debts.data.length ? <p className="px-4 py-3 text-[17px] text-muted-foreground">Everyone is settled up</p> : debts.data.map(d => (
            <div key={d.fromMemberId + ">" + d.toMemberId} className={rowClass}>
              <span className="min-w-0 flex-1 truncate text-[17px]">
                {d.fromMemberId === meId ? "You" : d.fromName}
                <span className="text-muted-foreground">{d.fromMemberId === meId ? " owe " : " owes "}</span>
                {d.toMemberId === meId ? "you" : d.toName}
              </span>
              <span className="tabular text-[17px] text-muted-foreground">{inr(d.amountCents)}</span>
            </div>
          ))}
        </List>
        <Footnote>For each expense, everyone owes their share to whoever paid. If two people owe each other, only the difference is shown.</Footnote>
      </section>
    </div>
  );
}

// ----- Payments -----
function PaymentsTab({ groupId, meId }: { groupId: string; meId?: string }) {
  const payments = useSettlements(groupId);
  const who = (id: string, name: string) => (id === meId ? "You" : name);
  return (
    <>
      <SectionTitle action={payments.data && payments.data.length > 0 ? <span className="footnote tabular text-muted-foreground">Total {inr(payments.data.reduce((s, x) => s + x.amountCents, 0))}</span> : undefined}>
        {payments.data ? `${payments.data.length} ${payments.data.length === 1 ? "payment" : "payments"}` : "Payments"}
      </SectionTitle>
      <div className="panel overflow-hidden">
        {payments.isPending ? <RowsSkeleton /> : !payments.data?.length ? (
          <EmptyState icon={<HandCoins />} title="No Payments">When someone pays back, it shows up here.</EmptyState>
        ) : (
          <table className="w-full text-[15px]">
            <TableHead cols={[["Date", "w-12"], ["Payment"], ["Amount", "text-right"]]} />
            <tbody>
              {payments.data.map(s => (
                <tr key={s.id} className={tr}>
                  <td className="py-2.5 pr-1 pl-3"><DateBadge ts={s.createdAt} /></td>
                  <td className="w-full max-w-0 px-2 py-2.5">
                    <span className="block truncate text-[17px]">{who(s.fromMemberId, s.fromName)} paid {s.toMemberId === meId ? "you" : s.toName}</span>
                    <span className="subhead block truncate text-muted-foreground">
                      {new Date(s.createdAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}{s.recordedByName && s.recordedByName !== s.fromName ? " · recorded by " + s.recordedByName : ""}
                    </span>
                  </td>
                  <td className="tabular py-2.5 pr-4 pl-2 text-right text-[17px] whitespace-nowrap">{inr(s.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ----- Insights -----
function InsightsTab({ groupId }: { groupId: string }) {
  const dash = useDashboard(groupId), group = useGroup(groupId);
  const max = Math.max(1, ...(dash.data?.spending.map(s => s.paidCents) || [0]));
  return (
    <div className="space-y-7">
      <div className="grid grid-cols-2 gap-3">
        <div className="panel p-4"><p className="footnote text-muted-foreground">Total spent</p>{dash.data ? <AnimatedMoney cents={dash.data.totalSpentCents} size="lg" className="mt-1.5" /> : <Skeleton className="mt-2 h-7 w-24" />}</div>
        <div className="panel p-4"><p className="footnote text-muted-foreground">Expenses</p><p className="tabular mt-1.5 font-rounded text-[28px] leading-none font-bold">{dash.data?.expenseCount ?? "—"}</p></div>
      </div>
      <section>
        <SectionTitle>Who paid the most</SectionTitle>
        <div className="panel space-y-4 p-4">
          {!dash.data ? <RowsSkeleton rows={3} /> : dash.data.spending.map((s, i) => (
            <div key={s.memberId}>
              <div className="flex items-baseline justify-between gap-2 text-[17px]"><span className="truncate">{s.name}</span><span className="tabular font-semibold">{inr(s.paidCents)}</span></div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <m.div className="h-full rounded-full bg-tint" initial={{ width: 0 }} animate={{ width: (s.paidCents / max) * 100 + "%" }} transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1], delay: 0.05 + i * 0.05 }} />
              </div>
              <p className="footnote mt-1 text-muted-foreground">Their share of expenses: {inr(s.shareCents)}</p>
            </div>
          ))}
        </div>
      </section>
      <section>
        <SectionTitle>People</SectionTitle>
        <List inset={60}>
          {group.data?.members.map(mm => (
            <div key={mm.id} className={rowClass}>
              <PersonAvatar name={mm.name} size="sm" />
              <span className="flex-1 truncate text-[17px]">{mm.name}{mm.id === group.data.me.id && <span className="text-muted-foreground"> (you)</span>}</span>
              <span className="subhead text-muted-foreground">{mm.status === "admin" ? "Admin" : mm.status === "pending" ? "Awaiting re-approval" : ""}</span>
            </div>
          ))}
        </List>
      </section>
    </div>
  );
}
