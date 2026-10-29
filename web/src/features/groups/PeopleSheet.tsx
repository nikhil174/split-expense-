import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { ChevronLeft, ChevronRight, ReceiptText, Sparkles as SparklesIcon } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { DateBadge, EmptyState, List, PersonAvatar, SectionTitle, pressableRow } from "@/components/app/bits";
import { SheetHeader } from "./AddExpenseDrawer";
import { usePeopleBalances, usePerson } from "@/hooks/queries";
import type { PersonBalance } from "@/lib/api";
import { inr } from "@/lib/money";
import { navigate } from "@/lib/route";
import { cn } from "@/lib/utils";

export type PeopleFilter = "all" | "owe" | "owed";
const IOS_EASE = [0.32, 0.72, 0, 1] as const;
const TITLES: Record<PeopleFilter, string> = { all: "Balances", owe: "You owe", owed: "Owed to you" };

// Bottom sheet: who owes me / whom I owe, then (in the same sheet) everything
// shared with one person. groupId limits it to one group.
export function PeopleSheet({ open, onOpenChange, filter, groupId }: { open: boolean; onOpenChange: (o: boolean) => void; filter: PeopleFilter; groupId?: string }) {
  const q = usePeopleBalances();
  const [chosen, setChosen] = React.useState<PersonBalance | null>(null);
  React.useEffect(() => { if (open) setChosen(null); }, [open]);

  const all = (q.data?.people || []).filter(x => !groupId || x.groupId === groupId);
  const owesYou = filter !== "owe" ? all.filter(x => x.netCents > 0) : [];
  const youOwe = filter !== "owed" ? all.filter(x => x.netCents < 0) : [];
  const shown = owesYou.length + youOwe.length;
  // Group names only help when the list spans more than one group.
  const showGroup = new Set(all.map(x => x.groupId)).size > 1;
  const total = (list: PersonBalance[]) => list.reduce((s, x) => s + Math.abs(x.netCents), 0);
  const description = chosen ? "Every expense and payment between you."
    : filter === "owe" ? `${inr(total(youOwe))} in total` : filter === "owed" ? `${inr(total(owesYou))} in total` : "Tap a person to see what's between you.";

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[90dvh] max-w-xl rounded-t-[28px] border-0">
        <SheetHeader title={chosen ? chosen.name : TITLES[filter]} description={description} />
        <div className="min-h-0 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            {!chosen ? (
              <m.div key="list" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25, ease: IOS_EASE }} className="safe-bottom space-y-6 px-4 pt-2 pb-6">
                {q.isPending ? (
                  <List inset={68}>{[0, 1].map(i => <div key={i} className="flex items-center gap-3 px-4 py-3.5"><Skeleton className="size-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div></div>)}</List>
                ) : !shown ? (
                  <EmptyState icon={<SparklesIcon />} title="All settled up">{filter === "owe" ? "You don't owe anyone." : filter === "owed" ? "Nobody owes you right now." : "Nobody owes you and you owe nobody."}</EmptyState>
                ) : (
                  <>
                    {owesYou.length > 0 && <Rows title={filter === "all" ? "Owes you" : null} people={owesYou} showGroup={showGroup} onPick={setChosen} />}
                    {youOwe.length > 0 && <Rows title={filter === "all" ? "You owe" : null} people={youOwe} showGroup={showGroup} onPick={setChosen} />}
                  </>
                )}
              </m.div>
            ) : (
              <m.div key="person" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.25, ease: IOS_EASE }} className="safe-bottom px-4 pt-1 pb-6">
                <button type="button" onClick={() => setChosen(null)} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[#141716]/[0.05] py-1.5 pr-3 pl-2 text-[13.5px] font-medium transition-transform active:scale-95">
                  <ChevronLeft className="size-4" strokeWidth={2.4} />{TITLES[filter]}
                </button>
                <PersonDetail person={chosen} onOpenPage={() => { onOpenChange(false); navigate({ name: "person", groupId: chosen.groupId, memberId: chosen.memberId }); }} />
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Rows({ title, people, showGroup, onPick }: { title: string | null; people: PersonBalance[]; showGroup: boolean; onPick: (p: PersonBalance) => void }) {
  return (
    <section>
      {title && <SectionTitle>{title}</SectionTitle>}
      <List inset={68}>
        {people.map(x => {
          const c = x.netCents;
          const sub = [showGroup && x.groupName, !x.active && "former member"].filter(Boolean).join(" · ");
          return (
            <button key={x.groupId + x.memberId} type="button" onClick={() => onPick(x)} className={pressableRow}>
              <PersonAvatar id={x.memberId} name={x.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-medium">{x.name}</span>
                <span className="block truncate text-[13px] text-muted-foreground">{sub || (c > 0 ? "owes you" : "you owe")}</span>
              </span>
              <span className={cn("tabular text-right text-[15.5px] font-medium whitespace-nowrap", c > 0 ? "text-positive" : "text-negative")}>{inr(Math.abs(c))}</span>
              <ChevronRight className="size-[18px] shrink-0 text-[#141716]/25" strokeWidth={2.4} />
            </button>
          );
        })}
      </List>
    </section>
  );
}

function PersonDetail({ person, onOpenPage }: { person: PersonBalance; onOpenPage: () => void }) {
  const view = usePerson(person.groupId, person.memberId);
  const d = view.data;
  const n = d?.netCents ?? person.netCents;
  return (
    <>
      <div className="flex items-center gap-3 pt-4 pb-4">
        <PersonAvatar id={person.memberId} name={person.name} size="lg" />
        <div className="min-w-0">
          <p className="title-2 truncate">You & {person.name}</p>
          <p className={cn("text-[14px] font-medium", n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-muted-foreground")}>
            {n > 0 ? `${person.name} owes you ${inr(n)}` : n < 0 ? `You owe ${person.name} ${inr(-n)}` : "You are settled up"}
          </p>
        </div>
      </div>
      <div className="panel overflow-hidden">
        {!d ? <div className="space-y-3 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div> : !d.items.length ? (
          <EmptyState icon={<ReceiptText />} title="Nothing shared">Expenses and payments between you two will appear here.</EmptyState>
        ) : (
          <ul>
            {d.items.map(it => (
              <li key={it.type + it.id} className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-0">
                <DateBadge ts={it.createdAt} />
                <span className="min-w-0 flex-1">
                  {it.type === "expense" ? (
                    <><span className="block truncate text-[15px] font-medium">{it.description}</span>
                      <span className="footnote block truncate text-muted-foreground">{it.paidBy === person.memberId ? person.name + " paid" : "You paid"} {inr(it.totalCents)} · {it.paidBy === person.memberId ? "your" : person.name + "'s"} share {inr(it.shareCents)}</span></>
                  ) : (
                    <><span className="block truncate text-[15px] font-medium">{it.fromMemberId === person.memberId ? person.name + " paid you" : "You paid " + person.name}</span>
                      <span className="footnote block text-muted-foreground">Payment</span></>
                  )}
                </span>
                <span className={cn("tabular text-right text-[15px] font-medium whitespace-nowrap", it.effectCents > 0 ? "text-positive" : "text-negative")}>{it.effectCents > 0 ? "+" : "−"}{inr(Math.abs(it.effectCents))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {d && d.items.length > 0 && <p className="footnote mt-2 px-2 text-muted-foreground">+ means {person.name} owes you more, − means you owe {person.name} more.</p>}
      <button type="button" onClick={onOpenPage} className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-1 rounded-full bg-[#141716]/[0.05] py-3 text-[14.5px] font-medium transition-transform active:scale-[0.98]">
        {n < 0 ? `Pay ${person.name}` : n > 0 ? `Record payment from ${person.name}` : "Open full details"}<ChevronRight className="size-4" strokeWidth={2.4} />
      </button>
    </>
  );
}
