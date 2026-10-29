import * as React from "react";
import { m } from "motion/react";
import { ArrowLeft, HandCoins, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AnimatedAmount, DateBadge, EmptyState, Page, PersonAvatar } from "@/components/app/bits";
import { SettleUpDrawer } from "./SettleUpDrawer";
import { useDebts, useGroup, usePerson } from "@/hooks/queries";
import { inr } from "@/lib/money";
import { goBack } from "@/lib/route";
import { cn } from "@/lib/utils";

// Everything between me and one other person, with a running balance that
// ends at what we currently owe each other.
export function PersonScreen({ groupId, memberId }: { groupId: string; memberId: string }) {
  const view = usePerson(groupId, memberId), group = useGroup(groupId), debts = useDebts(groupId);
  const [settling, setSettling] = React.useState<null | { fromMemberId: string; toMemberId: string }>(null);
  const d = view.data;
  const meId = d?.me.id;
  const myDebt = debts.data?.find(x => x.fromMemberId === meId && x.toMemberId === memberId && x.canRecord);
  const theirDebt = debts.data?.find(x => x.fromMemberId === memberId && x.toMemberId === meId && x.canRecord);
  const n = d?.netCents ?? 0;

  return (
    <Page>
      <button type="button" onClick={() => goBack({ name: "group", groupId, tab: "balances" })} className="mb-3 inline-flex cursor-pointer items-center gap-1 text-sm font-medium text-primary">
        <ArrowLeft className="size-4" />{group.data?.group.name || "Back"}
      </button>
      <section className="rounded-3xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-4">
          {d ? <PersonAvatar id={memberId} name={d.other.name} size="lg" /> : <Skeleton className="size-14 rounded-full" />}
          <div className="min-w-0">
            {d ? <h1 className="truncate text-xl font-bold">You and {d.other.name}</h1> : <Skeleton className="h-6 w-40" />}
            {d && (
              <p className={cn("mt-0.5 text-[15px] font-semibold", n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-muted-foreground")}>
                {n > 0 ? <>{d.other.name} owes you <AnimatedAmount cents={n} /></> : n < 0 ? <>You owe {d.other.name} <AnimatedAmount cents={-n} /></> : "You are settled up"}
              </p>
            )}
          </div>
        </div>
        {d && n !== 0 && (
          <div className="mt-4">
            {n < 0 && myDebt && <Button size="xl" className="w-full" onClick={() => setSettling(myDebt)}><HandCoins className="size-5" />Pay {d.other.name}</Button>}
            {n < 0 && !myDebt && debts.data && <p className="rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">{d.other.name} is no longer an active member. Ask the admin to record this payment.</p>}
            {n > 0 && theirDebt && <Button size="xl" variant="secondary" className="w-full" onClick={() => setSettling(theirDebt)}>Record payment from {d.other.name}</Button>}
            {n > 0 && !theirDebt && debts.data && <p className="rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">Waiting for {d.other.name} to record their payment.</p>}
          </div>
        )}
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border bg-card">
        <h2 className="px-4 pt-4 pb-2 text-lg font-semibold">Everything between you</h2>
        {!d ? <div className="space-y-3 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div> : !d.items.length ? (
          <EmptyState icon={<ReceiptText className="size-5" />} title="Nothing shared yet">Expenses and payments between you two will appear here.</EmptyState>
        ) : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-12 pl-4">Date</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Effect</TableHead><TableHead className="pr-4 text-right">Balance</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.items.map((it, i) => (
                <m.tr key={it.type + it.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * 0.025 }} className="border-b transition-colors hover:bg-muted/50">
                  <TableCell className="pl-4"><DateBadge ts={it.createdAt} /></TableCell>
                  <TableCell className="max-w-0 w-full">
                    {it.type === "expense" ? (
                      <><span className="block truncate font-medium">{it.description}</span>
                        <span className="block truncate text-xs text-muted-foreground">{it.paidBy === memberId ? d.other.name + " paid" : "You paid"} {inr(it.totalCents)} · {it.paidBy === memberId ? "your" : d.other.name + "'s"} share {inr(it.shareCents)}</span></>
                    ) : (
                      <><span className="block truncate font-medium">{it.fromMemberId === memberId ? d.other.name + " paid you" : "You paid " + d.other.name}</span>
                        <span className="block text-xs text-muted-foreground">Payment</span></>
                    )}
                  </TableCell>
                  <TableCell className={cn("tabular text-right font-semibold", it.effectCents > 0 ? "text-positive" : "text-negative")}>{it.effectCents > 0 ? "+" : "−"}{inr(Math.abs(it.effectCents))}</TableCell>
                  <TableCell className={cn("tabular pr-4 text-right", it.runningCents > 0 ? "text-positive" : it.runningCents < 0 ? "text-negative" : "text-muted-foreground")}>{inr(it.runningCents)}</TableCell>
                </m.tr>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">Balance is the running total: positive means they owe you, negative means you owe them.</p>
      </section>
      <SettleUpDrawer groupId={groupId} open={!!settling} onOpenChange={o => { if (!o) setSettling(null); }} initial={settling} />
    </Page>
  );
}
