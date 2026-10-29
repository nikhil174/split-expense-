import * as React from "react";
import { m } from "motion/react";
import { ArrowLeft, HandCoins, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedMoney, DateBadge, EmptyState, Page, PersonAvatar, SectionTitle } from "@/components/app/bits";
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
      <button type="button" onClick={() => goBack({ name: "group", groupId, tab: "balances" })} className="-ml-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" />{group.data?.group.name || "Back"}
      </button>

      <div className="mt-4 flex items-center gap-4">
        {d ? <PersonAvatar id={memberId} name={d.other.name} size="lg" /> : <Skeleton className="size-14 rounded-full" />}
        {d ? <h1 className="font-serif text-[34px] leading-[1.02] tracking-[-0.02em]">You <span className="text-muted-foreground italic">&</span> {d.other.name}</h1> : <Skeleton className="h-9 w-48" />}
      </div>

      <section className="panel mt-6 p-5">
        {!d ? <Skeleton className="h-16 w-48" /> : (
          <>
            <p className={cn("text-[14px]", n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-muted-foreground")}>
              {n > 0 ? `${d.other.name} owes you ` : n < 0 ? `You owe ${d.other.name} ` : "You are settled up"}
              {n !== 0 && <span className="sr-only">{inr(Math.abs(n))}</span>}
            </p>
            {n !== 0 && <AnimatedMoney cents={Math.abs(n)} size="hero" className={cn("mt-2", n > 0 ? "text-positive" : "text-negative")} />}
          </>
        )}
        {d && n !== 0 && (
          <div className="mt-5">
            {n < 0 && myDebt && <Button size="xl" className="w-full" onClick={() => setSettling(myDebt)}><HandCoins className="size-[18px]" />Pay {d.other.name}</Button>}
            {n < 0 && !myDebt && debts.data && <p className="rounded-xl bg-muted/60 px-3.5 py-3 text-[13px] text-muted-foreground">{d.other.name} is no longer an active member. Ask the admin to record this payment.</p>}
            {n > 0 && theirDebt && <Button size="xl" variant="secondary" className="w-full" onClick={() => setSettling(theirDebt)}>Record payment from {d.other.name}</Button>}
            {n > 0 && !theirDebt && debts.data && <p className="rounded-xl bg-muted/60 px-3.5 py-3 text-[13px] text-muted-foreground">Waiting for {d.other.name} to record their payment.</p>}
          </div>
        )}
      </section>

      <section className="mt-8">
        <SectionTitle>Everything between you</SectionTitle>
        <div className="panel overflow-hidden">
          {!d ? <div className="space-y-3 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div> : !d.items.length ? (
            <EmptyState icon={<ReceiptText className="size-5" />} title="Nothing shared yet">Expenses and payments between you two will appear here.</EmptyState>
          ) : (
            <table className="w-full text-[14px]">
              <thead><tr className="border-b border-hairline">{[["Date", "w-12"], ["Item", ""], ["Effect", "text-right"], ["Balance", "text-right"]].map(([c, cls]) => <th key={c} scope="col" className={cn("eyebrow px-2 py-2.5 text-left !text-[10px] font-medium first:pl-4 last:pr-4", cls)}>{c}</th>)}</tr></thead>
              <tbody>
                {d.items.map((it, i) => (
                  <m.tr key={it.type + it.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * 0.03, duration: 0.3 }} className="border-b border-hairline last:border-0">
                    <td className="py-3.5 pr-2 pl-4"><DateBadge ts={it.createdAt} /></td>
                    <td className="w-full max-w-0 px-2 py-3.5">
                      {it.type === "expense" ? (
                        <><span className="block truncate font-medium">{it.description}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">{it.paidBy === memberId ? d.other.name + " paid" : "You paid"} {inr(it.totalCents)} · {it.paidBy === memberId ? "your" : d.other.name + "'s"} share {inr(it.shareCents)}</span></>
                      ) : (
                        <><span className="block truncate font-medium">{it.fromMemberId === memberId ? d.other.name + " paid you" : "You paid " + d.other.name}</span>
                          <span className="block text-[12px] text-muted-foreground">Payment</span></>
                      )}
                    </td>
                    <td className={cn("tabular px-2 py-3.5 text-right whitespace-nowrap", it.effectCents > 0 ? "text-positive" : "text-negative")}>{it.effectCents > 0 ? "+" : "−"}{inr(Math.abs(it.effectCents))}</td>
                    <td className={cn("tabular py-3.5 pr-4 pl-2 text-right whitespace-nowrap", it.runningCents > 0 ? "text-positive" : it.runningCents < 0 ? "text-negative" : "text-muted-foreground")}>{inr(it.runningCents)}</td>
                  </m.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="mt-2.5 px-1 text-[12px] leading-relaxed text-muted-foreground">Balance is the running total: positive means they owe you, negative means you owe them.</p>
      </section>
      <SettleUpDrawer groupId={groupId} open={!!settling} onOpenChange={o => { if (!o) setSettling(null); }} initial={settling} />
    </Page>
  );
}
