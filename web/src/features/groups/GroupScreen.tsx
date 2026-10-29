import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { ArrowLeft, ChevronRight, HandCoins, Plus, ReceiptText, Search, Trash2, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AnimatedMoney, DateBadge, EASE, EmptyState, List, Money, Page, PersonAvatar, SectionTitle, UnderlineTabs, fieldClass, haptic, listItem, pressableRow, rowClass,
} from "@/components/app/bits";
import { AddExpenseDrawer } from "./AddExpenseDrawer";
import { SettleUpDrawer } from "./SettleUpDrawer";
import { useBalances, useDashboard, useDebts, useDeleteExpense, useExpenses, useGroup, useMine, useSettlements } from "@/hooks/queries";
import type { Expense } from "@/lib/api";
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
      <button type="button" onClick={() => goBack({ name: "home" })} className="-ml-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Groups
      </button>
      {group.data ? <h1 className="mt-2 font-serif text-[38px] leading-[1.02] tracking-[-0.02em] break-words">{group.data.group.name}</h1> : <Skeleton className="mt-3 h-9 w-52" />}
      {group.data && <p className="mt-1.5 text-[13px] text-muted-foreground">{group.data.members.length} {group.data.members.length === 1 ? "member" : "members"}</p>}

      <section className="panel mt-6 p-5">
        <p className="eyebrow">{!mine.data ? "Your balance" : net > 0 ? "You are owed" : net < 0 ? "You owe" : "Balance"}</p>
        <div className="mt-3 min-h-14">
          {!mine.data ? <Skeleton className="h-12 w-44" /> : net === 0 ? <p className="font-serif text-[40px] leading-none">You are all settled up</p>
            : <AnimatedMoney cents={Math.abs(net)} size="hero" className={net > 0 ? "text-positive" : "text-negative"} />}
        </div>
        {mine.data && mine.data.totalOwedToYouCents > 0 && mine.data.totalYouOweCents > 0 && (
          <p className="mt-2 text-[12.5px] text-muted-foreground">You owe {inr(mine.data.totalYouOweCents)} · you are owed {inr(mine.data.totalOwedToYouCents)}</p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <Button size="xl" disabled={!ready} onClick={() => setAdding(true)}><Plus className="size-[18px]" />Add expense</Button>
          <Button size="xl" variant="secondary" disabled={!ready} onClick={() => setSettling(true)}><HandCoins className="size-[18px]" />Settle up</Button>
        </div>
      </section>

      <div className="sticky top-[60px] z-20 -mx-5 mt-6 bg-background/85 px-5 backdrop-blur-xl">
        <UnderlineTabs id="group-tab" value={tab} onChange={t => navigate({ name: "group", groupId, tab: t }, { replace: true })}
          options={[{ value: "expenses", label: "Expenses" }, { value: "balances", label: "Balances" }, { value: "payments", label: "Payments" }, { value: "insights", label: "Insights" }]} />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <m.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: EASE }} className="mt-5">
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
  return <div className="divide-y divide-hairline">{Array.from({ length: rows }, (_, i) => <div key={i} className="flex items-center gap-3.5 px-4 py-4"><Skeleton className="h-9 w-9 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div><Skeleton className="h-4 w-16" /></div>)}</div>;
}

// Column header row shared by the money tables.
function TableHead({ cols }: { cols: [string, string?][] }) {
  return <thead><tr className="border-b border-hairline">{cols.map(([c, cls], i) => <th key={i} scope="col" className={cn("eyebrow px-2 py-2.5 text-left !text-[10px] font-medium first:pl-4 last:pr-4", cls)}>{c}</th>)}</tr></thead>;
}

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
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <h2 className="eyebrow">{expenses.data ? `${expenses.data.length} expenses` : "Expenses"}</h2>
        {expenses.data && expenses.data.length > 0 && <span className="tabular text-[12.5px] text-muted-foreground">Total {inr(total)}</span>}
      </div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" aria-label="Search expenses" placeholder="Search by description or payer" value={query} onChange={e => setQuery(e.target.value)} className={cn(fieldClass, "h-11 rounded-full pl-10")} />
      </div>
      <div className="panel overflow-hidden">
        {expenses.isPending || !meId ? <RowsSkeleton /> : !list.length ? (
          expenses.data?.length ? <EmptyState icon={<Search className="size-5" />} title="No matches">Try a different word.</EmptyState> : (
            <EmptyState icon={<ReceiptText className="size-5" />} title="No expenses yet">
              Add the first one and we'll work out who owes whom.
              <Button className="mt-5 rounded-full" onClick={onAdd}><Plus />Add expense</Button>
            </EmptyState>
          )
        ) : (
          <table className="w-full text-[14px]">
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
        className={cn("cursor-pointer border-b border-hairline transition-colors duration-150 last:border-0 hover:bg-muted/40", open && "bg-muted/50")}>
        <td className="py-3.5 pr-2 pl-4 align-middle"><DateBadge ts={x.createdAt} /></td>
        <td className="w-full max-w-0 px-2 py-3.5">
          <span className="block truncate font-medium">{x.description}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{who(x.paidBy, x.paidByName)} paid</span>
        </td>
        <td className="tabular px-2 py-3.5 text-right whitespace-nowrap">{inr(x.amountCents)}</td>
        <td className="py-3.5 pr-4 pl-2 text-right whitespace-nowrap">
          {x.myEffectCents > 0 ? <><span className="block text-[10.5px] tracking-wide text-positive/80 uppercase">you lent</span><span className="tabular font-medium text-positive">{inr(x.myEffectCents)}</span></>
            : x.myEffectCents < 0 ? <><span className="block text-[10.5px] tracking-wide text-negative/80 uppercase">you borrowed</span><span className="tabular font-medium text-negative">{inr(-x.myEffectCents)}</span></>
            : <span className="text-[12px] text-muted-foreground">{x.myShareCents ? "your share" : "not involved"}</span>}
        </td>
      </tr>
      <tr>
        <td colSpan={4} className="p-0">
          <AnimatePresence initial={false}>
            {open && (
              <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden border-b border-hairline bg-muted/40">
                <div className="space-y-3 px-4 py-4">
                  <p className="text-[12px] text-muted-foreground">{who(x.paidBy, x.paidByName)} paid · added by {x.createdBy === meId ? "you" : x.createdByName} · {shortDate(x.createdAt).full}</p>
                  <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
                    <table className="w-full text-[13px]">
                      <TableHead cols={[["Person"], ["Share", "text-right"], ["Owes " + (x.paidBy === meId ? "you" : x.paidByName), "text-right"]]} />
                      <tbody>{x.splits.map(s => (
                        <tr key={s.memberId} className="border-t border-hairline first:border-0">
                          <td className="px-2 py-2.5 pl-4">{who(s.memberId, s.name)}</td>
                          <td className="tabular px-2 py-2.5 text-right">{inr(s.amountCents)}</td>
                          <td className="tabular px-2 py-2.5 pr-4 text-right text-muted-foreground">{s.memberId === x.paidBy ? "—" : inr(s.amountCents)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  {x.canDelete && (
                    <Button variant="ghost" size="sm" className="-ml-2 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={e => { e.stopPropagation(); setConfirm(true); }}><Trash2 />Delete expense</Button>
                  )}
                </div>
              </m.div>
            )}
          </AnimatePresence>
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogContent className="rounded-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-serif text-2xl font-normal">Delete “{x.description}”?</AlertDialogTitle>
                <AlertDialogDescription>{inr(x.amountCents)} paid by {x.paidByName}. Everyone's balances will be recalculated.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-full">Keep it</AlertDialogCancel>
                <AlertDialogAction className="rounded-full bg-destructive text-white hover:bg-destructive/90" disabled={del.isPending}
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
    <div className="space-y-8">
      <section>
        <SectionTitle>You and each person</SectionTitle>
        <List>
          {!people ? <RowsSkeleton rows={3} /> : !people.length ? <EmptyState icon={<Users className="size-5" />} title="Just you here">No one else is in this group yet.</EmptyState> : people.map(([id, p], i) => (
            <m.button key={id} custom={i} variants={listItem} initial="initial" animate="animate" type="button" onClick={() => navigate({ name: "person", groupId, memberId: id })} className={pressableRow}>
              <PersonAvatar id={id} name={p.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{p.name}</span>
                <span className={cn("block text-[12.5px]", p.cents > 0 ? "text-positive" : p.cents < 0 ? "text-negative" : "text-muted-foreground")}>{p.cents > 0 ? "owes you" : p.cents < 0 ? "you owe" : "settled up"}</span>
              </span>
              {p.cents !== 0 && <Money cents={Math.abs(p.cents)} className={p.cents > 0 ? "text-positive" : "text-negative"} />}
              <ChevronRight className="size-4 text-muted-foreground/70" />
            </m.button>
          ))}
        </List>
        <p className="mt-2.5 px-1 text-[12px] text-muted-foreground">Tap a person to see every expense and payment between you two.</p>
      </section>

      <section>
        <SectionTitle>Group balances</SectionTitle>
        <List>
          {!balances.data ? <RowsSkeleton rows={3} /> : balances.data.map(b => (
            <div key={b.memberId} className={rowClass}>
              <PersonAvatar id={b.memberId} name={b.name} size="sm" />
              <span className="min-w-0 flex-1 truncate">{b.name}{b.memberId === meId && <span className="text-muted-foreground"> (you)</span>}</span>
              <span className={cn("tabular text-[13.5px]", b.balanceCents > 0 ? "text-positive" : b.balanceCents < 0 ? "text-negative" : "text-muted-foreground")}>
                {b.balanceCents > 0 ? "gets back " + inr(b.balanceCents) : b.balanceCents < 0 ? "owes " + inr(-b.balanceCents) : "settled"}
              </span>
            </div>
          ))}
        </List>
      </section>

      <section>
        <SectionTitle>Who owes whom</SectionTitle>
        <List>
          {!debts.data ? <RowsSkeleton rows={2} /> : !debts.data.length ? <p className="px-4 py-6 text-center font-serif text-xl">Everyone is settled up</p> : debts.data.map(d => (
            <div key={d.fromMemberId + ">" + d.toMemberId} className={cn(rowClass, "text-[14px]")}>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{d.fromMemberId === meId ? "You" : d.fromName}</span>
                <span className="text-muted-foreground">{d.fromMemberId === meId ? " owe " : " owes "}</span>
                <span className="font-medium">{d.toMemberId === meId ? "you" : d.toName}</span>
              </span>
              <span className="tabular">{inr(d.amountCents)}</span>
            </div>
          ))}
        </List>
        <p className="mt-2.5 px-1 text-[12px] leading-relaxed text-muted-foreground">For each expense, everyone owes their share to whoever paid. If two people owe each other, only the difference is shown.</p>
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
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <h2 className="eyebrow">{payments.data ? `${payments.data.length} payments` : "Payments"}</h2>
        {payments.data && payments.data.length > 0 && <span className="tabular text-[12.5px] text-muted-foreground">Total {inr(payments.data.reduce((s, x) => s + x.amountCents, 0))}</span>}
      </div>
      <div className="panel overflow-hidden">
        {payments.isPending ? <RowsSkeleton /> : !payments.data?.length ? (
          <EmptyState icon={<HandCoins className="size-5" />} title="No payments yet">When someone pays back, it shows up here.</EmptyState>
        ) : (
          <table className="w-full text-[14px]">
            <TableHead cols={[["Date", "w-12"], ["Payment"], ["Amount", "text-right"]]} />
            <tbody>
              {payments.data.map(s => (
                <tr key={s.id} className="border-b border-hairline last:border-0">
                  <td className="py-3.5 pr-2 pl-4"><DateBadge ts={s.createdAt} /></td>
                  <td className="w-full max-w-0 px-2 py-3.5">
                    <span className="block truncate font-medium">{who(s.fromMemberId, s.fromName)} paid {s.toMemberId === meId ? "you" : s.toName}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {new Date(s.createdAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}{s.recordedByName && s.recordedByName !== s.fromName ? " · recorded by " + s.recordedByName : ""}
                    </span>
                  </td>
                  <td className="tabular py-3.5 pr-4 pl-2 text-right font-medium whitespace-nowrap">{inr(s.amountCents)}</td>
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
    <div className="space-y-8">
      <div className="panel grid grid-cols-2 divide-x divide-hairline p-0">
        <div className="p-5"><p className="eyebrow">Total spent</p>{dash.data ? <AnimatedMoney cents={dash.data.totalSpentCents} size="lg" className="mt-2" /> : <Skeleton className="mt-2 h-8 w-28" />}</div>
        <div className="p-5"><p className="eyebrow">Expenses</p><p className="tabular mt-2 font-serif text-[32px] leading-none">{dash.data?.expenseCount ?? "—"}</p></div>
      </div>
      <section>
        <SectionTitle>Who paid the most</SectionTitle>
        <div className="panel space-y-5 p-5">
          {!dash.data ? <RowsSkeleton rows={3} /> : dash.data.spending.map((s, i) => (
            <div key={s.memberId}>
              <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[14px] font-medium"><span className="mr-2 font-serif text-muted-foreground">{i + 1}</span>{s.name}</span><span className="tabular text-[14px]">{inr(s.paidCents)}</span></div>
              <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-muted">
                <m.div className="h-full rounded-full bg-brass" initial={{ width: 0 }} animate={{ width: (s.paidCents / max) * 100 + "%" }} transition={{ duration: 0.9, ease: EASE, delay: 0.1 + i * 0.06 }} />
              </div>
              <p className="mt-1.5 text-[12px] text-muted-foreground">Their share of expenses: {inr(s.shareCents)}</p>
            </div>
          ))}
        </div>
      </section>
      <section>
        <SectionTitle>People</SectionTitle>
        <List>
          {group.data?.members.map(mm => (
            <div key={mm.id} className={rowClass}>
              <PersonAvatar id={mm.id} name={mm.name} size="sm" />
              <span className="flex-1 truncate">{mm.name}{mm.id === group.data.me.id && <span className="text-muted-foreground"> (you)</span>}</span>
              <span className="text-[12px] text-muted-foreground">{mm.status === "admin" ? "admin" : mm.status === "pending" ? "waiting for re-approval" : ""}</span>
            </div>
          ))}
        </List>
      </section>
    </div>
  );
}
