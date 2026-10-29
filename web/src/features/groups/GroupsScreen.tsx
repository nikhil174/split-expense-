import { m } from "motion/react";
import { ChevronRight, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedMoney, EmptyState, List, Money, Page, PersonAvatar, SectionTitle, listItem, pressableRow } from "@/components/app/bits";
import { useGroups } from "@/hooks/queries";
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
      <p className="eyebrow">{greeting()}</p>
      <h1 className="mt-1 font-serif text-[40px] leading-none tracking-[-0.02em]">{name.split(" ")[0]}</h1>

      <section className="panel mt-6 p-5">
        <p className="eyebrow">{net > 0 ? "Overall, you are owed" : net < 0 ? "Overall, you owe" : "Overall"}</p>
        <div className="mt-3 min-h-14">
          {groups.isPending ? <Skeleton className="h-12 w-48" /> : net === 0 ? <p className="font-serif text-[40px] leading-none">All settled</p> : (
            <AnimatedMoney cents={Math.abs(net)} size="hero" className={net > 0 ? "text-positive" : "text-negative"} />
          )}
        </div>
        <div className="mt-5 grid grid-cols-2 divide-x divide-hairline border-t border-hairline pt-4">
          <div className="pr-4"><p className="text-[12px] text-muted-foreground">Owed to you</p><Money cents={owedToYou} size="md" className={cn("mt-1", owedToYou ? "text-positive" : "text-muted-foreground")} /></div>
          <div className="pl-4"><p className="text-[12px] text-muted-foreground">You owe</p><Money cents={youOwe} size="md" className={cn("mt-1", youOwe ? "text-negative" : "text-muted-foreground")} /></div>
        </div>
      </section>

      <div className="mt-8">
        <SectionTitle>Your groups</SectionTitle>
        <List>
          {groups.isPending && [0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-3.5 px-4 py-4"><Skeleton className="size-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div></div>
          ))}
          {groups.data?.length === 0 && (
            <EmptyState icon={<Users className="size-5" />} title="No groups yet">Only the admin can create groups. Ask them to add you to one.</EmptyState>
          )}
          {list.map((g, i) => {
            const c = Number(g.myBalanceCents || 0);
            return (
              <m.button key={g.id} custom={i} variants={listItem} initial="initial" animate="animate" type="button"
                onClick={() => navigate({ name: "group", groupId: g.id, tab: "expenses" })} className={pressableRow}>
                <PersonAvatar id={g.id} name={g.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{g.name}</span>
                  <span className={cn("block text-[12.5px]", c > 0 ? "text-positive" : c < 0 ? "text-negative" : "text-muted-foreground")}>{c > 0 ? "you are owed" : c < 0 ? "you owe" : "settled up"}</span>
                </span>
                {c !== 0 && <Money cents={Math.abs(c)} size="md" className={c > 0 ? "text-positive" : "text-negative"} />}
                <span className="sr-only">Open dashboard</span>
                <ChevronRight className="size-4 text-muted-foreground/70" />
              </m.button>
            );
          })}
        </List>
      </div>
    </Page>
  );
}
