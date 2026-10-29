import * as React from "react";
import { m } from "motion/react";
import { HandCoins, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedMoney, DateBadge, EmptyState, Footnote, Page, PersonAvatar, SectionTitle } from "@/components/app/bits";
import { BackButton } from "./GroupScreen";
import { SettleUpDrawer } from "./SettleUpDrawer";
import { useDebts, useGroup, usePerson } from "@/hooks/queries";
import { inr } from "@/lib/money";
import { goBack } from "@/lib/route";
import { cn } from "@/lib/utils";

const tr = "shadow-[inset_0_-0.5px_0_var(--hairline)] last:shadow-none";

// Everything between me and one other person, with a running balance that
// ends at what we currently owe each other. Laid out like an iOS contact card.
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
      <BackButton label={group.data?.group.name || "Back"} onClick={() => goBack({ name: "group", groupId, tab: "balances" })} />

      <div className="mt-3 flex flex-col items-center text-center">
        {d ? <PersonAvatar name={d.other.name} size="lg" className="size-24 text-[40px]" /> : <Skeleton className="size-24 rounded-full" />}
        {d ? <h1 className="title-2 mt-3 text-[28px] leading-[34px]">You & {d.other.name}</h1> : <Skeleton className="mt-3 h-7 w-40" />}
        {d && (
          <>
            <p className={cn("subhead mt-1", n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-muted-foreground")}>
              {n > 0 ? `${d.other.name} owes you ${inr(n)}` : n < 0 ? `You owe ${d.other.name} ${inr(-n)}` : "You are settled up"}
            </p>
            {n !== 0 && <AnimatedMoney cents={Math.abs(n)} size="hero" className={cn("mt-3", n > 0 ? "text-positive" : "text-negative")} />}
          </>
        )}
      </div>

      {d && n !== 0 && (
        <div className="mt-5">
          {n < 0 && myDebt && <Button size="xl" className="w-full" onClick={() => setSettling(myDebt)}><HandCoins className="size-5" />Pay {d.other.name}</Button>}
          {n < 0 && !myDebt && debts.data && <p className="subhead panel px-4 py-3 text-muted-foreground">{d.other.name} is no longer an active member. Ask the admin to record this payment.</p>}
          {n > 0 && theirDebt && <Button size="xl" variant="secondary" className="w-full" onClick={() => setSettling(theirDebt)}>Record payment from {d.other.name}</Button>}
          {n > 0 && !theirDebt && debts.data && <p className="subhead panel px-4 py-3 text-center text-muted-foreground">Waiting for {d.other.name} to record their payment.</p>}
        </div>
      )}

      <section className="mt-7">
        <SectionTitle>Everything between you</SectionTitle>
        <div className="panel overflow-hidden">
          {!d ? <div className="space-y-3 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div> : !d.items.length ? (
            <EmptyState icon={<ReceiptText />} title="Nothing Shared">Expenses and payments between you two will appear here.</EmptyState>
          ) : (
            <table className="w-full text-[15px]">
              <thead><tr className="shadow-[inset_0_-0.5px_0_var(--hairline)]">{[["Date", "w-12"], ["Item", ""], ["Effect", "text-right"], ["Balance", "text-right"]].map(([c, cls]) => <th key={c} scope="col" className={cn("footnote px-2 py-2 text-left font-normal text-muted-foreground first:pl-4 last:pr-4", cls)}>{c}</th>)}</tr></thead>
              <tbody>
                {d.items.map((it, i) => (
                  <m.tr key={it.type + it.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * 0.025, duration: 0.25 }} className={tr}>
                    <td className="py-2.5 pr-1 pl-3"><DateBadge ts={it.createdAt} /></td>
                    <td className="w-full max-w-0 px-2 py-2.5">
                      {it.type === "expense" ? (
                        <><span className="block truncate text-[17px]">{it.description}</span>
                          <span className="footnote block truncate text-muted-foreground">{it.paidBy === memberId ? d.other.name + " paid" : "You paid"} {inr(it.totalCents)} · {it.paidBy === memberId ? "your" : d.other.name + "'s"} share {inr(it.shareCents)}</span></>
                      ) : (
                        <><span className="block truncate text-[17px]">{it.fromMemberId === memberId ? d.other.name + " paid you" : "You paid " + d.other.name}</span>
                          <span className="footnote block text-muted-foreground">Payment</span></>
                      )}
                    </td>
                    <td className={cn("tabular px-2 py-2.5 text-right whitespace-nowrap", it.effectCents > 0 ? "text-positive" : "text-negative")}>{it.effectCents > 0 ? "+" : "−"}{inr(Math.abs(it.effectCents))}</td>
                    <td className={cn("tabular py-2.5 pr-4 pl-2 text-right whitespace-nowrap", it.runningCents > 0 ? "text-positive" : it.runningCents < 0 ? "text-negative" : "text-muted-foreground")}>{inr(it.runningCents)}</td>
                  </m.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Footnote>Balance is the running total: positive means they owe you, negative means you owe them.</Footnote>
      </section>
      <SettleUpDrawer groupId={groupId} open={!!settling} onOpenChange={o => { if (!o) setSettling(null); }} initial={settling} />
    </Page>
  );
}
