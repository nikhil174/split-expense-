import * as React from "react";
import { m } from "motion/react";
import { ChevronDown, ChevronRight, Sparkles as SparklesIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedMoney, EmptyState, Footnote, List, Page, PersonAvatar, SectionTitle, listItem, pressableRow } from "@/components/app/bits";
import { AquaCard } from "./GroupsScreen";
import { BackButton } from "./GroupScreen";
import { usePeopleBalances } from "@/hooks/queries";
import type { PersonBalance } from "@/lib/api";
import { inr } from "@/lib/money";
import { goBack, navigate } from "@/lib/route";
import { cn } from "@/lib/utils";

// Who owes me and whom I owe, person by person, across all my groups.
// Tapping a person opens everything shared with them in that group.
export function BalancesScreen() {
  const q = usePeopleBalances();
  const d = q.data;
  const people = d?.people || [];
  const owesYou = people.filter(x => x.netCents > 0), youOwe = people.filter(x => x.netCents < 0);
  // Group names only help when the list spans more than one group.
  const showGroup = new Set(people.map(x => x.groupId)).size > 1;
  const net = d?.netCents ?? 0;
  // The summary card looks tappable (it is on Home), so here a tap points at
  // the people below: scroll to them and briefly highlight the rows.
  const listRef = React.useRef<HTMLDivElement>(null);
  const [pulse, setPulse] = React.useState(0);
  const showPeople = () => {
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setPulse(n => n + 1);
  };

  return (
    <Page>
      <BackButton label="Home" onClick={() => goBack({ name: "home" })} />
      <h1 className="page-title mt-4 px-1">Balances</h1>

      <AquaCard className="mt-5" onClick={people.length ? showPeople : undefined}>
        <p className="eyebrow">{net > 0 ? "Overall, you are owed" : net < 0 ? "Overall, you owe" : "Overall balance"}</p>
        <div className="mt-2 min-h-11">
          {q.isPending ? <Skeleton className="h-11 w-44" /> : net === 0 ? <p className="text-[30px] font-medium tracking-[-0.02em]">All settled up</p> : <AnimatedMoney cents={Math.abs(net)} size="hero" className={net > 0 ? "text-positive" : "text-negative"} />}
        </div>
        <div className="mt-5 grid grid-cols-2 border-t border-hairline pt-4">
          <div><p className="text-[12px] text-muted-foreground">Owed to you</p><p className={cn("tabular mt-0.5 text-[16px] font-medium", d?.owedToYouCents ? "text-positive" : "text-muted-foreground")}>{inr(d?.owedToYouCents ?? 0)}</p></div>
          <div className="border-l border-hairline pl-4"><p className="text-[12px] text-muted-foreground">You owe</p><p className={cn("tabular mt-0.5 text-[16px] font-medium", d?.youOweCents ? "text-negative" : "text-muted-foreground")}>{inr(d?.youOweCents ?? 0)}</p></div>
        </div>
        {people.length > 0 && (
          <span className="mt-4 flex items-center justify-between border-t border-hairline pt-3 text-[13.5px] font-medium">
            <span>Tap a person below for details</span>
            <ChevronDown className="size-[18px] text-[#141716]/35" strokeWidth={2.4} />
          </span>
        )}
      </AquaCard>

      {q.isPending && (
        <div className="mt-7"><List inset={68}>{[0, 1, 2].map(i => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5"><Skeleton className="size-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div></div>
        ))}</List></div>
      )}

      {d && !people.length && (
        <div className="panel mt-7"><EmptyState icon={<SparklesIcon />} title="All settled up">Nobody owes you and you owe nobody.</EmptyState></div>
      )}

      <div ref={listRef} className="scroll-mt-20">
        {owesYou.length > 0 && <PeopleSection title="Owes you" people={owesYou} showGroup={showGroup} pulse={pulse} />}
        {youOwe.length > 0 && <PeopleSection title="You owe" people={youOwe} showGroup={showGroup} pulse={pulse} />}
      </div>
      {people.length > 0 && <Footnote>Tap a person to see every expense and payment between you.</Footnote>}
    </Page>
  );
}

function PeopleSection({ title, people, showGroup, pulse }: { title: string; people: PersonBalance[]; showGroup: boolean; pulse: number }) {
  return (
    <section className="mt-7">
      <SectionTitle>{title}</SectionTitle>
      <List inset={68}>
        {people.map((x, i) => {
          const c = x.netCents;
          const sub = [showGroup && x.groupName, !x.active && "former member"].filter(Boolean).join(" · ");
          return (
            <m.button key={x.groupId + x.memberId} custom={i} variants={listItem} initial="initial" animate="animate" type="button"
              onClick={() => navigate({ name: "person", groupId: x.groupId, memberId: x.memberId })} className={pressableRow}>
              {pulse > 0 && <m.span key={pulse} aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[rgb(226_186_98/22%)]"
                initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.1, delay: 0.25 + i * 0.08, ease: "easeInOut" }} />}
              <PersonAvatar id={x.memberId} name={x.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-medium">{x.name}</span>
                <span className="block truncate text-[13px] text-muted-foreground">{sub || (c > 0 ? "owes you" : "you owe")}</span>
              </span>
              <span className={cn("tabular text-right text-[15.5px] font-medium whitespace-nowrap", c > 0 ? "text-positive" : "text-negative")}>{inr(Math.abs(c))}</span>
              <ChevronRight className="size-[18px] shrink-0 text-[#141716]/25" strokeWidth={2.4} />
            </m.button>
          );
        })}
      </List>
    </section>
  );
}
