import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { ChartPie, ChevronLeft, ChevronRight, HandCoins, Pencil, Plus, ReceiptText, Scale, Search, Trash2, Users, Wallet, Paperclip } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AnimatedMoney, BottomTabs, CategoryTile, DateBadge, EASE, EmptyState, Footnote, List, Page, PersonAvatar, SectionTitle, haptic, listItem, pressableRow, searchFieldClass,
} from "@/components/app/bits";
import { AquaCard, cardTap } from "./GroupsScreen";
import { PeopleSheet } from "./PeopleSheet";
import { MembersSheet } from "./MembersSheet";
import { PendingPayments } from "./PendingPayments";
import { MemberSheet } from "./MemberSheet";
import { UpiPeople } from "./UpiPayments";
import { AwaitingBadge, ProofDialog, proofSrc } from "./Awaiting";
import { PairSheet } from "./PairDetail";
import { AddExpenseDrawer } from "./AddExpenseDrawer";
import { SettleUpDrawer } from "./SettleUpDrawer";
import { useBalances, useDashboard, useDebts, useDeleteExpense, useExpenses, useGroup, useMine, useSettlements } from "@/hooks/queries";
import type { Expense, Settlement } from "@/lib/api";
import { inr, shortDate } from "@/lib/money";
import { goBack, navigate, type GroupTab } from "@/lib/route";
import { cn } from "@/lib/utils";

const CHEVRON = "size-[18px] text-[#141716]/25";

// Round frosted back button with the previous screen's name.
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group inline-flex max-w-full cursor-pointer items-center gap-2 text-[14px] text-muted-foreground">
      <span className="glass grid size-9 shrink-0 place-items-center rounded-full shadow-[0_2px_8px_rgb(16_40_32/8%)] transition-transform group-active:scale-90"><ChevronLeft className="size-5 text-foreground" strokeWidth={2.4} /></span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function GroupScreen({ groupId, tab }: { groupId: string; tab: GroupTab }) {
  const group = useGroup(groupId);
  const mine = useMine(groupId);
  const [adding, setAdding] = React.useState(false);
  // The expense stays set while the edit sheet animates closed.
  const [editing, setEditing] = React.useState<{ open: boolean; x: Expense | null }>({ open: false, x: null });
  const [settling, setSettling] = React.useState(false);
  const net = mine.data ? mine.data.totalOwedToYouCents - mine.data.totalYouOweCents : 0;
  const ready = !!group.data && !!mine.data;
  const [peopleOpen, setPeopleOpen] = React.useState(false);
  const [membersOpen, setMembersOpen] = React.useState(false);

  if (group.error) {
    return <Page><EmptyState icon={<ReceiptText />} title="Can't open this group">{(group.error as Error).message}</EmptyState>
      <Button variant="secondary" className="mx-auto flex" onClick={() => navigate({ name: "home" })}>Back to groups</Button></Page>;
  }

  return (
    <Page className="pb-48">
      <BackButton label="Groups" onClick={() => goBack({ name: "home" })} />
      {group.data ? <h1 className="page-title mt-3 px-1 break-words">{group.data.group.name}</h1> : <Skeleton className="mt-3 h-8 w-52" />}
      {group.data && (
        <button type="button" onClick={() => setMembersOpen(true)} className="mt-2 flex cursor-pointer items-center gap-2 rounded-full px-1 py-0.5 transition-transform active:scale-[0.97]">
          <span className="flex -space-x-2">{group.data.members.slice(0, 5).map(mm => <PersonAvatar key={mm.id} id={mm.id} name={mm.name} size="sm" className="ring-2 ring-[#f7f7f5]" />)}</span>
          <span className="flex items-center text-[13px] text-muted-foreground">{group.data.members.length} {group.data.members.length === 1 ? "member" : "members"}<ChevronRight className="size-3.5" strokeWidth={2.4} /></span>
        </button>
      )}

      <AquaCard className="mt-5">
        {/* Tapping the balance opens a sheet of who owes whom in this group;
            each person there shows everything shared with them. */}
        <button type="button" className={cardTap} onClick={() => setPeopleOpen(true)}>
        <div data-testid="balance-card">
          <p className="eyebrow">{!mine.data ? "Your balance" : net > 0 ? "You are owed" : net < 0 ? "You owe" : "Your balance"}</p>
          <div className="mt-2 min-h-11">
            {!mine.data ? <Skeleton className="h-11 w-40" /> : net === 0 ? <p className="text-[28px] font-medium tracking-[-0.02em]">You are all settled up</p> : <AnimatedMoney cents={Math.abs(net)} size="hero" className={net > 0 ? "text-positive" : "text-negative"} />}
          </div>
          {mine.data && mine.data.totalOwedToYouCents > 0 && mine.data.totalYouOweCents > 0 && (
            <p className="mt-1.5 text-[13px] text-muted-foreground">You owe {inr(mine.data.totalYouOweCents)} · you are owed {inr(mine.data.totalOwedToYouCents)}</p>
          )}
        </div>
        <span className="mt-3 flex items-center gap-1 text-[13.5px] font-medium">See balances by person<ChevronRight className="size-4 text-[#141716]/35" strokeWidth={2.4} /></span>
        </button>
        <Button size="xl" variant="secondary" disabled={!ready} onClick={() => setSettling(true)} className="mt-5 w-full">
          <HandCoins className="size-5" />Settle up
        </Button>
      </AquaCard>

      <PendingPayments groupId={groupId} className="mt-7" />

      <AnimatePresence mode="wait" initial={false}>
        <m.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: EASE }} className="mt-7">
          {tab === "expenses" && <ExpensesTab groupId={groupId} meId={mine.data?.memberId} onAdd={() => setAdding(true)} onEdit={x => setEditing({ open: true, x })} />}
          {tab === "balances" && <BalancesTab groupId={groupId} />}
          {tab === "payments" && <PaymentsTab groupId={groupId} meId={mine.data?.memberId} />}
          {tab === "insights" && <InsightsTab groupId={groupId} />}
        </m.div>
      </AnimatePresence>

      {/* Extended floating action button, above the bottom bar. */}
      <m.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2, type: "spring", stiffness: 400, damping: 28 }}
        className="fixed right-4 bottom-[calc(max(14px,env(safe-area-inset-bottom))+78px)] z-30 sm:right-[calc(50%-21rem)]">
        <Button size="xl" disabled={!ready} onClick={() => setAdding(true)} className="h-[52px] px-5 shadow-[0_12px_28px_-10px_rgb(20_23_22/55%)]">
          <Plus className="size-5" strokeWidth={2.6} />Add expense
        </Button>
      </m.div>

      <BottomTabs id="group-tab" value={tab} onChange={t => navigate({ name: "group", groupId, tab: t }, { replace: true })}
        options={[{ value: "expenses", label: "Expenses", icon: ReceiptText }, { value: "balances", label: "Balances", icon: Scale }, { value: "payments", label: "Payments", icon: Wallet }, { value: "insights", label: "Insights", icon: ChartPie }]} />

      <AddExpenseDrawer groupId={groupId} open={adding} onOpenChange={setAdding} />
      <AddExpenseDrawer groupId={groupId} open={editing.open} onOpenChange={o => setEditing(v => ({ ...v, open: o }))} editing={editing.x} />
      <PeopleSheet open={peopleOpen} onOpenChange={setPeopleOpen} filter="all" groupId={groupId} />
      <MembersSheet groupId={groupId} open={membersOpen} onOpenChange={setMembersOpen} />
      <SettleUpDrawer groupId={groupId} open={settling} onOpenChange={setSettling} />
    </Page>
  );
}

function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return <div>{Array.from({ length: rows }, (_, i) => <div key={i} className="flex items-center gap-3 px-4 py-3.5"><Skeleton className="size-10 rounded-[13px]" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div><Skeleton className="h-4 w-16" /></div>)}</div>;
}

function TableHead({ cols }: { cols: [string, string?][] }) {
  return <thead><tr className="border-b border-hairline">{cols.map(([c, cls], i) => <th key={i} scope="col" className={cn("px-2 pt-3 pb-2 text-left text-[12px] font-medium text-muted-foreground first:pl-4 last:pr-4", cls)}>{c}</th>)}</tr></thead>;
}
const tr = "border-b border-hairline last:border-0";

// ----- Expenses -----
function ExpensesTab({ groupId, meId, onAdd, onEdit }: { groupId: string; meId?: string; onAdd: () => void; onEdit: (x: Expense) => void }) {
  const expenses = useExpenses(groupId);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const q = query.toLowerCase();
  const list = (expenses.data || []).filter(x => !q || x.description.toLowerCase().includes(q) || x.paidByName.toLowerCase().includes(q));
  const total = (expenses.data || []).reduce((s, x) => s + x.amountCents, 0);
  return (
    <>
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
        <Input type="search" aria-label="Search expenses" placeholder="Search by description or payer" value={query} onChange={e => setQuery(e.target.value)} className={searchFieldClass} />
      </div>
      <SectionTitle action={expenses.data && expenses.data.length > 0 ? <span className="tabular text-[13px] text-muted-foreground">Total {inr(total)}</span> : undefined}>
        {expenses.data ? `${expenses.data.length} ${expenses.data.length === 1 ? "expense" : "expenses"}` : "Expenses"}
      </SectionTitle>
      <div className="panel overflow-hidden">
        {expenses.isPending || !meId ? <RowsSkeleton /> : !list.length ? (
          expenses.data?.length ? <EmptyState icon={<Search />} title="No matches">Try a different word.</EmptyState> : (
            <EmptyState icon={<ReceiptText />} title="No expenses yet">
              Add the first one and we'll work out who owes whom.
              <Button className="mt-4" onClick={onAdd}><Plus />Add expense</Button>
            </EmptyState>
          )
        ) : (
          <table className="w-full text-[14px]">
            <TableHead cols={[["Expense", "w-full"], ["Amount", "text-right"], ["You", "text-right"]]} />
            <tbody>{list.map(x => <ExpenseRow key={x.id} x={x} meId={meId} groupId={groupId} open={open === x.id} onToggle={() => setOpen(o => (o === x.id ? null : x.id))} onEdit={() => onEdit(x)} />)}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ExpenseRow({ x, meId, groupId, open, onToggle, onEdit }: { x: Expense; meId?: string; groupId: string; open: boolean; onToggle: () => void; onEdit: () => void }) {
  const del = useDeleteExpense(groupId);
  const [confirm, setConfirm] = React.useState(false);
  const who = (id: string, name: string) => (id === meId ? "You" : name);
  const d = shortDate(x.createdAt);
  return (
    <>
      <tr aria-expanded={open} tabIndex={0} onClick={onToggle} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        className={cn("cursor-pointer transition-colors duration-150 active:bg-[#141716]/[0.04]", !open && tr, open && "bg-[#141716]/[0.025]")}>
        <td className="w-full max-w-0 py-3 pr-2 pl-4">
          <span className="flex items-center gap-3">
            <CategoryTile description={x.description} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium">{x.description}</span>
              <span className="block truncate text-[12.5px] text-muted-foreground">{d.day} {d.month} · {who(x.paidBy, x.paidByName)} paid</span>
            </span>
          </span>
        </td>
        <td className="tabular px-2 py-3 text-right whitespace-nowrap">{inr(x.amountCents)}</td>
        <td className="py-3 pr-4 pl-2 text-right whitespace-nowrap">
          {x.myEffectCents > 0 ? <><span className="block text-[11.5px] text-positive">you lent</span><span className="tabular font-medium text-positive">{inr(x.myEffectCents)}</span></>
            : x.myEffectCents < 0 ? <><span className="block text-[11.5px] text-negative">you borrowed</span><span className="tabular font-medium text-negative">{inr(-x.myEffectCents)}</span></>
            : <span className="text-[12.5px] text-muted-foreground">{x.myShareCents ? "your share" : "not involved"}</span>}
        </td>
      </tr>
      <tr className={open ? tr : ""}>
        <td colSpan={3} className="p-0">
          <AnimatePresence initial={false}>
            {open && (
              <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden bg-[#141716]/[0.025]">
                <div className="space-y-3 px-4 pt-1 pb-4">
                  <p className="text-[12.5px] text-muted-foreground">{who(x.paidBy, x.paidByName)} paid · added by {x.createdBy === meId ? "you" : x.createdByName} · {d.full}</p>
                  <div className="overflow-hidden rounded-[16px] bg-white shadow-[0_1px_2px_rgb(16_40_32/5%)]">
                    <table className="w-full text-[14px]">
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
                  {(x.canEdit || x.canDelete) && (
                    <div className="grid grid-cols-2 gap-2">
                      {x.canEdit && <button type="button" className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-[#141716]/[0.08] bg-white py-2.5 text-[14px] font-medium transition-transform active:scale-[0.98]" onClick={e => { e.stopPropagation(); onEdit(); }}><Pencil className="size-4" />Edit</button>}
                      {x.canDelete && <button type="button" className={cn("flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-[#141716]/[0.08] bg-white py-2.5 text-[14px] font-medium text-negative transition-transform active:scale-[0.98]", !x.canEdit && "col-span-2")} onClick={e => { e.stopPropagation(); setConfirm(true); }}><Trash2 className="size-4" />Delete</button>}
                    </div>
                  )}
                </div>
              </m.div>
            )}
          </AnimatePresence>
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogContent className="max-w-[340px] rounded-[26px] border-0 p-6">
              <AlertDialogHeader className="text-left">
                <AlertDialogTitle className="title-2">Delete “{x.description}”?</AlertDialogTitle>
                <AlertDialogDescription className="text-[14px]">{inr(x.amountCents)} paid by {x.paidByName}. Everyone's balances will be recalculated.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-2">
                <AlertDialogCancel className="h-11 rounded-full border-0 bg-[#141716]/[0.06] shadow-none">Cancel</AlertDialogCancel>
                <AlertDialogAction className="h-11 rounded-full bg-negative text-white hover:bg-negative/90" disabled={del.isPending}
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
  const [inspecting, setInspecting] = React.useState<string | null>(null);
  const [pairOpen, setPairOpen] = React.useState<{ creditorId: string; debtorId: string } | null>(null);
  const people = React.useMemo(() => {
    if (!mine.data || !group.data) return null;
    // waiting: payments between us awaiting approval (either way).
    const net = new Map<string, { name: string; cents: number; waiting: number }>();
    for (const d of mine.data.owedToYou) net.set(d.fromMemberId, { name: d.fromName, cents: d.amountCents, waiting: d.waitingCents || 0 });
    for (const d of mine.data.youOwe) net.set(d.toMemberId, { name: d.toName, cents: -d.amountCents, waiting: d.waitingCents || 0 });
    for (const mm of group.data.members) if (mm.id !== meId && !net.has(mm.id)) net.set(mm.id, { name: mm.name, cents: 0, waiting: 0 });
    return [...net].sort((a, b) => Math.abs(b[1].cents) - Math.abs(a[1].cents) || a[1].name.localeCompare(b[1].name));
  }, [mine.data, group.data, meId]);
  return (
    <div className="space-y-7">
      <section>
        <SectionTitle>You and each person</SectionTitle>
        <List inset={68}>
          {!people ? <RowsSkeleton rows={3} /> : !people.length ? <EmptyState icon={<Users />} title="Just you here">No one else is in this group yet.</EmptyState> : people.map(([id, p], i) => (
            <m.button key={id} custom={i} variants={listItem} initial="initial" animate="animate" type="button" onClick={() => navigate({ name: "person", groupId, memberId: id })} className={pressableRow}>
              <PersonAvatar id={id} name={p.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-medium">{p.name}</span>
                <span className={cn("block text-[13px]", p.cents > 0 ? "text-positive" : p.cents < 0 ? "text-negative" : "text-muted-foreground")}>{p.cents > 0 ? "owes you" : p.cents < 0 ? "you owe" : "settled up"}</span>
                {p.waiting > 0 && <AwaitingBadge cents={p.waiting} className="mt-1" />}
              </span>
              {p.cents !== 0 && <span className={cn("tabular text-[16px] font-medium", p.cents > 0 ? "text-positive" : "text-negative")}>{inr(Math.abs(p.cents))}</span>}
              <ChevronRight className={CHEVRON} strokeWidth={2.4} />
            </m.button>
          ))}
        </List>
        <Footnote>Tap a person to see every expense and payment between you two.</Footnote>
      </section>

      <section>
        <SectionTitle>Group balances</SectionTitle>
        <List inset={60}>
          {!balances.data ? <RowsSkeleton rows={3} /> : balances.data.map(b => (
            <button key={b.memberId} type="button" onClick={() => setInspecting(b.memberId)} className={pressableRow}>
              <PersonAvatar id={b.memberId} name={b.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[15px]">{b.name}{b.memberId === meId && <span className="text-muted-foreground"> (you)</span>}</span>
              <span className={cn("tabular rounded-full px-2.5 py-1 text-[13px] font-medium", b.balanceCents > 0 ? "bg-positive-soft text-positive" : b.balanceCents < 0 ? "bg-negative-soft text-negative" : "bg-[#141716]/[0.05] text-muted-foreground")}>
                {b.balanceCents > 0 ? "gets back " + inr(b.balanceCents) : b.balanceCents < 0 ? "owes " + inr(-b.balanceCents) : "settled"}
              </span>
              <ChevronRight className={CHEVRON} strokeWidth={2.4} />
            </button>
          ))}
        </List>
        <Footnote>Tap anyone to see what they paid, who they owe, and every expense they are in.</Footnote>
        <MemberSheet groupId={groupId} memberId={inspecting} onClose={() => setInspecting(null)} meId={meId} />
      </section>

      <section>
        <SectionTitle>Who owes whom</SectionTitle>
        <List>
          {!debts.data ? <RowsSkeleton rows={2} /> : !debts.data.length ? <p className="px-4 py-4 text-[15px] text-muted-foreground">Everyone is settled up</p> : debts.data.map(d => (
            <button key={d.fromMemberId + ">" + d.toMemberId} type="button" onClick={() => setPairOpen({ creditorId: d.toMemberId, debtorId: d.fromMemberId })} className={pressableRow}>
              <span className="min-w-0 flex-1 truncate text-[15px]">
                <span className="font-medium">{d.fromMemberId === meId ? "You" : d.fromName}</span>
                <span className="text-muted-foreground">{d.fromMemberId === meId ? " owe " : " owes "}</span>
                <span className="font-medium">{d.toMemberId === meId ? "you" : d.toName}</span>
              </span>
              <span className="tabular text-[15px] font-medium">{inr(d.amountCents)}</span>
              <ChevronRight className={CHEVRON} strokeWidth={2.4} />
            </button>
          ))}
        </List>
        <Footnote>Tap a line to see the expenses behind it. For each expense, everyone owes their share to whoever paid; if two people owe each other, only the difference is shown.</Footnote>
        <PairSheet groupId={groupId} pair={pairOpen} onClose={() => setPairOpen(null)} meId={meId} />
      </section>
    </div>
  );
}

// ----- Payments -----
function PaymentsTab({ groupId, meId }: { groupId: string; meId?: string }) {
  const payments = useSettlements(groupId);
  const [proof, setProof] = React.useState<Settlement | null>(null);
  const who = (id: string, name: string) => (id === meId ? "You" : name);
  return (
    <div className="space-y-7">
    <UpiPeople groupId={groupId} />
    <div>
      <SectionTitle action={payments.data && payments.data.length > 0 ? <span className="tabular text-[13px] text-muted-foreground">Total {inr(payments.data.reduce((s, x) => s + (x.status === "confirmed" ? x.amountCents : 0), 0))}</span> : undefined}>
        {payments.data ? `${payments.data.length} ${payments.data.length === 1 ? "payment" : "payments"}` : "Payments"}
      </SectionTitle>
      <div className="panel overflow-hidden">
        {payments.isPending ? <RowsSkeleton /> : !payments.data?.length ? (
          <EmptyState icon={<Wallet />} title="No payments yet">When someone pays back, it shows up here.</EmptyState>
        ) : (
          <table className="w-full text-[14px]">
            <TableHead cols={[["Date", "w-12"], ["Payment"], ["Amount", "text-right"]]} />
            <tbody>
              {payments.data.map(s => (
                <tr key={s.id} className={tr}>
                  <td className="py-3 pr-1 pl-4"><DateBadge ts={s.createdAt} /></td>
                  <td className="w-full max-w-0 px-2 py-3">
                    <span className={cn("block truncate text-[15px] font-medium", s.status === "rejected" && "text-muted-foreground line-through")}>{who(s.fromMemberId, s.fromName)} paid {s.toMemberId === meId ? "you" : s.toName}</span>
                    <span className="block truncate text-[12.5px] text-muted-foreground">
                      {s.status === "pending" ? <AwaitingBadge label={`awaiting ${s.toMemberId === meId ? "your" : s.toName + "'s"} approval`} /> : s.status === "rejected" ? <span className="font-medium text-negative">Rejected by {s.toMemberId === meId ? "you" : s.toName}</span> : new Date(s.createdAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}
                      {s.recordedByName && s.recordedByName !== s.fromName ? " · recorded by " + s.recordedByName : ""}
                    </span>
                  </td>
                  <td className={cn("tabular py-3 pr-4 pl-2 text-right text-[15px] font-medium whitespace-nowrap", s.status !== "confirmed" && "text-muted-foreground")}>
                    {inr(s.amountCents)}
                    {s.hasProof && <button type="button" aria-label="View payment screenshot" onClick={() => setProof(s)} className="mt-0.5 flex w-full cursor-pointer items-center justify-end gap-1 text-[12px] font-normal text-tint"><Paperclip className="size-3" />Screenshot</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    <ProofDialog src={proof ? proofSrc(groupId, proof.id) : null} title={proof ? `${proof.fromName}'s payment` : ""} onClose={() => setProof(null)} />
    </div>
    </div>
  );
}

// ----- Insights -----
function InsightsTab({ groupId }: { groupId: string }) {
  const dash = useDashboard(groupId), group = useGroup(groupId);
  // Tap anyone to open their whole picture (same sheet as Group balances).
  const [inspecting, setInspecting] = React.useState<string | null>(null);
  const max = Math.max(1, ...(dash.data?.spending.map(s => s.paidCents) || [0]));
  return (
    <div className="space-y-7">
      <div className="grid grid-cols-2 gap-3">
        <div className="panel p-4"><p className="text-[13px] text-muted-foreground">Total spent</p>{dash.data ? <AnimatedMoney cents={dash.data.totalSpentCents} size="lg" className="mt-2" /> : <Skeleton className="mt-2 h-7 w-24" />}</div>
        <div className="panel p-4"><p className="text-[13px] text-muted-foreground">Expenses</p><p className="tabular mt-2 text-[26px] leading-none font-medium">{dash.data?.expenseCount ?? "—"}</p></div>
      </div>
      <section>
        <SectionTitle>Who paid the most</SectionTitle>
        <div className="panel space-y-4 p-4">
          {!dash.data ? <RowsSkeleton rows={3} /> : dash.data.spending.map((s, i) => (
            <button key={s.memberId} type="button" onClick={() => setInspecting(s.memberId)} className="block w-full cursor-pointer rounded-[14px] text-left transition-transform active:scale-[0.98]">
              <div className="flex items-center gap-3">
                <PersonAvatar id={s.memberId} name={s.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2 text-[15px]"><span className="truncate font-medium">{s.name}</span><span className="tabular font-medium">{inr(s.paidCents)}</span></div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#141716]/[0.06]">
                    <m.div className="h-full rounded-full bg-[#141716]" initial={{ width: 0 }} animate={{ width: (s.paidCents / max) * 100 + "%" }} transition={{ duration: 0.8, ease: EASE, delay: 0.05 + i * 0.06 }} />
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">Their share of expenses: {inr(s.shareCents)}</p>
                </div>
                <ChevronRight className={CHEVRON} strokeWidth={2.4} />
              </div>
            </button>
          ))}
        </div>
      </section>
      <section>
        <SectionTitle>People</SectionTitle>
        <List inset={60}>
          {group.data?.members.map(mm => (
            <button key={mm.id} type="button" onClick={() => setInspecting(mm.id)} className={pressableRow}>
              <PersonAvatar id={mm.id} name={mm.name} size="sm" />
              <span className="flex-1 truncate text-[15px]">{mm.name}{mm.id === group.data.me.id && <span className="text-muted-foreground"> (you)</span>}</span>
              <span className="text-[13px] text-muted-foreground">{mm.status === "admin" ? "Admin" : mm.status === "pending" ? "Waiting for approval" : ""}</span>
              <ChevronRight className={CHEVRON} strokeWidth={2.4} />
            </button>
          ))}
        </List>
      </section>
      <MemberSheet groupId={groupId} memberId={inspecting} onClose={() => setInspecting(null)} meId={group.data?.me.id} />
    </div>
  );
}
