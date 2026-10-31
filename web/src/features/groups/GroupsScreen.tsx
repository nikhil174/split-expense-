import * as React from "react";
import { m } from "motion/react";
import { AtSign, ChevronRight, Lock, Plus, Users } from "lucide-react";
import { PinInput } from "@/components/app/secrets";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedMoney, EASE, EmptyState, List, LoadingButton, Page, PersonAvatar, SectionTitle, fieldClass, listItem, pressableRow } from "@/components/app/bits";
import { GlitterDust, Sheen, Sparkles } from "@/components/app/glitter";
import { PeopleSheet, type PeopleFilter } from "./PeopleSheet";
import { PendingPayments } from "./PendingPayments";
import { InstallCard } from "@/components/app/InstallApp";
import { useAccountAction, useGroups, useInvitations, usePeopleBalances } from "@/hooks/queries";
import { post, type Invitation, type User } from "@/lib/api";
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

// Tap targets inside a balance card: they press in place and open the people sheet.
export const cardTap = "block w-full cursor-pointer rounded-[14px] text-left transition-transform duration-150 active:scale-[0.97]";

export function GroupsScreen({ user }: { user: User }) {
  const name = user.name;
  const [creating, setCreating] = React.useState(false);
  const groups = useGroups(), people = usePeopleBalances();
  const list = groups.data || [];
  // The filter stays put while the sheet animates closed.
  const [sheetOpen, setSheetOpen] = React.useState(false), [filter, setFilter] = React.useState<PeopleFilter>("all");
  const openSheet = (f: PeopleFilter) => { setFilter(f); setSheetOpen(true); };
  // Person-by-person totals, so these match the people sheet exactly
  // (in one group you can be owed by one person and owe another).
  const owedToYou = people.data?.owedToYouCents ?? list.reduce((s, g) => s + Math.max(0, Number(g.myBalanceCents || 0)), 0);
  const youOwe = people.data?.youOweCents ?? list.reduce((s, g) => s + Math.max(0, -Number(g.myBalanceCents || 0)), 0);
  const net = owedToYou - youOwe;
  const count = people.data?.people.length ?? 0;
  return (
    <Page>
      <p className="eyebrow px-1">{greeting()}</p>
      <h1 className="page-title mt-1 px-1">{name.split(" ")[0]}</h1>

      {/* Tap the total for everyone, or either half for just that side. */}
      <AquaCard className="mt-5">
        <button type="button" onClick={() => openSheet("all")} className={cardTap}>
          <span className="eyebrow block">{net > 0 ? "Overall, you are owed" : net < 0 ? "Overall, you owe" : "Overall balance"}</span>
          <span className="mt-2 block min-h-11">
            {groups.isPending ? <Skeleton className="h-11 w-44" /> : net === 0 ? <span className="block text-[30px] font-medium tracking-[-0.02em]">All settled up</span> : <AnimatedMoney cents={Math.abs(net)} size="hero" className={net > 0 ? "text-positive" : "text-negative"} />}
          </span>
        </button>
        <div className="mt-5 grid grid-cols-2 border-t border-hairline pt-4">
          <button type="button" onClick={() => openSheet("owed")} className={cardTap}>
            <span className="flex items-center gap-0.5 text-[12px] text-muted-foreground">Owed to you<ChevronRight className="size-3.5" strokeWidth={2.4} /></span>
            <span className={cn("tabular mt-0.5 block text-[16px] font-medium", owedToYou ? "text-positive" : "text-muted-foreground")}>{inr(owedToYou)}</span>
          </button>
          <button type="button" onClick={() => openSheet("owe")} className={cn(cardTap, "rounded-none border-l border-hairline pl-4")}>
            <span className="flex items-center gap-0.5 text-[12px] text-muted-foreground">You owe<ChevronRight className="size-3.5" strokeWidth={2.4} /></span>
            <span className={cn("tabular mt-0.5 block text-[16px] font-medium", youOwe ? "text-negative" : "text-muted-foreground")}>{inr(youOwe)}</span>
          </button>
        </div>
        <button type="button" onClick={() => openSheet("all")} className={cn(cardTap, "mt-4 flex items-center justify-between rounded-none border-t border-hairline pt-3 text-[13.5px] font-medium")}>
          <span>{count ? `See ${count === 1 ? "1 person" : count + " people"}` : "See balances by person"}</span>
          <ChevronRight className="size-[18px] text-[#141716]/35" strokeWidth={2.4} />
        </button>
      </AquaCard>
      <PeopleSheet open={sheetOpen} onOpenChange={setSheetOpen} filter={filter} />

      {user.legacy && (
        <button type="button" onClick={() => navigate({ name: "profile" })} className="panel mt-5 flex w-full cursor-pointer items-center gap-3 p-4 text-left transition-transform active:scale-[0.98]">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-tint-soft text-tint"><AtSign className="size-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">Choose your username</span><span className="block text-[13px] text-muted-foreground">You sign in with it from now on. Yours for now: @{user.username}</span></span>
          <ChevronRight className="size-[18px] text-[#141716]/25" strokeWidth={2.4} />
        </button>
      )}
      <Invitations />
      <PendingPayments className="mt-7" />
      <InstallCard className="mt-5" />

      <div className="mt-7">
        <SectionTitle action={<button type="button" onClick={() => setCreating(true)} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[#141716] py-1.5 pr-3.5 pl-2.5 text-[13.5px] font-medium text-white transition-transform active:scale-95"><Plus className="size-4" strokeWidth={2.4} />New group</button>}>Your groups</SectionTitle>
        <List inset={68}>
          {groups.isPending && [0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5"><Skeleton className="size-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div></div>
          ))}
          {groups.data?.length === 0 && (
            <EmptyState icon={<Users />} title="No groups yet">Create one for a trip, your flat or friends, then invite people by their username or email.</EmptyState>
          )}
          {list.map((g, i) => {
            const c = Number(g.myBalanceCents || 0);
            return (
              <m.button key={g.id} custom={i} variants={listItem} initial="initial" animate="animate" type="button"
                onClick={() => navigate({ name: "group", groupId: g.id, tab: "expenses" })} className={pressableRow}>
                <PersonAvatar id={g.id} name={g.name} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-[15.5px] font-medium">{g.name}{g.hasPin && !g.unlocked && <Lock aria-label="Locked: needs the group PIN" className="size-3.5 shrink-0 text-muted-foreground" />}</span>
                  <span className={cn("block text-[13px]", c > 0 ? "text-positive" : c < 0 ? "text-negative" : "text-muted-foreground")}>{c > 0 ? "you are owed " + inr(c) : c < 0 ? "you owe " + inr(-c) : "settled up"}<span className="text-muted-foreground">{" · " + g.memberCount + (g.memberCount === 1 ? " member" : " members") + (g.role === "admin" ? " · admin" : "")}</span></span>
                </span>
                <span className="sr-only">Open dashboard</span>
                <ChevronRight className="size-[18px] text-[#141716]/25" strokeWidth={2.4} />
              </m.button>
            );
          })}
        </List>
      </div>
      <NewGroupDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

// Groups I've been invited to: join or decline.
function Invitations() {
  const q = useInvitations();
  const answer = useAccountAction((v: { groupId: string; groupName: string; action: "accept" | "decline"; pin?: string }) => post(`/api/groups/${v.groupId}/invitation/${v.action}`, v.pin ? { pin: v.pin } : {}),
    v => v.action === "accept" ? `You joined “${v.groupName}”.` : "Invitation declined.");
  // Joining a group with a PIN asks for it first.
  const [joining, setJoining] = React.useState<Invitation | null>(null);
  const [pin, setPin] = React.useState("");
  const join = (i: Invitation, p?: string) => answer.mutate({ ...i, action: "accept", pin: p }, { onSuccess: () => { setJoining(null); navigate({ name: "group", groupId: i.groupId, tab: "expenses" }); }, onError: () => setPin("") });
  if (!q.data?.length) return null;
  return (
    <section className="mt-7" data-testid="invitations">
      <SectionTitle>{q.data.length === 1 ? "You're invited" : `${q.data.length} invitations`}</SectionTitle>
      <div className="panel overflow-hidden [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-hairline">
        {q.data.map(i => {
          const busy = answer.isPending && answer.variables?.groupId === i.groupId;
          return (
            <div key={i.groupId} className="px-4 py-3.5">
              <div className="flex items-center gap-3">
                <PersonAvatar id={i.groupId} name={i.groupName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{i.groupName}</p>
                  <p className="truncate text-[13px] text-muted-foreground">{i.invitedBy} invited you · {i.memberCount} {i.memberCount === 1 ? "member" : "members"}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <LoadingButton variant="secondary" className="rounded-full" disabled={answer.isPending} loading={busy && answer.variables?.action === "decline"} loadingText="Declining…" onClick={() => answer.mutate({ ...i, action: "decline" })}>Decline</LoadingButton>
                <LoadingButton className="rounded-full" aria-label={`Join ${i.groupName}`} disabled={answer.isPending} loading={busy && answer.variables?.action === "accept"} loadingText="Joining…" onClick={() => { if (i.hasPin) { setPin(""); setJoining(i); } else join(i); }}>Join</LoadingButton>
              </div>
            </div>
          );
        })}
      </div>
      <AlertDialog open={!!joining} onOpenChange={o => { if (!o && !answer.isPending) setJoining(null); }}>
        <AlertDialogContent className="max-w-[360px] rounded-[26px] border-0 p-6">
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (joining && pin.length === 4) join(joining, pin); }}>
            <AlertDialogHeader>
              <AlertDialogTitle className="title-2">Join {joining?.groupName}</AlertDialogTitle>
              <AlertDialogDescription>Enter the group's 4-digit PIN. {joining?.invitedBy} can tell you.</AlertDialogDescription>
            </AlertDialogHeader>
            <PinInput id="join-pin" value={pin} onChange={setPin} autoComplete="off" autoFocus />
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={answer.isPending} className="rounded-full border-0 bg-[#141716]/[0.06] shadow-none">Cancel</AlertDialogCancel>
              <LoadingButton type="submit" disabled={pin.length !== 4} loading={answer.isPending} loadingText="Joining…">Join group</LoadingButton>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function NewGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = React.useState(""), [pin, setPin] = React.useState(""), [pin2, setPin2] = React.useState("");
  React.useEffect(() => { if (open) { setName(""); setPin(""); setPin2(""); } }, [open]);
  const create = useAccountAction((n: string) => post<{ group: { id: string; name: string } }>("/api/groups", { name: n, pin }));
  const clean = name.trim().replace(/\s+/g, " ");
  return (
    <AlertDialog open={open} onOpenChange={o => { if (!o && !create.isPending) onClose(); }}>
      <AlertDialogContent className="max-w-[360px] rounded-[26px] border-0 p-6">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (pin !== pin2) { toast.error("The two PINs don't match."); return; } if (clean.length >= 2) create.mutate(clean, { onSuccess: d => { toast.success(`“${d.group.name}” created. Invite people from Members.`); onClose(); navigate({ name: "group", groupId: d.group.id, tab: "expenses" }); } }); }}>
          <AlertDialogHeader>
            <AlertDialogTitle className="title-2">New group</AlertDialogTitle>
            <AlertDialogDescription>You'll be its admin. Members need the group PIN to join and to open it (remembered for a day on each phone).</AlertDialogDescription>
          </AlertDialogHeader>
          <Input aria-label="Group name" autoFocus required minLength={2} maxLength={80} placeholder="e.g. Goa Trip" value={name} onChange={e => setName(e.target.value)} className={cn(fieldClass, "h-11")} />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5"><span className="eyebrow block px-1">Group PIN</span><PinInput id="new-group-pin" value={pin} onChange={setPin} autoComplete="off" /></label>
            <label className="space-y-1.5"><span className="eyebrow block px-1">Confirm</span><PinInput id="new-group-pin2" value={pin2} onChange={setPin2} autoComplete="off" /></label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={create.isPending} className="rounded-full border-0 bg-[#141716]/[0.06] shadow-none">Cancel</AlertDialogCancel>
            <LoadingButton type="submit" disabled={clean.length < 2 || pin.length !== 4 || pin2.length !== 4} loading={create.isPending} loadingText="Creating…">Create group</LoadingButton>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
