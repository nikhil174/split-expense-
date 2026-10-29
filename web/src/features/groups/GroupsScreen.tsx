import { m } from "motion/react";
import { ChevronRight, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedAmount, EmptyState, Page, PersonAvatar, SectionTitle, listItem } from "@/components/app/bits";
import { useGroups } from "@/hooks/queries";
import { inr } from "@/lib/money";
import { navigate } from "@/lib/route";
import { cn } from "@/lib/utils";

export function GroupsScreen({ name }: { name: string }) {
  const groups = useGroups();
  const net = (groups.data || []).reduce((s, g) => s + Number(g.myBalanceCents || 0), 0);
  return (
    <Page>
      <section className="relative overflow-hidden rounded-3xl bg-hero p-5 text-hero-foreground shadow-xl shadow-primary/10">
        <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-primary/40 blur-3xl" />
        <p className="text-sm text-white/70">Hi {name.split(" ")[0]} 👋</p>
        <p className="mt-3 text-sm text-white/70">{net > 0 ? "Overall, you are owed" : net < 0 ? "Overall, you owe" : "Across all your groups"}</p>
        {groups.isPending ? <Skeleton className="mt-1 h-10 w-40 bg-white/10" /> : (
          <p className={cn("mt-0.5 text-4xl font-bold tracking-tight", net > 0 && "text-[oklch(0.85_0.13_160)]", net < 0 && "text-[oklch(0.82_0.11_28)]")}>
            {net === 0 ? "All settled ✓" : <AnimatedAmount cents={Math.abs(net)} />}
          </p>
        )}
      </section>

      <div className="mt-6">
        <SectionTitle>Your groups</SectionTitle>
        <div className="overflow-hidden rounded-2xl border bg-card">
          {groups.isPending && [0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-3 border-b p-4 last:border-0"><Skeleton className="size-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div></div>
          ))}
          {groups.data?.length === 0 && (
            <EmptyState icon={<Users className="size-5" />} title="No groups yet">Only the admin can create groups. Ask them to add you to one.</EmptyState>
          )}
          {groups.data?.map((g, i) => {
            const c = Number(g.myBalanceCents || 0);
            return (
              <m.button key={g.id} custom={i} variants={listItem} initial="initial" animate="animate" type="button"
                onClick={() => navigate({ name: "group", groupId: g.id, tab: "expenses" })}
                className="flex w-full cursor-pointer items-center gap-3 border-b p-4 text-left transition-colors last:border-0 hover:bg-muted/60 active:bg-muted">
                <PersonAvatar id={g.id} name={g.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{g.name}</span>
                  <span className={cn("block text-[13px]", c > 0 ? "text-positive" : c < 0 ? "text-negative" : "text-muted-foreground")}>
                    {c > 0 ? "you are owed " + inr(c) : c < 0 ? "you owe " + inr(-c) : "settled up"}
                  </span>
                </span>
                <span className="sr-only">Open dashboard</span>
                <ChevronRight className="size-5 text-muted-foreground" />
              </m.button>
            );
          })}
        </div>
      </div>
    </Page>
  );
}
