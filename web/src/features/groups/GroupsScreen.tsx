import { m } from "motion/react";
import { ChevronRight, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedMoney, EmptyState, List, Page, PersonAvatar, SectionTitle, listItem, pressableRow } from "@/components/app/bits";
import { useGroups } from "@/hooks/queries";
import { inr } from "@/lib/money";
import { navigate } from "@/lib/route";
import { cn } from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function GroupsScreen({ name }: { name: string }) {
  const groups = useGroups();
  const list = groups.data || [];
  const owedToYou = list.reduce((s, g) => s + Math.max(0, Number(g.myBalanceCents || 0)), 0);
  const youOwe = list.reduce((s, g) => s + Math.max(0, -Number(g.myBalanceCents || 0)), 0);
  const net = owedToYou - youOwe;
  return (
    <Page>
      <p className="subhead px-1 text-muted-foreground">{greeting()}</p>
      <h1 className="large-title px-1">{name.split(" ")[0]}</h1>

      <section className="panel mt-5 p-4">
        <p className="subhead text-muted-foreground">{net > 0 ? "Overall, you are owed" : net < 0 ? "Overall, you owe" : "Overall"}</p>
        <div className="mt-1.5 min-h-12">
          {groups.isPending ? <Skeleton className="h-11 w-44" /> : net === 0 ? <p className="title-2 pt-1.5">All settled up</p> : (
            <AnimatedMoney cents={Math.abs(net)} size="hero" className={net > 0 ? "text-positive" : "text-negative"} />
          )}
        </div>
        <div className="relative mt-4 grid grid-cols-2 pt-3 before:absolute before:inset-x-0 before:top-0 before:h-px before:origin-top before:scale-y-50 before:bg-hairline before:content-['']">
          <div><p className="footnote text-muted-foreground">Owed to you</p><p className={cn("tabular headline mt-0.5", owedToYou ? "text-positive" : "text-muted-foreground")}>{inr(owedToYou)}</p></div>
          <div><p className="footnote text-muted-foreground">You owe</p><p className={cn("tabular headline mt-0.5", youOwe ? "text-negative" : "text-muted-foreground")}>{inr(youOwe)}</p></div>
        </div>
      </section>

      <div className="mt-7">
        <SectionTitle>Your groups</SectionTitle>
        <List inset={68}>
          {groups.isPending && [0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-3 px-4 py-3"><Skeleton className="size-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div></div>
          ))}
          {groups.data?.length === 0 && (
            <EmptyState icon={<Users />} title="No Groups">Only the admin can create groups. Ask them to add you to one.</EmptyState>
          )}
          {list.map((g, i) => {
            const c = Number(g.myBalanceCents || 0);
            return (
              <m.button key={g.id} custom={i} variants={listItem} initial="initial" animate="animate" type="button"
                onClick={() => navigate({ name: "group", groupId: g.id, tab: "expenses" })} className={pressableRow}>
                <PersonAvatar name={g.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px]">{g.name}</span>
                  <span className={cn("subhead block", c > 0 ? "text-positive" : c < 0 ? "text-negative" : "text-muted-foreground")}>{c > 0 ? "you are owed " + inr(c) : c < 0 ? "you owe " + inr(-c) : "settled up"}</span>
                </span>
                <span className="sr-only">Open dashboard</span>
                <ChevronRight className="size-[18px] text-[#c4c4c7] dark:text-[#5a5a5e]" strokeWidth={2.5} />
              </m.button>
            );
          })}
        </List>
      </div>
    </Page>
  );
}
