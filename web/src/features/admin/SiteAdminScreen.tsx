import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, Search, ShieldCheck, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AnimatedMoney, EmptyState, List, LoadingButton, Page, PersonAvatar, SectionTitle, Segmented, fieldClass, rowClass, searchFieldClass } from "@/components/app/bits";
import { AquaCard } from "@/features/groups/GroupsScreen";
import { keys } from "@/hooks/queries";
import { get, post, type AdminGroup, type AdminOverview, type AdminUser, type User } from "@/lib/api";
import { inr, shortDate } from "@/lib/money";
import { toast } from "sonner";

// The site owner's console: accounts and groups across Split It, in summary
// (never anyone's expenses). Separate from the owner's own groups ("General"),
// and opened with the admin key once per session.
export function SiteAdminScreen({ user }: { user: User }) {
  if (!user.adminUnlocked) return <Unlock />;
  return <Console />;
}

function Unlock() {
  const qc = useQueryClient();
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await post("/api/site-admin/unlock", { key }); setKey(""); await qc.invalidateQueries({ queryKey: keys.me }); }
    catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Page>
      <form onSubmit={unlock} className="panel mx-auto mt-6 max-w-sm space-y-4 p-6 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#141716] text-white"><KeyRound className="size-6" /></span>
        <div>
          <h1 className="title-2">Admin</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">Enter the admin key to open the console for this session.</p>
        </div>
        <Input type="password" aria-label="Admin key" autoComplete="current-password" required value={key} onChange={e => setKey(e.target.value)} className={fieldClass} />
        <LoadingButton type="submit" size="lg" className="w-full rounded-full" disabled={!key} loading={busy} loadingText="Checking…">Open Admin</LoadingButton>
      </form>
    </Page>
  );
}

type Tab = "overview" | "users" | "groups";
const adminGet = <T,>(part: string, path: string) => ({ queryKey: ["site-admin", part] as const, queryFn: () => get<T>(path), staleTime: 0 });

function Console() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<Tab>("overview");
  const lock = async () => { await post("/api/site-admin/lock"); await qc.invalidateQueries({ queryKey: keys.me }); qc.removeQueries({ queryKey: ["site-admin"] }); };
  return (
    <Page>
      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <p className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground"><ShieldCheck className="size-4" />Site admin</p>
          <h1 className="page-title">Console</h1>
        </div>
        <button type="button" onClick={lock} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#141716]/[0.06] px-3.5 py-2 text-[13.5px] font-medium transition-transform active:scale-95"><Lock className="size-4" />Lock</button>
      </div>
      <Segmented id="admin-console-tab" className="mt-5" value={tab} onChange={setTab} options={[{ value: "overview", label: "Overview" }, { value: "users", label: "People" }, { value: "groups", label: "Groups" }]} />
      <div className="mt-5">
        {tab === "overview" && <Overview />}
        {tab === "users" && <People />}
        {tab === "groups" && <Groups />}
      </div>
    </Page>
  );
}

function Overview() {
  const q = useQuery(adminGet<AdminOverview>("overview", "/api/site-admin/overview"));
  const s = q.data;
  return (
    <AquaCard>
      <p className="eyebrow">Recorded across Split It</p>
      <div className="mt-2 min-h-11">{s ? <AnimatedMoney cents={s.totalSpentCents} size="hero" /> : <Skeleton className="h-11 w-48" />}</div>
      <div className="mt-5 grid grid-cols-4 gap-2">
        {([["People", s?.users], ["New this week", s?.newUsersThisWeek], ["Groups", s?.groups], ["Expenses", s?.expenses]] as const).map(([label, value]) => (
          <div key={label} className="rounded-[14px] bg-[#141716]/[0.035] px-1 py-2.5 text-center">
            <p className="tabular text-[20px] leading-none font-medium">{value ?? "–"}</p>
            <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
    </AquaCard>
  );
}

function useSearch() {
  const [text, setText] = React.useState(""), [q, setQ] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  return { text, setText, q };
}
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} className={searchFieldClass} />
    </div>
  );
}

function People() {
  const s = useSearch();
  const q = useQuery(adminGet<{ users: AdminUser[] }>("users-" + s.q, "/api/site-admin/users?q=" + encodeURIComponent(s.q)));
  const [resetting, setResetting] = React.useState<AdminUser | null>(null);
  const [temp, setTemp] = React.useState<{ name: string; pin: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const reset = async () => {
    if (!resetting) return;
    setBusy(true);
    try { const d = await post<{ name: string; temporaryPin: string }>(`/api/site-admin/users/${resetting.id}/reset-pin`); setResetting(null); setTemp({ name: d.name, pin: d.temporaryPin }); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section>
      <SearchBox value={s.text} onChange={s.setText} placeholder="Search name, username or email" />
      <SectionTitle>{q.data ? `${q.data.users.length} ${q.data.users.length === 1 ? "person" : "people"}${q.data.users.length === 100 ? "+" : ""}` : "People"}</SectionTitle>
      <List inset={60}>
        {q.isPending ? <div className="p-4"><Skeleton className="h-10 w-full" /></div> : !q.data?.users.length ? <EmptyState icon={<Users />} title="No one found" /> : q.data.users.map(x => (
          <div key={x.id} className={rowClass}>
            <PersonAvatar id={x.id} name={x.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{x.name}{x.siteAdmin && <span className="font-normal text-muted-foreground"> · site admin</span>}</span>
              <span className="block truncate text-[12.5px] text-muted-foreground">@{x.username}{x.email ? " · " + x.email : ""} · {x.groupCount} {x.groupCount === 1 ? "group" : "groups"} · joined {shortDate(x.createdAt).full}{x.locked ? " · locked" : ""}{!x.hasPin ? " · no PIN yet" : ""}</span>
            </span>
            <button type="button" onClick={() => setResetting(x)} aria-label={"Reset PIN for " + x.name} className="shrink-0 cursor-pointer rounded-full bg-[#141716]/[0.05] px-3 py-1.5 text-[13px] font-medium transition-transform active:scale-95">Reset PIN</button>
          </div>
        ))}
      </List>
      <AlertDialog open={!!resetting || !!temp} onOpenChange={o => { if (!o && !busy) { setResetting(null); setTemp(null); } }}>
        <AlertDialogContent className="max-w-[360px] rounded-[26px] border-0 p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="title-2">{temp ? `New PIN for ${temp.name}` : `Reset ${resetting?.name}'s PIN?`}</AlertDialogTitle>
            <AlertDialogDescription>{temp ? "Shown only now. Pass it on privately; they should change it in Profile." : "They're signed out everywhere and get a temporary 4-digit PIN that you pass on to them."}</AlertDialogDescription>
          </AlertDialogHeader>
          {temp && <p className="tabular text-center text-[40px] font-medium tracking-[0.3em]" data-testid="temporary-pin">{temp.pin}</p>}
          <AlertDialogFooter>
            {temp ? <AlertDialogCancel className="rounded-full">Done</AlertDialogCancel> : <>
              <AlertDialogCancel disabled={busy} className="rounded-full border-0 bg-[#141716]/[0.06] shadow-none">Cancel</AlertDialogCancel>
              <LoadingButton loading={busy} loadingText="Resetting…" onClick={reset}>Reset PIN</LoadingButton>
            </>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Groups() {
  const s = useSearch();
  const q = useQuery(adminGet<{ groups: AdminGroup[] }>("groups-" + s.q, "/api/site-admin/groups?q=" + encodeURIComponent(s.q)));
  return (
    <section>
      <SearchBox value={s.text} onChange={s.setText} placeholder="Search groups" />
      <SectionTitle>{q.data ? `${q.data.groups.length} ${q.data.groups.length === 1 ? "group" : "groups"}` : "Groups"}</SectionTitle>
      <List inset={60}>
        {q.isPending ? <div className="p-4"><Skeleton className="h-10 w-full" /></div> : !q.data?.groups.length ? <EmptyState icon={<Users />} title="No groups found" /> : q.data.groups.map(x => (
          <div key={x.id} className={rowClass}>
            <PersonAvatar id={x.id} name={x.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{x.name}</span>
              <span className="block truncate text-[12.5px] text-muted-foreground">{x.memberCount} {x.memberCount === 1 ? "member" : "members"} · admin {x.admins || "none"} · {x.expenseCount} {x.expenseCount === 1 ? "expense" : "expenses"}{x.lastActivity ? " · last " + shortDate(x.lastActivity).full : ""}</span>
            </span>
            <span className="tabular shrink-0 text-[14px] font-medium">{inr(x.totalCents)}</span>
          </div>
        ))}
      </List>
    </section>
  );
}
