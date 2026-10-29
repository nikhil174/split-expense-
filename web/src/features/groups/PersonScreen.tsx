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

const tr = "border-b border-hairline last:border-0";

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

      <div className="panel mt-4 flex flex-col items-center px-5 pt-6 pb-6 text-center">
        {d ? <PersonAvatar id={memberId} name={d.other.name} size="lg" className="size-20 text-[30px]" /> : <Skeleton className="size-20 rounded-full" />}
        {d ? <h1 className="mt-3 text-[24px] leading-[30px] font-medium tracking-[-0.02em]">You & {d.other.name}</h1> : <Skeleton className="mt-3 h-7 w-40" />}
        {d && (
          <>
            <p className={cn("mt-1 text-[14px] font-medium", n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-muted-foreground")}>
              {n > 0 ? `${d.other.name} owes you ${inr(n)}` : n < 0 ? `You owe ${d.other.name} ${inr(-n)}` : "You are settled up"}
            </p>
            {n !== 0 && <AnimatedMoney cents={Math.abs(n)} size="hero" className={cn("mt-3", n > 0 ? "text-positive" : "text-negative")} />}
          </>
        )}
      </div>

      {d && n !== 0 && (
        <div className="mt-4">
          {n < 0 && myDebt && <Button size="xl" className="w-full" onClick={() => setSettling(myDebt)}><HandCoins className="size-5" />Pay {d.other.name}</Button>}
          {n < 0 && !myDebt && debts.data && <p className="subhead rounded-[18px] bg-[#141716]/[0.035] px-4 py-3 text-muted-foreground">{d.other.name} is no longer an active member. Ask the admin to record this payment.</p>}
          {n > 0 && theirDebt && <Button size="xl" variant="secondary" className="w-full" onClick={() => setSettling(theirDebt)}>Record payment from {d.other.name}</Button>}
          {n > 0 && !theirDebt && debts.data && <p className="subhead rounded-[18px] bg-[#141716]/[0.035] px-4 py-3 text-center text-muted-foreground">Waiting for {d.other.name} to record their payment.</p>}
        </div>
      )}

      <section className="mt-7">
        <SectionTitle>Everything between you</SectionTitle>
        <div className="panel overflow-hidden">
          {!d ? <div className="space-y-3 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div> : !d.items.length ? (
            <EmptyState icon={<ReceiptText />} title="Nothing Shared">Expenses and payments between you two will appear here.</EmptyState>
          ) : (
            <table className="w-full text-[15px]">
              <thead><tr className="border-b border-hairline">{[["Date", "w-12"], ["Item", ""], ["Effect", "text-right"], ["Balance", "text-right"]].map(([c, cls]) => <th key={c} scope="col" className={cn("px-2 pt-3 pb-2 text-left text-[12px] font-medium text-muted-foreground first:pl-4 last:pr-4", cls)}>{c}</th>)}</tr></thead>
              <tbody>
                {d.items.map((it, i) => (
                  <m.tr key={it.type + it.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * 0.025, duration: 0.25 }} className={tr}>
                    <td className="py-3 pr-1 pl-4"><DateBadge ts={it.createdAt} /></td>
                    <td className="w-full max-w-0 px-2 py-2.5">
                      {it.type === "expense" ? (
                        <><span className="block truncate text-[15px] font-medium">{it.description}</span>
                          <span className="footnote block truncate text-muted-foreground">{it.paidBy === memberId ? d.other.name + " paid" : "You paid"} {inr(it.totalCents)} · {it.paidBy === memberId ? "your" : d.other.name + "'s"} share {inr(it.shareCents)}</span></>
                      ) : (
                        <><span className="block truncate text-[15px] font-medium">{it.fromMemberId === memberId ? d.other.name + " paid you" : "You paid " + d.other.name}</span>
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
