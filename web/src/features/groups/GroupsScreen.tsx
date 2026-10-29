import { m } from "motion/react";
import { ChevronRight, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedMoney, EASE, EmptyState, List, Page, PersonAvatar, SectionTitle, listItem, pressableRow } from "@/components/app/bits";
import { useGroups } from "@/hooks/queries";
import { inr } from "@/lib/money";
import { navigate } from "@/lib/route";
import { cn } from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// Vivid "aqua" card used for the main balance on home and group screens.
export function AquaCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <m.section initial={{ opacity: 0, y: 10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease: EASE }}
      className={cn("relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#0fcf94_0%,#00a98a_45%,#0a8fb8_100%)] p-5 text-white shadow-[0_18px_40px_-16px_rgb(0_150_110/55%)]", className)}>
      <div aria-hidden="true" className="pointer-events-none absolute -top-16 -right-14 size-52 rounded-full bg-white/20 blur-2xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-10 size-56 rounded-full bg-[#7ef0cf]/25 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-white/25 ring-inset" />
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
      <p className="px-1 text-[15px] text-muted-foreground">{greeting()},</p>
      <h1 className="page-title px-1">{name.split(" ")[0]}</h1>

      <AquaCard className="mt-5">
        <p className="text-[14px] text-white/85">{net > 0 ? "Overall, you are owed" : net < 0 ? "Overall, you owe" : "Overall balance"}</p>
        <div className="mt-2 min-h-11">
          {groups.isPending ? <Skeleton className="h-11 w-44 bg-white/25" /> : net === 0 ? <p className="text-[30px] font-semibold">All settled up</p> : <AnimatedMoney cents={Math.abs(net)} size="hero" />}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-[18px] bg-white/16 px-3.5 py-2.5 backdrop-blur-sm"><p className="text-[12px] text-white/80">Owed to you</p><p className="tabular mt-0.5 text-[16px] font-semibold">{inr(owedToYou)}</p></div>
          <div className="rounded-[18px] bg-white/16 px-3.5 py-2.5 backdrop-blur-sm"><p className="text-[12px] text-white/80">You owe</p><p className="tabular mt-0.5 text-[16px] font-semibold">{inr(youOwe)}</p></div>
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
                  <span className="block truncate text-[16px] font-medium">{g.name}</span>
                  <span className={cn("block text-[13px]", c > 0 ? "text-positive" : c < 0 ? "text-negative" : "text-muted-foreground")}>{c > 0 ? "you are owed " + inr(c) : c < 0 ? "you owe " + inr(-c) : "settled up"}</span>
                </span>
                <span className="sr-only">Open dashboard</span>
                <ChevronRight className="size-[18px] text-[#0e1a16]/25" strokeWidth={2.4} />
              </m.button>
            );
          })}
        </List>
      </div>
    </Page>
  );
}
