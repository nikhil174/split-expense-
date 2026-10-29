import { m } from "motion/react";
import { ChevronRight, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedMoney, EASE, EmptyState, List, Page, PersonAvatar, SectionTitle, listItem, pressableRow } from "@/components/app/bits";
import { GlitterDust, Sheen, Sparkles } from "@/components/app/glitter";
import { useGroups } from "@/hooks/queries";
import { inr } from "@/lib/money";
import { navigate } from "@/lib/route";
import { cn } from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// Balance card: white with a hairline, a faint champagne light, a slow sheen and a few glints.
export function AquaCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <m.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}
      className={cn("panel relative overflow-hidden p-5", className)}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_100%_0%,rgb(214_170_80/14%),transparent_60%)]" />
      <Sheen />
      <GlitterDust />
      <Sparkles />
      <div className="relative">{children}</div>
    </m.section>
  );
}

export function GroupsScreen({ name }: { name: string }) {
  const groups = useGroups();
  const list = groups.data || [];
  const owedToYou = list.reduce((s, g) => s + Math.max(0, Number(g.myBalanceCents || 0)), 0);
  const youOwe = list.reduce((s, g) => s + Math.max(0, -Number(g.myBalanceCents || 0)), 0);
  const net = owedToYou - youOwe;
  return (
    <Page>
      <p className="eyebrow px-1">{greeting()}</p>
      <h1 className="page-title mt-1 px-1">{name.split(" ")[0]}</h1>

      <AquaCard className="mt-5">
        <p className="eyebrow">{net > 0 ? "Overall, you are owed" : net < 0 ? "Overall, you owe" : "Overall balance"}</p>
        <div className="mt-2 min-h-11">
          {groups.isPending ? <Skeleton className="h-11 w-44" /> : net === 0 ? <p className="text-[30px] font-medium tracking-[-0.02em]">All settled up</p> : <AnimatedMoney cents={Math.abs(net)} size="hero" className={net > 0 ? "text-positive" : "text-negative"} />}
        </div>
        <div className="mt-5 grid grid-cols-2 border-t border-hairline pt-4">
          <div><p className="text-[12px] text-muted-foreground">Owed to you</p><p className={cn("tabular mt-0.5 text-[16px] font-medium", owedToYou ? "text-positive" : "text-muted-foreground")}>{inr(owedToYou)}</p></div>
          <div className="border-l border-hairline pl-4"><p className="text-[12px] text-muted-foreground">You owe</p><p className={cn("tabular mt-0.5 text-[16px] font-medium", youOwe ? "text-negative" : "text-muted-foreground")}>{inr(youOwe)}</p></div>
        </div>
      </AquaCard>

      <div className="mt-7">
        <SectionTitle>Your groups</SectionTitle>
        <List inset={68}>
          {groups.isPending && [0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5"><Skeleton className="size-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div></div>
          ))}
          {groups.data?.length === 0 && (
            <EmptyState icon={<Users />} title="No groups yet">Only the admin can create groups. Ask them to add you to one.</EmptyState>
          )}
          {list.map((g, i) => {
            const c = Number(g.myBalanceCents || 0);
            return (
              <m.button key={g.id} custom={i} variants={listItem} initial="initial" animate="animate" type="button"
                onClick={() => navigate({ name: "group", groupId: g.id, tab: "expenses" })} className={pressableRow}>
                <PersonAvatar id={g.id} name={g.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px] font-medium">{g.name}</span>
                  <span className={cn("block text-[13px]", c > 0 ? "text-positive" : c < 0 ? "text-negative" : "text-muted-foreground")}>{c > 0 ? "you are owed " + inr(c) : c < 0 ? "you owe " + inr(-c) : "settled up"}</span>
                </span>
                <span className="sr-only">Open dashboard</span>
                <ChevronRight className="size-[18px] text-[#141716]/25" strokeWidth={2.4} />
              </m.button>
            );
          })}
        </List>
      </div>
    </Page>
  );
}
